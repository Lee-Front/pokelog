/**
 * 칭호(Titles) 시스템 — 업적과 같은 지연 평가 방식으로 트레이너의 "간판"을 부여한다.
 *
 * 설계 원칙: 업적(achievements.ts)과 동일하게 모든 획득 조건은 **현재 유저 상태(+ PvP 전적 +
 * 트레이드 성사 수)에서 지연 평가(lazy)** 로 파생한다. 유저 파일에 별도 트래커를 두지 않으므로
 * 어떤 경로로 상태가 바뀌든 재계산만으로 정확하다(견고·단순). 다만 칭호는 업적과 달리 보상을
 * 지급하지 않는다 — 조건 충족(earned) 여부와 "지금 장착 중인가(active)"만 표현하는 표시 계층이다.
 * 어떤 칭호를 장착할지는 유저가 고르며(user.activeTitle), 서버는 장착 시 earned를 검증한다.
 *
 * evaluateTitles는 순수 함수다(유저를 절대 변형하지 않는다). PvP 승수·트레이드 수는 유저 파일이
 * 아니라 각각 pvp-stats/trade 저장소에서 오므로 호출부가 조회해 인자로 주입한다.
 */
import type { UserData } from "../../../../shared/types.js";
import { getSpeciesByName } from "./data-loader.js";
import { getAllSpecies } from "./pokemon-factory.js";

// ── 파생 지표 헬퍼(achievements.ts가 모듈-프라이빗이라 필요한 것만 여기 재정의) ──────────────
/** 도감(영구 기록, user.pokedex)에 등록된 종 수. */
function pokedexCount(user: UserData): number {
  return Array.isArray(user.pokedex) ? user.pokedex.length : 0;
}
/** 이로치 도감(user.shinyPokedex)에 등록된 종 수. */
function shinyPokedexCount(user: UserData): number {
  return Array.isArray(user.shinyPokedex) ? user.shinyPokedex.length : 0;
}
/** 도감에 등록된 종 중 전설/환상 종 수 — 방생해도 유지되는 "잡아본 적 있는" 지표. */
function legendaryCount(user: UserData): number {
  const dex = Array.isArray(user.pokedex) ? user.pokedex : [];
  return dex.filter((species) => {
    const data = getSpeciesByName(species);
    return data?.isLegendary || data?.isMythical;
  }).length;
}
/** 보유 개체(파티풀 pokemon[] ∪ 보관함 storage[]) 최고 레벨. 보유 0이면 0. */
function maxOwnedLevel(user: UserData): number {
  const owned = [
    ...(Array.isArray(user.pokemon) ? user.pokemon : []),
    ...(Array.isArray(user.storage) ? user.storage : []),
  ];
  return owned.reduce((max, p) => Math.max(max, p.level ?? 0), 0);
}
/** 주간보스 통산 처치 횟수(누적). 구 저장본은 normalizeUserData가 0으로 정규화한다. */
function bossDefeatTotal(user: UserData): number {
  return typeof user.bossDefeatTotal === "number" ? user.bossDefeatTotal : 0;
}

/**
 * 칭호 정의. met은 유저 상태 + PvP 승수(pvpWins) + 트레이드 성사 수(tradesCompleted)만으로
 * 파생하는 순수 함수다(획득 여부 = earned). 보상은 없다(표시 계층).
 */
export interface TitleDef {
  id: string;
  name: string;
  description: string;
  met(user: UserData, pvpWins: number, tradesCompleted: number): boolean;
}

/**
 * 칭호 정의 목록(SSOT). 선언 순서대로 UI에 노출된다. 조건은 전부 지연 파생(별도 트래커 없음).
 */
export const TITLES: TitleDef[] = [
  {
    id: "rookie",
    name: "새내기 트레이너",
    description: "포켓몬을 1종 이상 도감에 등록하면 획득한다.",
    met: (u) => pokedexCount(u) >= 1,
  },
  {
    id: "collector",
    name: "수집가",
    description: "포켓몬 100종을 도감에 등록하면 획득한다.",
    met: (u) => pokedexCount(u) >= 100,
  },
  {
    id: "dex-master",
    name: "도감 마스터",
    description: "포켓몬 300종을 도감에 등록하면 획득한다.",
    met: (u) => pokedexCount(u) >= 300,
  },
  {
    id: "poke-master",
    name: "포켓몬 마스터",
    description: "도감을 완성(모든 종 등록)하면 획득한다.",
    met: (u) => pokedexCount(u) >= getAllSpecies().length,
  },
  {
    id: "shiny-hunter",
    name: "이로치 헌터",
    description: "이로치(색이 다른) 포켓몬 10종을 도감에 등록하면 획득한다.",
    met: (u) => shinyPokedexCount(u) >= 10,
  },
  {
    id: "shiny-master",
    name: "이로치 마스터",
    description: "이로치(색이 다른) 포켓몬 50종을 도감에 등록하면 획득한다.",
    met: (u) => shinyPokedexCount(u) >= 50,
  },
  {
    id: "legend-collector",
    name: "전설 수집가",
    description: "전설/환상 포켓몬을 5종 이상 도감에 등록하면 획득한다.",
    met: (u) => legendaryCount(u) >= 5,
  },
  {
    id: "champion",
    name: "챔피언",
    description: "유저 대전(PvP)에서 25승을 달성하면 획득한다.",
    met: (_u, pvpWins) => pvpWins >= 25,
  },
  {
    id: "raid-leader",
    name: "레이드 리더",
    description: "주간보스를 통산 20회 처치하면 획득한다.",
    met: (u) => bossDefeatTotal(u) >= 20,
  },
  {
    id: "tycoon",
    name: "억만장자",
    description: "게임머니를 200,000 이상 보유하면 획득한다.",
    met: (u) => (u.gameMoney ?? 0) >= 200_000,
  },
  {
    id: "top-trainer",
    name: "최강 트레이너",
    description: "보유 포켓몬을 레벨 100(최고 레벨)까지 키우면 획득한다.",
    met: (u) => maxOwnedLevel(u) >= 100,
  },
];

/** evaluateTitles가 내려주는 칭호 1건의 상태(획득 여부 + 현재 장착 여부). */
export interface TitleStatus {
  id: string;
  name: string;
  description: string;
  earned: boolean;
  active: boolean;
}

/**
 * 모든 칭호의 획득/장착 상태를 계산한다. earned=met(조건 충족), active=지금 장착 중이며 획득한 칭호.
 * 순수 함수 — user를 절대 변형하지 않는다. activeTitle이 미획득 칭호를 가리키면 active=false로 낮춘다
 * (장착은 서버가 검증하지만, 여기서도 earned를 곱해 표시 정합을 보장한다).
 */
export function evaluateTitles(
  user: UserData,
  pvpWins: number,
  tradesCompleted: number,
  activeTitle: string | null,
): TitleStatus[] {
  return TITLES.map((def) => {
    const earned = def.met(user, pvpWins, tradesCompleted);
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      earned,
      active: def.id === activeTitle && earned,
    };
  });
}
