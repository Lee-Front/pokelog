/**
 * 업적(Achievements) 시스템 — 커밋→성장 루프에 목표를 부여한다.
 *
 * 설계 원칙: 모든 조건은 **현재 유저 상태(+ PvP 전적)에서 지연 평가(lazy)** 로 파생한다.
 * 행동별 이벤트 트래커를 두지 않으므로(포획 카운터·전투 카운터 등 별도 상태 없음), 어떤 경로로
 * 상태가 바뀌든 재계산만으로 정확하다(견고·단순). GET /game/achievements 가 호출될 때마다
 * evaluateAchievements가 미완료 업적을 검사해 충족분에 보상을 1회 지급한다(completedAchievements 가드).
 */
import type { UserData } from "../../../../shared/types.js";
import { incrementItem } from "./inventory-utils.js";

export type AchievementCategory = "collection" | "growth" | "battle" | "boss" | "activity";

/** 업적 보상 — 포인트/게임머니/아이템(인벤토리 키·수량) 조합. 전부 선택. */
export interface AchievementReward {
  points?: number;
  gameMoney?: number;
  /** item.id 는 인벤토리 키(config.shop/battleShop.items 체계, 무하이픈 볼 등 canonical). */
  item?: { id: string; qty: number };
}

/**
 * 업적 정의. current/met 는 유저 상태와 PvP 승수(pvpWins)만으로 파생하는 순수 함수다.
 *  - current: 진행도(카운트형=number, 조건형=boolean). UI 진행바/체크 표시에 쓴다.
 *  - met: 달성 여부. target 이 있으면 보통 `metric >= target`, 없으면 조건 boolean.
 * PvP 승수는 유저 파일에 없고 pvp-stats 저장소에서 오므로 두 번째 인자로 주입한다.
 */
export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  /** 카운트형 업적의 목표치(조건형 업적은 생략). */
  target?: number;
  current(user: UserData, pvpWins: number): number | boolean;
  met(user: UserData, pvpWins: number): boolean;
  reward: AchievementReward;
}

// ── 파생 지표 헬퍼(단일 출처로 current/met 불일치 방지) ─────────────────────────
function pokedexCount(user: UserData): number {
  return Array.isArray(user.pokedex) ? user.pokedex.length : 0;
}
function seenCount(user: UserData): number {
  return Array.isArray(user.seenSpecies) ? user.seenSpecies.length : 0;
}
function partySize(user: UserData): number {
  return Array.isArray(user.party) ? user.party.length : 0;
}
/** 보유 개체(파티풀 pokemon[] ∪ 보관함 storage[]) 최고 레벨. 보유 0이면 0. */
function maxOwnedLevel(user: UserData): number {
  const owned = [
    ...(Array.isArray(user.pokemon) ? user.pokemon : []),
    ...(Array.isArray(user.storage) ? user.storage : []),
  ];
  return owned.reduce((max, p) => Math.max(max, p.level ?? 0), 0);
}
/** 보유 개체 중 이로치(isShiny)가 하나라도 있으면 true. */
function hasShiny(user: UserData): boolean {
  return shinyCount(user) >= 1;
}
/** 보유 개체(파티풀 ∪ 보관함) 중 이로치(isShiny) 수. */
function shinyCount(user: UserData): number {
  const owned = [
    ...(Array.isArray(user.pokemon) ? user.pokemon : []),
    ...(Array.isArray(user.storage) ? user.storage : []),
  ];
  return owned.filter((p) => p.isShiny === true).length;
}
/** 현재 파티(6마리 슬롯) 레벨 합 — "총 전력" 지표로 정예 파티 조건에 쓴다. */
function partyLevelSum(user: UserData): number {
  const partyUids = Array.isArray(user.party) ? user.party : [];
  const pool = Array.isArray(user.pokemon) ? user.pokemon : [];
  return partyUids.reduce((sum, uid) => {
    const p = pool.find((x) => x.uid === uid);
    return sum + (p?.level ?? 0);
  }, 0);
}
/** 보유 개체(파티풀 ∪ 보관함) 중 6스탯 개체값(IV)이 전부 31(완벽 개체)인 것이 하나라도 있으면 true. */
function hasPerfectIvs(user: UserData): boolean {
  const owned = [
    ...(Array.isArray(user.pokemon) ? user.pokemon : []),
    ...(Array.isArray(user.storage) ? user.storage : []),
  ];
  return owned.some((p) => {
    const ivs = p.ivs;
    if (!ivs) return false;
    return (
      ivs.hp === 31 && ivs.attack === 31 && ivs.defense === 31
      && ivs.spAttack === 31 && ivs.spDefense === 31 && ivs.speed === 31
    );
  });
}
/** 보유 개체(파티풀 ∪ 보관함) 중 최고 친밀도(255 만점). 보유 0이면 0. */
function maxFriendship(user: UserData): number {
  const owned = [
    ...(Array.isArray(user.pokemon) ? user.pokemon : []),
    ...(Array.isArray(user.storage) ? user.storage : []),
  ];
  return owned.reduce((max, p) => Math.max(max, p.friendship ?? 0), 0);
}
/** 인벤토리 전체 아이템 수량 합(소지품 다양성/축적 지표). */
function inventoryTotalCount(user: UserData): number {
  const inv = user.inventory ?? {};
  return Object.values(inv).reduce((sum: number, n) => sum + (typeof n === "number" ? n : 0), 0);
}
/** 주간보스 통산 처치 횟수(누적). 구 저장본은 normalizeUserData가 0으로 정규화한다. */
function bossDefeatTotal(user: UserData): number {
  return typeof user.bossDefeatTotal === "number" ? user.bossDefeatTotal : 0;
}
/** 주간보스 이번 주 "선착 1위" 통산 횟수(누적). */
function bossFirstPlaceTotal(user: UserData): number {
  return typeof user.bossFirstPlaceTotal === "number" ? user.bossFirstPlaceTotal : 0;
}

