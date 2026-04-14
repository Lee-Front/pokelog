import { describe, it, expect, beforeEach } from "vitest";
import { clearAllCaches, getRegion, getVariants } from "../../src/game/data-loader.js";
import { createPokemon, createWildPokemon } from "../../src/game/pokemon-factory.js";

beforeEach(() => clearAllCaches());

describe("variant encounter", () => {
  it("alola region includes regional variant encounters", () => {
    const alola = getRegion("alola");
    const variantEntries = alola.encounters.filter((e) => e.species.includes("-alola"));
    expect(variantEntries.length).toBeGreaterThanOrEqual(1);
    expect(variantEntries.some((e) => e.species === "vulpix-alola")).toBe(true);
  });

  it("galar region includes regional variant encounters", () => {
    const galar = getRegion("galar");
    const variantEntries = galar.encounters.filter((e) => e.species.includes("-galar"));
    expect(variantEntries.length).toBeGreaterThanOrEqual(1);
    expect(variantEntries.some((e) => e.species === "ponyta-galar")).toBe(true);
  });

  it("hisui region includes regional variant encounters", () => {
    const hisui = getRegion("hisui");
    const variantEntries = hisui.encounters.filter((e) => e.species.includes("-hisui"));
    expect(variantEntries.length).toBeGreaterThanOrEqual(1);
    expect(variantEntries.some((e) => e.species === "growlithe-hisui")).toBe(true);
  });

  it("createWildPokemon with variant slug sets variantId", () => {
    const wild = createWildPokemon("vulpix-alola", 10);
    expect(wild.species).toBe("vulpix");
    expect(wild.variantId).toBe("vulpix-alola");
    expect(wild.hp).toBeGreaterThan(0);
    expect(wild.nature).toBeDefined();
  });

  it("createPokemon with variant slug sets variantId", () => {
    const pokemon = createPokemon("ponyta-galar", 15);
    expect(pokemon.species).toBe("ponyta");
    expect(pokemon.variantId).toBe("ponyta-galar");
    expect(pokemon.level).toBe(15);
  });

  it("createWildPokemon with regular species has no variantId", () => {
    const wild = createWildPokemon("pikachu", 10);
    expect(wild.species).toBe("pikachu");
    expect(wild.variantId).toBeUndefined();
  });

  it("createPokemon with regular species has variantId null", () => {
    const pokemon = createPokemon("charmander", 5);
    expect(pokemon.species).toBe("charmander");
    expect(pokemon.variantId).toBeNull();
  });

  it("variant encounters have valid base species in species data", () => {
    const variants = getVariants();
    const alola = getRegion("alola");
    for (const entry of alola.encounters) {
      const variant = variants.find((v) => v.id === entry.species);
      if (variant) {
        // variant의 baseSpecies로 포켓몬 생성 가능해야 함
        const wild = createWildPokemon(entry.species, 5);
        expect(wild.species).toBe(variant.baseSpecies);
        expect(wild.variantId).toBe(variant.id);
      }
    }
  });
});
