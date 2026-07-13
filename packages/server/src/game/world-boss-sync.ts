// 월드보스 데미지 동기화 — 플레이어 전투 턴이 야생(=보스)에게 넣은 데미지를 전역 공유 체력에
// 반영한다. battle-routes.handleFight가 각 플레이어 공격 직후(이번 턴 야생HP 감소분을 계산해)
// 호출한다. 모든 상태 변형은 world-boss-store.mutateWorldBoss(=withLock('world-boss')) 안에서만.
//
// 처치(globalHp<=0) 순간에는 rewardsDistributed 가드로 딱 한 번 보상(포획 시도권)을 배분한다.
// 배분(distributeWorldBossDefeatRewards)은 각 수령 유저의 user 락에서 이뤄지므로, 배틀 핸들러의
// user 락을 '놓은 뒤' 호출해야 한다 — 그래야 user↔user 교차 교착(두 유저가 동시에 막타를 넣어
// 서로의 배틀 락을 기다리는 상황)이 생기지 않는다(락 순서 규약: 배분은 어떤 배틀 user 락도 쥐지
// 않은 상태에서만 실행). syncWorldBossDamage는 이번 턴이 막타였는지(distribute 필요 여부)만 알린다.

import crypto from "node:crypto";
import type { BattleState, UserData } from "../../../../shared/types.js";
import { getConfig } from "../storage/config-store.js";
import { getAllUsers, saveUser } from "../storage/user-store.js";
import { withLock } from "../storage/pvp-store.js";
import { mutateWorldBoss, ATTACK_FEED_MAX } from "../storage/world-boss-store.js";
import { distributeWorldBossRewards } from "./world-boss.js";
import { childLogger } from "../logger.js";

const log = childLogger("world-boss-sync");

/**
 * 이번 턴 플레이어가 보스에게 넣은 데미지(damage)를 공유 체력에 반영한다.
 *  - globalHp를 damage만큼 차감(0 하한),
 *  - contributions[userId].damage += damage, lastActiveAt 갱신,
 *  - attackFeed에 이번 공격을 push(링버퍼 상한),
 *  - battle.wild.hp를 새 globalHp로 맞춰(공유 체력 라이브 반영) 다음 검사/응답에 쓰이게 한다,
 *  - globalHp<=0이면 defeated=true(+defeatedAt) 표식.
 *
 * damage<=0(빗나감·무효)이면 attackFeed/globalHp는 건드리지 않고 lastActiveAt만 갱신한다.
 * 보스가 이미 처치됐거나(다른 유저가 막타), 이 전투의 worldBossId가 현재 보스와 다르면(새 보스 스폰)
 * globalHp를 건드리지 않고 battle.wild.hp만 현재 globalHp로 맞춘 뒤(또는 0) 반환한다.
 *
 * 처치가 이번 호출로 확정되면(막타) distributePending=true로 알린다. 실제 배분은 호출자가 배틀
 * user 락을 놓은 뒤 distributeWorldBossDefeatRewards로 수행한다(락 순서 규약 — 위 파일 주석 참조).
 * 반환값: defeatedNow(이번 호출로 처치했는지), globalHp, distributePending, bossId(배분 대상 보스).
 */
