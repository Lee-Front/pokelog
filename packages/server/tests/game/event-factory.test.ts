import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createEncounterEvent } from "../../src/game/event-factory.js";
import type { WildPokemon } from "../../../../shared/types.js";

function makeWild(): WildPokemon {
  return {
    species: "pikachu",
    level: 10,
    hp: 30,
    maxHp: 30,
    stats: { attack: 15, defense: 12, speed: 20, spAttack: 18, spDefense: 14 },
    moves: [{ id: "thunder-shock", pp: 30, maxPp: 30 }],
  };
}

describe("createEncounterEvent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an event with an id starting with 'evt-'", () => {
    const event = createEncounterEvent(makeWild());
    expect(event.id).toMatch(/^evt-/);
  });

  it("sets the type to 'wild_encounter'", () => {
    const event = createEncounterEvent(makeWild());
    expect(event.type).toBe("wild_encounter");
  });

  it("passes through the wild pokemon", () => {
    const wild = makeWild();
    const event = createEncounterEvent(wild);
    expect(event.pokemon).toBe(wild);
  });

  it("sets createdAt to the current time", () => {
    const event = createEncounterEvent(makeWild());
    expect(event.createdAt).toBe("2026-03-15T12:00:00.000Z");
  });

  it("does not set an expiry (wild encounters no longer expire)", () => {
    const event = createEncounterEvent(makeWild());
    expect(event.expiresAt).toBeUndefined();
  });
});
