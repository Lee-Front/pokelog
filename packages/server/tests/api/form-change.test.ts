import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

describe("form-change API", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  it("changes rotom form to rotom-heat and verifies variantId", async () => {
    const { token, userId } = await t.registerAndLogin("formuser1", "charmander");
    const api = t.authed(token);

    // Give user a rotom via admin
    const give = await t.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species: "rotom",
      level: 30,
    });
    expect(give.status).toBe(200);
    const rotomUid = give.body.pokemon.uid;

    // Change form to rotom-heat
    const changeRes = await api.post("/api/game/form-change", {
      pokemonUid: rotomUid,
      targetFormId: "rotom-heat",
    });
    expect(changeRes.status).toBe(200);
    expect(changeRes.body.pokemon.variantId).toBe("rotom-heat");
    expect(changeRes.body.previousVariantId).toBeNull();

    // Verify pokemon detail shows new variant
    const detail = await api.get(`/api/game/pokemon/${rotomUid}`);
    expect(detail.status).toBe(200);
    expect(detail.body.pokemon.variantId).toBe("rotom-heat");
  });

  it("reverts rotom back to base form", async () => {
    const { token, userId } = await t.registerAndLogin("formuser2", "charmander");
    const api = t.authed(token);

    // Give user a rotom
    const give = await t.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species: "rotom",
      level: 30,
    });
    expect(give.status).toBe(200);
    const rotomUid = give.body.pokemon.uid;

    // Change to rotom-wash
    await api.post("/api/game/form-change", {
      pokemonUid: rotomUid,
      targetFormId: "rotom-wash",
    });

    // Revert to base
    const revertRes = await api.post("/api/game/form-change", {
      pokemonUid: rotomUid,
      targetFormId: null,
    });
    expect(revertRes.status).toBe(200);
    expect(revertRes.body.pokemon.variantId).toBeNull();
    expect(revertRes.body.previousVariantId).toBe("rotom-wash");

    // Verify detail
    const detail = await api.get(`/api/game/pokemon/${rotomUid}`);
    expect(detail.status).toBe(200);
    expect(detail.body.pokemon.variantId).toBeNull();
  });

  it("rejects invalid form for species", async () => {
    const { token, userId } = await t.registerAndLogin("formuser3", "charmander");
    const api = t.authed(token);

    // Give user a rotom
    const give = await t.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species: "rotom",
      level: 30,
    });
    const rotomUid = give.body.pokemon.uid;

    // Try to change to a form that doesn't belong to rotom
    const changeRes = await api.post("/api/game/form-change", {
      pokemonUid: rotomUid,
      targetFormId: "giratina-origin",
    });
    expect(changeRes.status).toBe(400);
    expect(changeRes.body.error).toContain("not a valid form");
  });

  it("rejects form change for species without rules", async () => {
    const { token } = await t.registerAndLogin("formuser4", "charmander");
    const api = t.authed(token);

    // Get the starter charmander
    const party = await api.get("/api/game/party");
    const charmanderUid = party.body.party[0].uid;

    const changeRes = await api.post("/api/game/form-change", {
      pokemonUid: charmanderUid,
      targetFormId: "rotom-heat",
    });
    expect(changeRes.status).toBe(400);
    expect(changeRes.body.error).toContain("cannot change forms");
  });

  it("GET form-change rules returns forms for rotom", async () => {
    const { token } = await t.registerAndLogin("formuser5", "charmander");
    const api = t.authed(token);

    const res = await api.get("/api/game/form-change/rules/rotom");
    expect(res.status).toBe(200);
    expect(res.body.species).toBe("rotom");
    expect(res.body.forms).toHaveLength(5);
    expect(res.body.rule.type).toBe("catalog");
  });

  it("GET form-change rules returns 404 for species without rules", async () => {
    const { token } = await t.registerAndLogin("formuser6", "charmander");
    const api = t.authed(token);

    const res = await api.get("/api/game/form-change/rules/pikachu");
    expect(res.status).toBe(404);
  });

  it("handles held-item form change with inventory", async () => {
    const { token, userId } = await t.registerAndLogin("formuser7", "charmander");
    const api = t.authed(token);

    // Give user a giratina
    const give = await t.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species: "giratina",
      level: 50,
    });
    const giratinaUid = give.body.pokemon.uid;

    // Give user the griseous orb
    await t.admin().post("/api/admin/test/give-item", {
      userId,
      item: "griseous-orb",
      quantity: 1,
    });

    // Change to origin form
    const changeRes = await api.post("/api/game/form-change", {
      pokemonUid: giratinaUid,
      targetFormId: "giratina-origin",
    });
    expect(changeRes.status).toBe(200);
    expect(changeRes.body.pokemon.variantId).toBe("giratina-origin");
    expect(changeRes.body.pokemon.heldItem).toBe("griseous-orb");

    // Verify inventory no longer has the orb
    const inv = await api.get("/api/game/inventory");
    expect(inv.body.inventory["griseous-orb"]).toBeUndefined();
  });

  it("rejects held-item form change without item in inventory", async () => {
    const { token, userId } = await t.registerAndLogin("formuser8", "charmander");
    const api = t.authed(token);

    // Give user a giratina (no orb)
    const give = await t.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species: "giratina",
      level: 50,
    });
    const giratinaUid = give.body.pokemon.uid;

    const changeRes = await api.post("/api/game/form-change", {
      pokemonUid: giratinaUid,
      targetFormId: "giratina-origin",
    });
    expect(changeRes.status).toBe(400);
    expect(changeRes.body.error).toContain("griseous-orb");
  });
});