export async function syncWorldBossDamage(
  battle: BattleState,
  user: UserData,
  damage: number,
): Promise<{ defeatedNow: boolean; globalHp: number; distributePending: boolean; bossId: string | null }> {
  const config = await getConfig();
  let defeatedNow = false;
  let shouldDistribute = false;

  const state = await mutateWorldBoss((ws) => {
    // 이 전투가 겨냥한 보스가 아니면(새 보스로 교체됨) 이 전투의 딜은 무효 — 상태 변경 없음.
    if (battle.worldBossId && ws.bossId !== battle.worldBossId) return null;

    const now = new Date().toISOString();
    const existing = ws.contributions[user.account.id];
    const myPokemon = user.pokemon.find((p) => p.uid === battle.myPokemonUid);
    ws.contributions[user.account.id] = {
      nickname: user.account.nickname,
      damage: (existing?.damage ?? 0) + Math.max(0, damage),
      pokemon: existing?.pokemon ?? {
        species: myPokemon?.species ?? battle.wild.species,
        variantId: myPokemon?.variantId ?? null,
        shiny: myPokemon?.isShiny ?? false,
      },
      lastActiveAt: now,
    };

    if (damage > 0 && !ws.defeated) {
      ws.globalHp = Math.max(0, ws.globalHp - damage);
      const myPoke = myPokemon;
      ws.attackFeed.push({
        id: crypto.randomUUID(),
        userId: user.account.id,
        nickname: user.account.nickname,
        species: myPoke?.species ?? battle.wild.species,
        variantId: myPoke?.variantId ?? null,
        damage,
        at: now,
      });
      if (ws.attackFeed.length > ATTACK_FEED_MAX) {
        ws.attackFeed = ws.attackFeed.slice(-ATTACK_FEED_MAX);
      }

      if (ws.globalHp <= 0 && !ws.defeated) {
        ws.defeated = true;
        ws.defeatedAt = now;
        // 보상 배분은 락 밖에서(전 유저 로드 필요) 하되, 가드는 여기서 1회만 연다.
        if (!ws.rewardsDistributed) {
          ws.rewardsDistributed = true;
          shouldDistribute = true;
        }
        defeatedNow = true;
      }
    }

    return ws;
  });

  // 이 전투의 딜을 보스가 받지 않는(교체됨) 경우: battle.wild.hp는 그대로 두고(전투는 로컬 진행)
  // globalHp는 알 수 없으므로 -1로 표기해 호출자가 무시하게 한다.
  if (!state) {
    return { defeatedNow: false, globalHp: -1, distributePending: false, bossId: null };
  }

  // 공유 체력 라이브 반영 — 다음 finishWin/응답이 새 globalHp를 기준으로 판단하게 한다.
  battle.wild.hp = Math.min(state.globalHp, battle.wild.maxHp);

  if (shouldDistribute) {
    // 막타 유저(=이 요청 유저)의 시도권은 지금 이 user 객체에 직접 심는다 — finishWin의 saveUser(user)가
    // 곧 이 값을 영속하므로 응답 전에 반영된다(추가 user 락 없음, 자기 자신엔 교착 없음). 나머지 기여자
    // 배분은 호출자가 배틀 user 락을 놓은 뒤 distributeWorldBossDefeatRewards로 수행한다(user↔user 교차
    // 교착 방지). 배틀러 본인은 그 배분에서 제외된다(여기서 이미 심었으므로).
    try {
      const users = await getAllUsers();
      const merged = users.map((u) => (u.account.id === user.account.id ? user : u));
      if (!merged.some((u) => u.account.id === user.account.id)) merged.push(user);
      distributeWorldBossRewards(
        merged,
        state.contributions,
        { bossId: state.bossId, species: state.species, variantId: state.variantId, level: state.level, expiresAt: state.expiresAt },
        config.worldBoss.ballPool,
        config.worldBoss.captureBall,
      );
      // distributeWorldBossRewards가 merged 각 유저의 worldBossCapture를 in-place로 세팅했다. 배틀러
      // 본인(user)의 값은 위 merged가 같은 참조라 이미 심겼다. 다른 유저는 아래 지연 배분에서 저장한다.
    } catch (err) {
      log.error({ err, bossId: state.bossId }, "world-boss battler capture planting failed");
    }
  }

  // 다른 기여자 배분은 여기서 하지 않는다 — 호출자가 배틀 user 락을 놓은 뒤
  // distributeWorldBossDefeatRewards(bossId, battlerId)로 수행한다(user↔user 교차 교착 방지).
  return {
    defeatedNow,
    globalHp: state.globalHp,
    distributePending: shouldDistribute,
    bossId: state.bossId,
  };
}