/**
 * 업적 정의 목록(SSOT). 카테고리별로 묶어 선언 순서대로 UI에 노출된다.
 * 조건은 전부 지연 파생(별도 트래커 없음). 보상값은 커밋 루프 밸런스에 맞춘 보수적 기본치.
 */
export const ACHIEVEMENTS: AchievementDef[] = [
  // ── 수집(collection) ─────────────────────────────────────────────
  {
    id: "first-catch",
    name: "첫 포획",
    description: "첫 포켓몬을 도감에 등록한다.",
    category: "collection",
    current: (u) => pokedexCount(u) >= 1,
    met: (u) => pokedexCount(u) >= 1,
    reward: { points: 100 },
  },
  {
    id: "catch-10",
    name: "수집가 입문",
    description: "포켓몬 10종을 도감에 등록한다.",
    category: "collection",
    target: 10,
    current: (u) => pokedexCount(u),
    met: (u) => pokedexCount(u) >= 10,
    reward: { points: 300 },
  },
  {
    id: "catch-50",
    name: "베테랑 수집가",
    description: "포켓몬 50종을 도감에 등록한다.",
    category: "collection",
    target: 50,
    current: (u) => pokedexCount(u),
    met: (u) => pokedexCount(u) >= 50,
    reward: { points: 1000, gameMoney: 500 },
  },
  {
    id: "catch-100",
    name: "도감 마스터",
    description: "포켓몬 100종을 도감에 등록한다.",
    category: "collection",
    target: 100,
    current: (u) => pokedexCount(u),
    met: (u) => pokedexCount(u) >= 100,
    reward: { points: 2000, item: { id: "ultraball", qty: 5 } },
  },
  {
    id: "seen-100",
    name: "탐험가",
    description: "포켓몬 100종을 발견한다(만난 적 있음).",
    category: "collection",
    target: 100,
    current: (u) => seenCount(u),
    met: (u) => seenCount(u) >= 100,
    reward: { points: 800 },
  },
  {
    id: "shiny-trainer",
    name: "이로치 트레이너",
    description: "이로치(색이 다른) 포켓몬을 손에 넣는다.",
    category: "collection",
    current: (u) => hasShiny(u),
    met: (u) => hasShiny(u),
    reward: { points: 1000, item: { id: "leftovers", qty: 1 } },
  },
  {
    id: "catch-200",
    name: "전당 등재",
    description: "포켓몬 200종을 도감에 등록한다.",
    category: "collection",
    target: 200,
    current: (u) => pokedexCount(u),
    met: (u) => pokedexCount(u) >= 200,
    reward: { points: 4000, item: { id: "ultraball", qty: 10 } },
  },
  {
    id: "shiny-collector-3",
    name: "이로치 컬렉터",
    description: "이로치(색이 다른) 포켓몬을 3마리 이상 손에 넣는다.",
    category: "collection",
    target: 3,
    current: (u) => shinyCount(u),
    met: (u) => shinyCount(u) >= 3,
    reward: { points: 2500, item: { id: "wise-glasses", qty: 1 } },
  },

  // ── 육성(growth) ─────────────────────────────────────────────────
  {
    id: "max-level-50",
    name: "정예 트레이너",
    description: "포켓몬을 레벨 50까지 키운다.",
    category: "growth",
    target: 50,
    current: (u) => maxOwnedLevel(u),
    met: (u) => maxOwnedLevel(u) >= 50,
    reward: { points: 800, gameMoney: 500 },
  },
  {
    id: "max-level-100",
    name: "챔피언",
    description: "포켓몬을 레벨 100(최고 레벨)까지 키운다.",
    category: "growth",
    target: 100,
    current: (u) => maxOwnedLevel(u),
    met: (u) => maxOwnedLevel(u) >= 100,
    reward: { points: 3000, item: { id: "ability-patch", qty: 1 } },
  },
  {
    id: "full-party",
    name: "완전체 파티",
    description: "파티를 6마리로 가득 채운다.",
    category: "growth",
    target: 6,
    current: (u) => partySize(u),
    met: (u) => partySize(u) >= 6,
    reward: { points: 500 },
  },
  {
    id: "team-level-300",
    name: "정예 파티",
    description: "현재 파티 6마리의 레벨 합이 300 이상이 되도록 키운다.",
    category: "growth",
    target: 300,
    current: (u) => partyLevelSum(u),
    met: (u) => partyLevelSum(u) >= 300,
    reward: { points: 2500, gameMoney: 1500 },
  },
  {
    id: "perfect-iv",
    name: "육성의 정수",
    description: "6스탯 개체값(IV)이 전부 31인 완벽 개체를 손에 넣는다.",
    category: "growth",
    current: (u) => hasPerfectIvs(u),
    met: (u) => hasPerfectIvs(u),
    reward: { points: 2000, item: { id: "ability-capsule", qty: 1 } },
  },
  {
    id: "best-friend",
    name: "베스트 프렌드",
    description: "포켓몬 한 마리의 친밀도를 최대(255)까지 쌓는다.",
    category: "growth",
    target: 255,
    current: (u) => maxFriendship(u),
    met: (u) => maxFriendship(u) >= 255,
    reward: { points: 1500, item: { id: "leftovers", qty: 1 } },
  },

  // ── 대전(battle) ─────────────────────────────────────────────────
  {
    id: "pvp-first-win",
    name: "첫 승리",
    description: "유저 대전(PvP)에서 처음으로 승리한다.",
    category: "battle",
    current: (_u, pvpWins) => pvpWins >= 1,
    met: (_u, pvpWins) => pvpWins >= 1,
    reward: { points: 500, gameMoney: 300 },
  },
  {
    id: "pvp-10-wins",
    name: "대전의 달인",
    description: "유저 대전(PvP)에서 10승을 달성한다.",
    category: "battle",
    target: 10,
    current: (_u, pvpWins) => pvpWins,
    met: (_u, pvpWins) => pvpWins >= 10,
    reward: { points: 2000, gameMoney: 1000 },
  },
  {
    id: "pvp-25-wins",
    name: "PvP 레전드",
    description: "유저 대전(PvP)에서 25승을 달성한다.",
    category: "battle",
    target: 25,
    current: (_u, pvpWins) => pvpWins,
    met: (_u, pvpWins) => pvpWins >= 25,
    reward: { points: 5000, gameMoney: 2500, item: { id: "expert-belt", qty: 1 } },
  },

  // ── 주간보스(boss) ────────────────────────────────────────────────
  {
    id: "boss-first-clear",
    name: "첫 레이드",
    description: "주간보스를 처음으로 처치한다.",
    category: "boss",
    current: (u) => bossDefeatTotal(u) >= 1,
    met: (u) => bossDefeatTotal(u) >= 1,
    reward: { points: 500 },
  },
  {
    id: "boss-veteran",
    name: "레이드 상비군",
    description: "주간보스를 통산 5회 처치한다.",
    category: "boss",
    target: 5,
    current: (u) => bossDefeatTotal(u),
    met: (u) => bossDefeatTotal(u) >= 5,
    reward: { points: 2000, gameMoney: 1000 },
  },
  {
    id: "boss-legend",
    name: "레이드 전설",
    description: "주간보스를 통산 20회 처치한다.",
    category: "boss",
    target: 20,
    current: (u) => bossDefeatTotal(u),
    met: (u) => bossDefeatTotal(u) >= 20,
    reward: { points: 6000, gameMoney: 3000, item: { id: "focus-sash", qty: 1 } },
  },
  {
    id: "boss-first-place-1",
    name: "선착의 영광",
    description: "주간보스를 그 주 가장 먼저(1위) 처치한다.",
    category: "boss",
    current: (u) => bossFirstPlaceTotal(u) >= 1,
    met: (u) => bossFirstPlaceTotal(u) >= 1,
    reward: { points: 1500 },
  },
  {
    id: "boss-first-place-5",
    name: "만년 1등",
    description: "주간보스 1위 처치를 통산 5회 달성한다.",
    category: "boss",
    target: 5,
    current: (u) => bossFirstPlaceTotal(u),
    met: (u) => bossFirstPlaceTotal(u) >= 5,
    reward: { points: 5000, item: { id: "muscle-band", qty: 1 } },
  },

  // ── 활동(activity) ───────────────────────────────────────────────
  {
    id: "points-10k",
    name: "포인트 부자",
    description: "포인트를 10,000 이상 보유한다.",
    category: "activity",
    target: 10_000,
    current: (u) => u.points ?? 0,
    met: (u) => (u.points ?? 0) >= 10_000,
    reward: { gameMoney: 500 },
  },
  {
    id: "points-100k",
    name: "포인트 거부",
    description: "포인트를 100,000 이상 보유한다.",
    category: "activity",
    target: 100_000,
    current: (u) => u.points ?? 0,
    met: (u) => (u.points ?? 0) >= 100_000,
    reward: { gameMoney: 3000, item: { id: "ability-patch", qty: 1 } },
  },
  {
    id: "game-money-50k",
    name: "게임머니 갑부",
    description: "게임머니를 50,000 이상 보유한다.",
    category: "activity",
    target: 50_000,
    current: (u) => u.gameMoney ?? 0,
    met: (u) => (u.gameMoney ?? 0) >= 50_000,
    reward: { points: 1500 },
  },
  {
    id: "inventory-collector",
    name: "가방 정리의 달인",
    description: "인벤토리 아이템을 합계 100개 이상 보유한다.",
    category: "activity",
    target: 100,
    current: (u) => inventoryTotalCount(u),
    met: (u) => inventoryTotalCount(u) >= 100,
    reward: { points: 1000 },
  },
];

