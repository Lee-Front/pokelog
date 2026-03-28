import crypto from "node:crypto";
import type { PendingEvent, WildPokemon } from "../../../../shared/types.js";

export function createEncounterEvent(
  wild: WildPokemon,
  timeLimitHours: number,
): PendingEvent {
  return {
    id: `evt-${crypto.randomUUID()}`,
    type: "wild_encounter",
    pokemon: wild,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + timeLimitHours * 3600000).toISOString(),
  };
}
