import { getAllUsers, getUser, saveUser } from "../storage/user-store.js";
import { withLock } from "../storage/pvp-store.js";
import { rollRegionEncounters } from "../game/wild-roll.js";
import { endWorldBossIfExpired } from "../storage/world-boss-store.js";
import { childLogger } from "../logger.js";

const log = childLogger("auto-search-worker");

/** 자동 야생 탐색 틱 간격(튜닝 지점). 30분마다 관심종을 굴려 최대 1마리 보관한다. */
export const AUTO_SEARCH_INTERVAL_MS = 30 * 60 * 1000; // 30분

/** 보관함 상한 — 자동 탐색이 여기까지만 채운다(수동 전투로 소진하기 전엔 더 안 쌓임). */
const STORED_ENCOUNTER_CAP = 10;

/**
 * 이로치 상시 보관(autoSearchShinyAny)의 하드 상한. 이로치는 일반 상한(10)을 넘어 여기까지 쌓일 수 있다
 * ("10마리와 무관"). 이로치 확률이 낮아 실제로 이만큼 쌓이긴 어렵지만, 무한 증식/저장 비대화를 막는
 * 안전 밸브다.
 */
const STORED_ENCOUNTER_SHINY_CAP = 30;

/**
 * 자동 탐색 직렬화 체인(폴링 워커와 동일 패턴). runAutoSearch는 getAllUsers→유저별 load-mutate-save를
 * 하므로 자기 자신끼리도 겹치면 안 된다. 모듈 레벨 프로미스 체인으로 한 실행이 끝난 뒤 다음이 시작한다.
 */
let searchChain: Promise<unknown> = Promise.resolve();

function withSearchLock<T>(body: () => Promise<T>): Promise<T> {
  const run = searchChain.then(body, body);
  searchChain = run.catch(() => undefined);
  return run;
}

/**
 * 자동 탐색 1회 스윕 — 자동 탐색을 켰고 현재 지역 관심종이 있으며 보관함이 상한 미만인 유저마다,
 * 그 유저의 현재 지역을 12롤 굴려 그 지역 관심종 첫 매치 1마리를 보관함에 추가한다(상한 클램프).
 * 관심종은 지역별 맵이므로 유저의 현재 지역 목록만 본다. 매치가 없으면 no-op.
 *
 * 테스트/수동 트리거 가능하도록 export. 실제 스케줄러(startAutoSearch)는 이 함수를 직렬화 락으로 감싼다.
 */
export async function runAutoSearch(): Promise<void> {
  // 월드보스 24h 만료 정리 — 이 틱에서 함께 지연 종료한다(GET /world-boss의 지연 검사와 중복 안전).
  try {
    await endWorldBossIfExpired();
  } catch (err) {
    log.error({ err }, "world-boss expiry check failed during auto-search tick");
  }

  // getAllUsers는 스냅샷이므로 후보 선별에만 쓰고(값싼 1차 필터), 실제 변경은 유저 락 하에
  // 최신 유저를 다시 읽어(fresh) 수행한다 — 스냅샷~저장 사이 유저의 인앱 행동이 끼어들어도
  // 그 갱신을 덮어쓰지 않는다(lost-update 방지). 다른 프로세스와도 파일 락으로 배타.
  const candidates = await getAllUsers();
  let hits = 0;

  for (const candidate of candidates) {
    // 자동 탐색이 꺼져 있으면 이로치 상시든 관심종이든 아무것도 하지 않는다(마스터 스위치).
    if (!candidate.autoSearchEnabled) continue;
    const region = candidate.currentRegion ?? "default";
    const interest = candidate.interestSpecies?.[region] ?? [];
    const storedCount = candidate.storedEncounters?.length ?? 0;
    // 평소 경로(관심종 있고 보관함 상한 미만)와 이로치 상시 경로(토글 on, 하드캡 미만) 중 하나라도
    // 가능해야 굴린다. 둘 다 불가면 이 유저는 할 일이 없다(값싼 스냅샷 1차 필터).
    const canNormal = interest.length > 0 && storedCount < STORED_ENCOUNTER_CAP;
    const canShiny = !!candidate.autoSearchShinyAny && storedCount < STORED_ENCOUNTER_SHINY_CAP;
    if (!canNormal && !canShiny) continue;

    try {
      await withLock(`user:${candidate.account.id}`, async () => {
        // 락 하에 최신 유저를 다시 읽어 조건을 재확인한다(스냅샷은 낡았을 수 있다).
        const u = await getUser(candidate.account.id);
        if (!u || !u.autoSearchEnabled) return;
        const freshRegion = u.currentRegion ?? "default";
        const freshInterest = u.interestSpecies?.[freshRegion] ?? [];
        const stored = u.storedEncounters ?? [];
        const freshCanNormal = freshInterest.length > 0 && stored.length < STORED_ENCOUNTER_CAP;
        const freshCanShiny = !!u.autoSearchShinyAny && stored.length < STORED_ENCOUNTER_SHINY_CAP;
        if (!freshCanNormal && !freshCanShiny) return;

        const rolled = await rollRegionEncounters(u, 12);
        // 이로치 상시가 켜져 있으면 종/상한과 무관하게 굴린 것 중 이로치를 우선 보관한다.
        let pick = freshCanShiny ? rolled.find((ev) => ev.pokemon.isShiny) ?? null : null;
        // 이로치가 없으면(또는 토글 off) 평소처럼 관심종 첫 매치(보관함 상한 미만일 때만).
        if (!pick && freshCanNormal) {
          pick = rolled.find((ev) => freshInterest.includes(ev.pokemon.species)) ?? null;
        }
        if (!pick) return;

        // 이로치는 하드캡(30)까지, 일반 매치는 상한(10)까지. pick 종류에 맞는 상한으로 최종 확인.
        const cap = pick.pokemon.isShiny ? STORED_ENCOUNTER_SHINY_CAP : STORED_ENCOUNTER_CAP;
        if (stored.length >= cap) return;

        u.storedEncounters = [...stored, pick];
        await saveUser(u);
        hits += 1;
      });
    } catch (err) {
      log.error({ err, userId: candidate.account?.id }, "auto-search roll failed for user");
    }
  }

  if (hits > 0) log.info({ hits }, "runAutoSearch: stored encounters for users");
}

let autoSearchInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoSearch(): void {
  if (autoSearchInterval) return;

  // 부팅 직후 1회, 이후 30분 간격. 각 실행은 직렬화 락으로 감싸 서로 겹치지 않게 한다.
  withSearchLock(runAutoSearch).catch((err) => log.error({ err }, "Initial auto-search failed"));

  autoSearchInterval = setInterval(() => {
    withSearchLock(runAutoSearch).catch((err) => log.error({ err }, "Scheduled auto-search failed"));
  }, AUTO_SEARCH_INTERVAL_MS);
  log.info(`Auto-search started (every ${AUTO_SEARCH_INTERVAL_MS / 60000} min)`);
}

export function stopAutoSearch(): void {
  if (autoSearchInterval) {
    clearInterval(autoSearchInterval);
    autoSearchInterval = null;
  }
}
