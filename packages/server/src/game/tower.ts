import type {
  ActiveTowerRun, OwnedPokemon, TowerPartySnapshot, UserData,
} from "../../../../shared/types.js";

export interface StageReward {
  points: number;
  bp: number;
  items: Array<{ id: string; amount: number }>;
}

export interface StartTowerResult {
  ok: boolean;
  error?: string;
  run?: ActiveTowerRun;
}

/**
 * Per-stage milestone rewards. Stages without explicit entries fall
 * through to linear scaling: points = 50 * stage, bp = stage. The
 * stage-1 entry overrides the formula to bootstrap a runnable economy.
 */
const STAGE_REWARDS: Record<number, Omit<StageReward, "bp"> & { bp?: number }> = {
  1: { points: 100, items: [] },
  5: { points: 500, items: [{ id: "rare-egg", amount: 1 }] },
  10: { points: 2000, items: [{ id: "epic-egg", amount: 1 }] },
  20: { points: 5000, items: [{ id: "charizardite-y", amount: 1 }] },
  50: { points: 20000, items: [{ id: "master-ball", amount: 1 }] },
  100: { points: 100000, items: [{ id: "ultra-necrozium-z", amount: 1 }] },
};

export const TOWER_RUN_TTL_MS = 24 * 60 * 60 * 1000;

export function getStageReward(stage: number): StageReward {
  const base = STAGE_REWARDS[stage];
  if (base) {
    return { points: base.points, bp: base.bp ?? stage, items: base.items };
  }
  return { points: 50 * stage, bp: stage, items: [] };
}

export function startTower(user: UserData, partyUids: string[]): StartTowerResult {
  // Clean up expired runs automatically (I5)
  if (user.activeTowerRun) {
    const age = Date.now() - new Date(user.activeTowerRun.startedAt).getTime();
    if (age > TOWER_RUN_TTL_MS) {
      user.activeTowerRun = undefined;
    } else {
      return { ok: false, error: "이미 진행 중인 타워 도전이 있습니다" };
    }
  }

  if (!Array.isArray(partyUids) || partyUids.length !== 3) {
    return { ok: false, error: "3마리의 포켓몬이 필요합니다" };
  }

  const party: OwnedPokemon[] = [];
  for (const uid of partyUids) {
    const poke = user.pokemon.find((p) => p.uid === uid);
    if (!poke) return { ok: false, error: `포켓몬을 찾을 수 없습니다: ${uid}` };
    if (poke.hp <= 0) {
      return { ok: false, error: `기절한 포켓몬은 사용할 수 없습니다: ${poke.species}` };
    }
    party.push(poke);
  }

  const speciesSet = new Set(party.map((p) => p.species));
  if (speciesSet.size !== party.length) {
    return { ok: false, error: "같은 종족의 포켓몬은 함께 출전할 수 없습니다 (Species Clause)" };
  }

  const snapshot: TowerPartySnapshot[] = party.map((p) => ({
    uid: p.uid,
    currentHp: p.hp,
    currentPp: Object.fromEntries(p.moves.map((m) => [m.id, m.pp])),
    statusCondition: p.statusCondition ?? null,
    sleepTurns: p.sleepTurns,
  }));

  const run: ActiveTowerRun = {
    stage: 1,
    partyUids: [...partyUids],
    partySnapshot: snapshot,
    startedAt: new Date().toISOString(),
  };

  user.activeTowerRun = run;
  return { ok: true, run };
}

export function updateTowerRecord(user: UserData, clearedStage: number): void {
  if (!user.towerRecord) {
    user.towerRecord = { currentStreak: 0, bestStreak: 0, totalClears: 0 };
  }
  user.towerRecord.currentStreak = clearedStage;
  user.towerRecord.totalClears += 1;
  if (clearedStage > user.towerRecord.bestStreak) {
    user.towerRecord.bestStreak = clearedStage;
  }
  user.towerRecord.lastPlayedAt = new Date().toISOString();
}

export function failTower(user: UserData): void {
  if (!user.towerRecord) {
    user.towerRecord = { currentStreak: 0, bestStreak: 0, totalClears: 0 };
  }
  user.towerRecord.currentStreak = 0;
  user.towerRecord.lastPlayedAt = new Date().toISOString();
  user.activeTowerRun = undefined;
}

export function grantReward(user: UserData, stage: number): StageReward {
  const reward = getStageReward(stage);
  user.points = (user.points ?? 0) + reward.points;
  user.bp = (user.bp ?? 0) + reward.bp;
  if (!user.inventory) user.inventory = {};
  for (const item of reward.items) {
    user.inventory[item.id] = (user.inventory[item.id] ?? 0) + item.amount;
  }
  return reward;
}
