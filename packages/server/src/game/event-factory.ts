import crypto from "node:crypto";
import type { PendingEvent, WildPokemon } from "../../../../shared/types.js";

export function createEncounterEvent(wild: WildPokemon): PendingEvent {
  // 야생 조우는 더 이상 만료되지 않는다(자유 지역 롤로 보드를 통째로 교체).
  // expiresAt은 선택 필드가 되어 생략한다.
  return {
    id: `evt-${crypto.randomUUID()}`,
    type: "wild_encounter",
    pokemon: wild,
    createdAt: new Date().toISOString(),
  };
}
