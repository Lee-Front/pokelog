import { getSpeciesByName } from "./data-loader.js";
import { applyExpToPokemon, gainFriendshipFromBattle } from "./growth.js";
import { getEvYield, applyEvGain, emptyEvs } from "./evs.js";
import { buildStatsForPokemon } from "./pokemon-stats.js";
import { incrementItem } from "./inventory-utils.js";
import { getPartyPokemon } from "./pokemon-state.js";
import { queuePendingMoveLearns } from "./pending-move-learn.js";
import type {
  BattleDroppedItem,
  BattlePartyExp,
  BattleRewardConfig,
  BattleRewards,
  OwnedPokemon,
  PokemonEVs,
  UserData,
  WildPokemon,
} from "../../../../shared/types.js";

/** 승리 후 미감염 참여자가 포켓루스에 감염될 확률(본가 1/3 대비 보수적). */
export const POKERUS_INFECTION_CHANCE = 0.03;

/**
 * EXP yield — 본가 5세대+ 스케일링 공식. 쓰러진(야생) 레벨과 **경험치를 받는 포켓몬의
 * 레벨** 둘 다에 의존한다:
 *   floor( baseExp × L / 5 × ((2L+10)/(L+Lp+10))^2.5 × expMultiplier ) + 1
 * 여기서 L = 쓰러진 레벨, Lp = 획득 포켓몬 레벨. 내 레벨이 낮으면 보너스(스케일 > 1),
 * 높으면 페널티(< 1), 같으면 정확히 1이다. (구 1~4세대식 baseExp×L/7 은 승자 레벨을
 * 무시했다 — 동레벨 전투가 체감상 너무 짜던 문제를 이 스케일링이 해소한다.)
 */
export function calculateBattleExp(
  wild: Pick<WildPokemon, "species" | "level">,
  winnerLevel: number,
  config: BattleRewardConfig,
): number {
  const baseExpYield = getSpeciesByName(wild.species)?.baseExpYield ?? 0;
  if (baseExpYield <= 0) return 0;
  const L = wild.level;
  const scaling = Math.pow((2 * L + 10) / (L + winnerLevel + 10), 2.5);
  const raw = ((baseExpYield * L) / 5) * scaling * config.expMultiplier;
  return Math.floor(raw) + 1;
}

/** Battle money from a win, approximating main-series trainer prize money by level. */
export function calculateBattleMoney(
  wildLevel: number,
  config: BattleRewardConfig,
): number {
  return Math.max(0, Math.floor(wildLevel * config.moneyPerLevel) + config.moneyBase);
}

/**
 * Single weighted roll across the drop table. The table's total chance may be
 * under 1.0, in which case the remaining probability mass is "no drop".
 * Returns at most one dropped item. `random` is injectable for testing.
 */
export function rollItemDrop(
  config: BattleRewardConfig,
  random: () => number = Math.random,
): BattleDroppedItem | null {
  const table = config.dropTable ?? [];
  let roll = random();

  for (const entry of table) {
    if (roll < entry.chance) {
      const min = Math.max(1, entry.min ?? 1);
      const max = Math.max(min, entry.max ?? min);
      const qty = min + Math.floor(random() * (max - min + 1));
      return { item: entry.item, qty };
    }
    roll -= entry.chance;
  }

  return null;
}

/**
 * Apply `exp` to a single party member, mutating both the Pokemon and `user`
 * (queuing any pending move-learn choices). Returns the per-Pokemon exp summary
 * for the response. 레벨업 자동 진화는 제거됐다 — 진화는 플레이어가 명시적으로
 * 요청하는 온디맨드 경로로 옮겼으므로 여기선 pokedex/pending을 건드리지 않고,
 * evolvedInto는 항상 null이다(포털 호환을 위해 필드 자체는 유지).
 */
function grantExpToMember(
  user: UserData,
  pokemon: OwnedPokemon,
  exp: number,
  party: OwnedPokemon[],
  now: Date,
): BattlePartyExp {
  const expResult = applyExpToPokemon(pokemon, exp, {
    party,
    now,
    region: user.currentRegion ?? "default",
  });

  // 4개 한도를 넘겨 자동으로 못 배운 기술은 대기에 쌓아 플레이어가 결정하게 한다.
  if (expResult.pendingMoveLearns.length > 0) {
    queuePendingMoveLearns(user, pokemon.uid, expResult.pendingMoveLearns);
  }

  return {
    uid: pokemon.uid,
    species: pokemon.species,
    exp,
    leveledUp: expResult.leveled,
    newLevel: expResult.newLevel,
    evolvedInto: null,
  };
}

/**
 * Grant all wild-battle win rewards to the user, mutating `user` in place. EXP
 * is distributed the classic (gen-6+) way: every Pokemon that *participated*
 * (was sent out during the battle) and is still alive (hp>0) earns its full
 * (per-level scaled) yield — no division among participants. Fainted (hp<=0)
 * participants earn nothing. `participants[0]` is the
 * headline (winner) used for the back-compat scalar reward fields.
 * Returns the reward summary for the battle action response.
 */