/**
 * 월드보스 처치 보상(포획 시도권)을 막타 유저를 제외한 나머지 기여자에게 배분한다 — 반드시 어떤
 * 배틀 user 락도 쥐지 않은 상태에서 호출한다(각 수령 유저의 user 락을 잡으므로, 배틀 user 락 안에서
 * 부르면 user↔user 교차 교착 위험). 각 유저를 자기 user 락 하에 최신값으로 다시 읽어 worldBossCapture만
 * 심고 저장한다(멱등 — 이미 배분됐으면 skip). 막타 유저(battlerUserId)는 syncWorldBossDamage가 이미
 * finishWin 경로로 심었으므로 제외한다. distributePending=true였을 때만 호출한다.
 */
export async function distributeWorldBossDefeatRewards(bossId: string, battlerUserId: string): Promise<void> {
  const config = await getConfig();
  await distributeRewardsForDefeat(bossId, config.worldBoss.ballPool, config.worldBoss.captureBall, battlerUserId);
}

/**
 * 처치 보상 배분 — 전 유저를 로드해 기여도 비례로 포획 시도권을 배분한다. 보스 상태(contributions/
 * 보스 메타)는 mutate 밖에서 다시 읽어 최신 기여도로 배분한다. 막타 유저(battlerUserId)는 제외하고,
 * 나머지 수령 유저를 각자 user 락 하에 최신값으로 다시 읽어 worldBossCapture만 심어 저장한다(멱등).
 * 반드시 어떤 배틀 user 락도 쥐지 않은 상태에서 호출된다 — user↔user 교차 교착 방지.
 */
async function distributeRewardsForDefeat(
  bossId: string,
  ballPool: number,
  ballItem: string,
  battlerUserId: string,
): Promise<void> {
  try {
    // 최신 보스 상태(기여도)를 다시 읽는다 — mutate 이후 다른 딜이 더 들어왔을 수 있으나, 처치
    // 시점 스냅으로 충분하다(처치 후엔 globalHp<=0이라 추가 딜이 없다).
    const { getWorldBoss } = await import("../storage/world-boss-store.js");
    const state = await getWorldBoss();
    if (!state || state.bossId !== bossId) return;

    // 어떤 배틀 user 락도 쥐지 않은 상태에서 호출되므로(락 순서 규약), 막타 유저를 포함한 모든
    // 수령 유저를 동일하게 각자 user 락 하에 최신값으로 다시 읽어 저장한다(특례 없음).
    const users = await getAllUsers();
    const shares = distributeWorldBossRewards(
      users,
      state.contributions,
      {
        bossId: state.bossId,
        species: state.species,
        variantId: state.variantId,
        level: state.level,
        expiresAt: state.expiresAt,
      },
      ballPool,
      ballItem,
    );

    // 배분 결과(유저별 worldBossCapture)를 id로 인덱싱해 락 하 재읽기 후 그대로 심는다.
    const captureByUser = new Map(
      users
        .filter((u) => shares.some((s) => s.userId === u.account.id))
        .map((u) => [u.account.id, u.worldBossCapture]),
    );

    for (const share of shares) {
      if (share.userId === battlerUserId) continue; // 막타 유저는 finishWin이 이미 저장(경합 회피).
      const capture = captureByUser.get(share.userId);
      if (!capture) continue;
      await withLock(`user:${share.userId}`, async () => {
        // 락 하에 최신 유저를 다시 읽어 stale-save를 피하고, 배분 결과(worldBossCapture)만 옮긴다.
        const fresh = await import("../storage/user-store.js").then((m) => m.getUser(share.userId));
        if (!fresh) return;
        if (fresh.worldBossCapture?.bossId === bossId) return; // 이미 배분됨(멱등)
        fresh.worldBossCapture = capture;
        await saveUser(fresh, "admin-adjust");
      });
    }
    log.info({ bossId, rewarded: shares.length }, "world-boss defeated: distributed capture attempts");
  } catch (err) {
    log.error({ err, bossId }, "world-boss reward distribution failed");
  }
}
