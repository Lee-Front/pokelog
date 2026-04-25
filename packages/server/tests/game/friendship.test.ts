import { describe, it, expect } from "vitest";
import {
  adjustFriendship, adjustFriendshipBulk,
  FRIENDSHIP_MAX, FRIENDSHIP_MIN,
} from "../../src/game/friendship.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import { getSpeciesByName } from "../../src/game/data-loader.js";

describe("adjustFriendship", () => {
  it("level-up increases friendship by 5", () => {
    const poke = createPokemon("pikachu", 5);
    poke.friendship = 70;
    adjustFriendship(poke, "level-up");
    expect(poke.friendship).toBe(75);
  });

  it("vitamin increases friendship by 5", () => {
    const poke = createPokemon("pikachu", 5);
    poke.friendship = 100;
    adjustFriendship(poke, "vitamin");
    expect(poke.friendship).toBe(105);
  });

  it("heal-item increases friendship by 1", () => {
    const poke = createPokemon("pikachu", 5);
    poke.friendship = 100;
    adjustFriendship(poke, "heal-item");
    expect(poke.friendship).toBe(101);
  });

  it("pve-win increases friendship by 1", () => {
    const poke = createPokemon("pikachu", 5);
    poke.friendship = 100;
    adjustFriendship(poke, "pve-win");
    expect(poke.friendship).toBe(101);
  });

  it("pvp-win increases friendship by 2", () => {
    const poke = createPokemon("pikachu", 5);
    poke.friendship = 100;
    adjustFriendship(poke, "pvp-win");
    expect(poke.friendship).toBe(102);
  });

  it("tower-clear increases friendship by 3", () => {
    const poke = createPokemon("pikachu", 5);
    poke.friendship = 100;
    adjustFriendship(poke, "tower-clear");
    expect(poke.friendship).toBe(103);
  });

  it("faint decreases friendship by 5", () => {
    const poke = createPokemon("pikachu", 5);
    poke.friendship = 100;
    adjustFriendship(poke, "faint");
    expect(poke.friendship).toBe(95);
  });

  it("caps at 255", () => {
    const poke = createPokemon("pikachu", 5);
    poke.friendship = 254;
    adjustFriendship(poke, "vitamin");
    expect(poke.friendship).toBe(FRIENDSHIP_MAX);
    adjustFriendship(poke, "vitamin");
    expect(poke.friendship).toBe(FRIENDSHIP_MAX);
    adjustFriendship(poke, "level-up");
    expect(poke.friendship).toBe(FRIENDSHIP_MAX);
  });

  it("floors at 0", () => {
    const poke = createPokemon("pikachu", 5);
    poke.friendship = 3;
    adjustFriendship(poke, "faint");
    expect(poke.friendship).toBe(FRIENDSHIP_MIN);
    adjustFriendship(poke, "faint");
    expect(poke.friendship).toBe(FRIENDSHIP_MIN);
  });

  it("trade-received resets to baseHappiness", () => {
    const poke = createPokemon("pikachu", 5);
    poke.friendship = 200;
    const expected = getSpeciesByName("pikachu")?.baseHappiness ?? 70;
    adjustFriendship(poke, "trade-received");
    expect(poke.friendship).toBe(expected);
  });

  it("trade-received resets even when current friendship is below baseHappiness", () => {
    const poke = createPokemon("snorlax", 5);
    poke.friendship = 0;
    const expected = getSpeciesByName("snorlax")?.baseHappiness ?? 70;
    adjustFriendship(poke, "trade-received");
    expect(poke.friendship).toBe(expected);
  });

  it("uses default baseline 70 when friendship field is undefined", () => {
    const poke = createPokemon("pikachu", 5);
    delete (poke as Partial<typeof poke>).friendship;
    const next = adjustFriendship(poke, "level-up");
    expect(next).toBe(75);
    expect(poke.friendship).toBe(75);
  });

  it("returns the new value", () => {
    const poke = createPokemon("pikachu", 5);
    poke.friendship = 100;
    expect(adjustFriendship(poke, "level-up")).toBe(105);
  });
});

describe("adjustFriendshipBulk", () => {
  it("applies the event to every alive pokemon", () => {
    const a = createPokemon("pikachu", 5);
    const b = createPokemon("charmander", 5);
    a.friendship = 100;
    b.friendship = 100;
    adjustFriendshipBulk([a, b], "pvp-win");
    expect(a.friendship).toBe(102);
    expect(b.friendship).toBe(102);
  });

  it("skips fainted pokemon", () => {
    const a = createPokemon("pikachu", 5);
    const b = createPokemon("charmander", 5);
    a.friendship = 100;
    b.friendship = 100;
    a.hp = 0;
    adjustFriendshipBulk([a, b], "pvp-win");
    expect(a.friendship).toBe(100);
    expect(b.friendship).toBe(102);
  });

  it("clamps within [0, 255] for each member", () => {
    const a = createPokemon("pikachu", 5);
    const b = createPokemon("charmander", 5);
    a.friendship = 254;
    b.friendship = 1;
    adjustFriendshipBulk([a, b], "tower-clear");
    expect(a.friendship).toBe(FRIENDSHIP_MAX);
    expect(b.friendship).toBe(4);
  });
});