export function grantBattleRewards(
  user: UserData,
  participants: OwnedPokemon[],
  wild: Pick<WildPokemon, "species" | "level">,
  config: BattleRewardConfig,
  options: { now?: Date; random?: () => number; includeSpoils?: boolean } = {},
): BattleRewards {
  const random = options.random ?? Math.random;
  const now = options.now ?? new Date();
  // 포획 승리(includeSpoils:false)는 경험치·EV·Exp Share는 주되 상금/드랍(spoils)은 주지 않는다
  // (본가: 잡으면 상금 없음). 기본 true — 격파(KO) 경로의 동작은 그대로 유지된다.
  const includeSpoils = options.includeSpoils ?? true;

  const gameMoney = includeSpoils ? calculateBattleMoney(wild.level, config) : 0;
  const drop = includeSpoils ? rollItemDrop(config, random) : null;

  user.gameMoney += gameMoney;

  const droppedItems: BattleDroppedItem[] = [];
  if (drop) {
    incrementItem(user.inventory, drop.item, drop.qty);
    droppedItems.push(drop);
  }

  const party = getPartyPokemon(user);

  // 참여(필드에 나온) 포켓몬 중 살아있는 개체에게 각각 풀 EXP(분배 없음). 기절은 제외.
  const partyExp: BattlePartyExp[] = [];
  for (const member of participants) {
    if (member.hp <= 0) continue;
    // 전투 참여(출전) 친밀도 +2 — 레벨업 친밀도(applyExpToPokemon)와 별개 소스. 친밀도 진화용.
    gainFriendshipFromBattle(member);
    // 격파한 야생에서 EV를 먼저 적립한다(레벨업이 나면 재계산에 자연히 반영되도록).
    // 포켓루스 감염 개체는 수확량 2배(applyEvGain이 252/510 상한을 그대로 강제).
    const baseYield = getEvYield(wild.species);
    const mult = member.pokerus ? 2 : 1;
    const evGain: Partial<PokemonEVs> =
      mult === 1
        ? baseYield
        : (Object.fromEntries(
            Object.entries(baseYield).map(([key, value]) => [key, (value ?? 0) * mult]),
          ) as Partial<PokemonEVs>);
    member.evs = applyEvGain(member.evs ?? emptyEvs(), evGain);
    // 본가 5세대식: 참여자 각자의 레벨로 스케일해 EXP 계산(언더레벨 보너스/오버레벨 페널티).
    const memberExp = calculateBattleExp(wild, member.level, config);
    const summary = grantExpToMember(user, member, memberExp, party, now);
    if (!summary.leveledUp) {
      // 레벨업 재계산이 없었으므로 EV 증가분을 지금 반영한다(현재 HP 보존, 클램프).
      const recomputed = buildStatsForPokemon(member);
      member.maxHp = recomputed.maxHp;
      member.hp = Math.min(member.hp, member.maxHp);
      member.stats = recomputed.stats;
    }
    partyExp.push(summary);
  }

  // Exp Share(본가 학습장치식) — 미참여(벤치) 생존 파티원에게 풀 EXP의 shareRatio 배를 준다.
  // 참여자는 위에서 풀 EXP를 받았고, 벤치원은 EV/포켓루스 없이 EXP만 받는다(기절·참여자는 제외).
  // applyExpToPokemon이 레벨업 시 스탯을 재계산하므로 참여자용 EV 재계산 블록은 필요 없다.
  // RNG를 전혀 쓰지 않으므로 아래 포켓루스 롤의 시퀀스를 교란하지 않고, 요약도 참여자 뒤에 붙어
  // partyExp[0](헤드라인)은 여전히 첫 참여자로 유지된다.
  const shareRatio = config.expShareRatio ?? 0.5;
  if (shareRatio > 0) {
    const participantUids = new Set(participants.map((p) => p.uid));
    for (const member of party) {
      if (participantUids.has(member.uid) || member.hp <= 0) continue;
      // 벤치원도 본인 레벨로 스케일한 뒤 shareRatio 배(학습장치식).
      const sharedExp = Math.floor(calculateBattleExp(wild, member.level, config) * shareRatio);
      if (sharedExp <= 0) continue;
      const summary = grantExpToMember(user, member, sharedExp, party, now);
      partyExp.push(summary);
    }
  }

  // 포켓루스 감염 — 승리 후 낮은 확률로 미감염 생존 참여자 1마리를 감염시킨다.
  // 모든 EV/EXP 적립과 드랍 롤이 끝난 뒤(여기 맨 마지막)에 롤해서 기존 RNG 시퀀스를
  // 교란하지 않는다. 감염 개체는 다음 전투부터 EV 2배를 받는다.
  if (random() < POKERUS_INFECTION_CHANCE) {
    const candidate = participants.find((m) => m.hp > 0 && !m.pokerus);
    if (candidate) {
      candidate.pokerus = true;
    }
  }

  // 헤드라인(winner) — 첫 살아있는 참여자. 전원 기절 같은 예외는 participants[0]로 폴백.
  const headline = partyExp[0];
  return {
    exp: headline?.exp ?? 0,
    gameMoney,
    droppedItems,
    leveledUp: headline?.leveledUp ?? false,
    newLevel: headline?.newLevel ?? participants[0]?.level ?? 0,
    evolvedInto: headline?.evolvedInto ?? null,
    partyExp,
  };
}
