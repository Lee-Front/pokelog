import type { PendingEvent, UserData } from "../../../../shared/types.js";
import { getConfig } from "../storage/config-store.js";
import { getRegion } from "./data-loader.js";
import { selectFromEncounters, splitEncounters } from "./encounter.js";
import { createWildPokemon } from "./pokemon-factory.js";
import { createEncounterEvent } from "./event-factory.js";
import { getPartyPokemon } from "./pokemon-state.js";

/**
 * 유저의 현재 지역 일반 출몰 풀에서 `count`마리를 가중 추첨해 미포획 인카운터 배치를 만든다.
 * 수동 탐색(/wild/search)과 자동 탐색 워커가 공유하는 순수 롤 로직 — 파티 최고 레벨 기반 야생
 * 레벨 스케일링을 그대로 적용한다(파티가 비면 종 자연 레벨대 균등 롤로 폴백).
 *
 * 전설/환상은 여기서 굴리지 않는다(일반 풀만). 게이팅된 전설 주입은 수동 전용이라 /wild/search
 * 쪽에 남겨 둔다 — 자동 탐색은 일반 풀만 굴린다.
 */
export async function rollRegionEncounters(user: UserData, count: number): Promise<PendingEvent[]> {
  const config = await getConfig();
  const regionData = getRegion(user.currentRegion ?? "default");

  // 야생 레벨 파티 스케일링 — 파티 최고 레벨 기준 ±variance(플래그 켜짐 + 파티 보유 시).
  // 파티가 비었으면 undefined로 둬 지역 levelRange 균등 롤(종 자연 레벨대)로 폴백한다.
  const party = getPartyPokemon(user);
  const partyMaxLevel = party.reduce((max, p) => Math.max(max, p.level), 0);
  const scaling = config.battle.wildLevelScaling && partyMaxLevel > 0
    ? { partyMaxLevel, variance: config.battle.wildLevelVariance }
    : undefined;

  // 전설/환상은 일반 가중 추첨에서 제외한다 — 일반 풀에서만 count 배치를 뽑는다.
  const { normal: normalPool } = splitEncounters(regionData);

  return Array.from({ length: count }, () => {
    const pick = selectFromEncounters(normalPool, Math.random, scaling);
    const wildPokemon = createWildPokemon(pick.species, pick.level);
    return createEncounterEvent(wildPokemon);
  });
}
