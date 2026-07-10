/**
 * 월드보스 전역 상태 저장소 — pokelog-data/world-boss.json 단일 파일.
 *
 * 전 유저가 공유하는 하나의 보스(공유 체력)이므로 상태는 파일 하나로 충분하다. 동시성은
 * pvp-store와 동일한 키별 약속 체인(withLock)으로 직렬화한다 — 각 유저의 전투 턴이 락 하에
 * globalHp를 차감·contributions를 갱신하므로, 모든 변형(mutate)은 반드시 withLock('world-boss')
 * 안에서 read-modify-write로 이뤄져야 한다. 파일 레벨 atomic rename은 json-store가 보장한다.
 *
 * 순수 조회(getWorldBoss)는 락 없이 읽어도 되지만(스냅샷), 변경 뒤 저장은 항상 mutateWorldBoss로.
 */
import path from "node:path";
import type { WorldBossState } from "../../../../shared/types.js";
import { getDataDir } from "../paths.js";
import { readJson, writeJson } from "./json-store.js";
import { withLock } from "./pvp-store.js";

/** 월드보스 락 키 — 모든 변형이 이 키로 직렬화된다(전역 단일 보스라 단일 키). */
export const WORLD_BOSS_LOCK = "world-boss";

/** attackFeed 링버퍼 상한 — 아레나 공격 연출·플로팅 데미지 숫자의 최근 이력. */
export const ATTACK_FEED_MAX = 30;
/** chat 링버퍼 상한 — 참여 채팅 최근 이력. */
export const CHAT_MAX = 50;

function worldBossPath(): string {
  return path.join(getDataDir(), "world-boss.json");
}

/**
 * 현재 월드보스 상태(스냅샷) 또는 null(스폰 전/파일 없음). 조회 전용 — 변경엔 mutateWorldBoss를 쓴다.
 * endIfExpired와 달리 만료 검사·저장은 하지 않는다(순수 읽기).
 */
export async function getWorldBoss(): Promise<WorldBossState | null> {
  return await readJson<WorldBossState>(worldBossPath());
}

/** 상태를 파일에 저장한다(락 없이 호출 금지 — mutateWorldBoss 내부에서만 쓴다). */
export async function saveWorldBoss(state: WorldBossState): Promise<void> {
  await writeJson(worldBossPath(), state);
}

/**
 * 월드보스를 락 하에 읽고-수정-저장한다. mutator가 null을 반환하면 저장하지 않고(변경 없음)
 * 현재 상태를 그대로 반환한다. 상태가 없으면(스폰 전) mutator를 부르지 않고 null을 반환한다.
 * 모든 상태 변형(스폰·딜 반영·채팅·종료·보상)은 이 함수를 통해서만 이뤄진다.
 */
export async function mutateWorldBoss(
  mutator: (state: WorldBossState) => WorldBossState | null | Promise<WorldBossState | null>,
): Promise<WorldBossState | null> {
  return withLock(WORLD_BOSS_LOCK, async () => {
    const state = await getWorldBoss();
    if (!state) return null;
    const next = await mutator(state);
    if (!next) return state;
    await saveWorldBoss(next);
    return next;
  });
}

/** 락 하에 상태를 무조건 교체 저장한다(스폰·종료처럼 이전 상태 유무와 무관한 쓰기). */
export async function setWorldBoss(state: WorldBossState): Promise<WorldBossState> {
  return withLock(WORLD_BOSS_LOCK, async () => {
    await saveWorldBoss(state);
    return state;
  });
}

/**
 * 만료 지연 검사 — active하고 아직 처치되지 않았는데 now>expiresAt이면 active=false로 종료한다.
 * (처치된 보스는 active=false여도 포획 배분이 이미 끝났으므로 건드리지 않는다.) 변경이 있으면
 * 저장 후 새 상태를, 없으면 현재 상태(또는 null)를 반환한다. GET /world-boss와 30분 워커 틱에서 호출.
 */
export async function endWorldBossIfExpired(now: Date = new Date()): Promise<WorldBossState | null> {
  return withLock(WORLD_BOSS_LOCK, async () => {
    const state = await getWorldBoss();
    if (!state) return null;
    if (state.active && !state.defeated && now.getTime() > new Date(state.expiresAt).getTime()) {
      state.active = false;
      await saveWorldBoss(state);
    }
    return state;
  });
}