/** evaluateAchievements가 내려주는 업적 1건의 진행 상태(진행도 + 완료 플래그 + 보상 표시). */
export interface AchievementStatus {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  target?: number;
  current: number | boolean;
  completed: boolean;
  /** 이 업적의 보상(포털이 달성 전에도 보상 칩으로 표시). 지급 여부와 무관한 정적 메타. */
  reward: AchievementReward;
}

/** 이번 평가에서 실제로 지급된 보상 합계(신규 달성분만 누적). */
export interface GrantedRewards {
  points: number;
  gameMoney: number;
  items: { id: string; qty: number }[];
}

export interface EvaluateResult {
  list: AchievementStatus[];
  newlyCompleted: string[];
  rewardsGranted: GrantedRewards;
}

/**
 * 미완료 업적을 검사해 충족분에 보상을 지급하고(유저 points/gameMoney/inventory 직접 변형),
 * completedAchievements에 id를 추가한다. 이미 완료된 업적은 건너뛰므로 재호출해도 중복 지급이
 * 없다(1회성 가드 = completed 집합). 전체 업적의 진행 상태(list)와 이번에 새로 달성한 id 목록,
 * 지급된 보상 합계를 함께 반환한다.
 *
 * 순수하지 않다(user를 in-place 변형). 호출부는 newlyCompleted가 있으면 saveUser로 영속하면 된다.
 */
export function evaluateAchievements(user: UserData, pvpWins: number): EvaluateResult {
  if (!Array.isArray(user.completedAchievements)) user.completedAchievements = [];
  const completed = new Set(user.completedAchievements);
  const newlyCompleted: string[] = [];
  const rewardsGranted: GrantedRewards = { points: 0, gameMoney: 0, items: [] };

  for (const def of ACHIEVEMENTS) {
    if (completed.has(def.id)) continue;
    if (!def.met(user, pvpWins)) continue;

    const { reward } = def;
    if (reward.points) {
      user.points += reward.points;
      rewardsGranted.points += reward.points;
    }
    if (reward.gameMoney) {
      user.gameMoney += reward.gameMoney;
      rewardsGranted.gameMoney += reward.gameMoney;
    }
    if (reward.item) {
      incrementItem(user.inventory, reward.item.id, reward.item.qty);
      rewardsGranted.items.push({ id: reward.item.id, qty: reward.item.qty });
    }

    user.completedAchievements.push(def.id);
    completed.add(def.id);
    newlyCompleted.push(def.id);
  }

  // 진행 상태 목록은 보상 지급 후 계산한다 — 어떤 업적의 current/met도 points/gameMoney/inventory에
  // 의존하지 않으므로(도감·레벨·전적·경험치 기준) 지급 전후 값이 동일하다.
  const list: AchievementStatus[] = ACHIEVEMENTS.map((def) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    category: def.category,
    ...(def.target !== undefined ? { target: def.target } : {}),
    current: def.current(user, pvpWins),
    completed: completed.has(def.id),
    reward: def.reward,
  }));

  return { list, newlyCompleted, rewardsGranted };
}
