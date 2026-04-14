import { describe, it, expect } from "vitest";
import {
  checkPostAttackForm,
  checkHpThresholdForm,
  checkTurnForm,
  checkWeatherForm,
  checkFirstHitForm,
  checkPostSurfForm,
  checkMoveForm,
  getBattleEndForm,
} from "../../src/game/battle-forms.js";

describe("battle-forms", () => {
  describe("checkPostAttackForm (aegislash)", () => {
    it("physical attack switches to blade form", () => {
      const result = checkPostAttackForm("aegislash", "physical", null);
      expect(result).not.toBeNull();
      expect(result!.newForm).toBe("aegislash-blade");
    });

    it("special attack switches to blade form", () => {
      const result = checkPostAttackForm("aegislash", "special", null);
      expect(result).not.toBeNull();
      expect(result!.newForm).toBe("aegislash-blade");
    });

    it("status move switches to shield form", () => {
      const result = checkPostAttackForm("aegislash", "status", "aegislash-blade");
      expect(result).not.toBeNull();
      expect(result!.newForm).toBeNull();
    });

    it("returns null if already in blade form", () => {
      expect(checkPostAttackForm("aegislash", "physical", "aegislash-blade")).toBeNull();
    });

    it("returns null if already in shield form for status", () => {
      expect(checkPostAttackForm("aegislash", "status", null)).toBeNull();
    });

    it("returns null for non-aegislash", () => {
      expect(checkPostAttackForm("pikachu", "physical", null)).toBeNull();
    });
  });

  describe("checkHpThresholdForm", () => {
    describe("wishiwashi", () => {
      it("switches to school form when HP>25% and level>=20", () => {
        const result = checkHpThresholdForm("wishiwashi", 80, 100, 20, null);
        expect(result).not.toBeNull();
        expect(result!.newForm).toBe("wishiwashi-school");
      });

      it("reverts to solo when HP<=25%", () => {
        const result = checkHpThresholdForm("wishiwashi", 25, 100, 20, "wishiwashi-school");
        expect(result).not.toBeNull();
        expect(result!.newForm).toBeNull();
      });

      it("stays solo when level<20 even with high HP", () => {
        // Already in solo form (null), level too low -> no change needed, returns null
        const result = checkHpThresholdForm("wishiwashi", 80, 100, 19, null);
        expect(result).toBeNull();
      });

      it("reverts to solo when level<20 and currently in school form", () => {
        // In school form but level too low -> revert to solo
        const result = checkHpThresholdForm("wishiwashi", 80, 100, 19, "wishiwashi-school");
        expect(result).not.toBeNull();
        expect(result!.newForm).toBeNull();
      });

      it("returns null if already in correct form", () => {
        expect(checkHpThresholdForm("wishiwashi", 80, 100, 20, "wishiwashi-school")).toBeNull();
      });
    });

    describe("minior", () => {
      it("switches to core when HP<=50%", () => {
        const result = checkHpThresholdForm("minior", 50, 100, 30, null);
        expect(result).not.toBeNull();
        expect(result!.newForm).toBe("minior-core");
      });

      it("reverts to meteor when HP>50%", () => {
        const result = checkHpThresholdForm("minior", 51, 100, 30, "minior-core");
        expect(result).not.toBeNull();
        expect(result!.newForm).toBeNull();
      });

      it("returns null if already in correct form", () => {
        expect(checkHpThresholdForm("minior", 50, 100, 30, "minior-core")).toBeNull();
      });
    });

    describe("darmanitan", () => {
      it("switches to zen when HP<=50%", () => {
        const result = checkHpThresholdForm("darmanitan", 50, 100, 35, null);
        expect(result).not.toBeNull();
        expect(result!.newForm).toBe("darmanitan-zen");
      });

      it("reverts when HP>50%", () => {
        const result = checkHpThresholdForm("darmanitan", 51, 100, 35, "darmanitan-zen");
        expect(result).not.toBeNull();
        expect(result!.newForm).toBeNull();
      });
    });

    describe("zygarde", () => {
      it("switches to complete when HP<=50%", () => {
        const result = checkHpThresholdForm("zygarde", 50, 100, 50, null);
        expect(result).not.toBeNull();
        expect(result!.newForm).toBe("zygarde-complete");
      });

      it("does not revert when HP>50% (power construct stays)", () => {
        expect(checkHpThresholdForm("zygarde", 51, 100, 50, "zygarde-complete")).toBeNull();
      });
    });

    it("returns null for non-threshold species", () => {
      expect(checkHpThresholdForm("pikachu", 50, 100, 50, null)).toBeNull();
    });
  });

  describe("checkTurnForm (morpeko)", () => {
    it("switches to hangry on odd turns", () => {
      const result = checkTurnForm("morpeko", 1, null);
      expect(result).not.toBeNull();
      expect(result!.newForm).toBe("morpeko-hangry");
    });

    it("switches back to full-belly on even turns", () => {
      const result = checkTurnForm("morpeko", 2, "morpeko-hangry");
      expect(result).not.toBeNull();
      expect(result!.newForm).toBeNull();
    });

    it("alternates correctly over several turns", () => {
      let form: string | null = null;
      for (let turn = 1; turn <= 4; turn++) {
        const result = checkTurnForm("morpeko", turn, form);
        if (result) form = result.newForm;
        if (turn % 2 === 1) {
          expect(form).toBe("morpeko-hangry");
        } else {
          expect(form).toBeNull();
        }
      }
    });

    it("returns null for non-morpeko", () => {
      expect(checkTurnForm("pikachu", 1, null)).toBeNull();
    });

    it("returns null if already in correct form", () => {
      expect(checkTurnForm("morpeko", 1, "morpeko-hangry")).toBeNull();
      expect(checkTurnForm("morpeko", 2, null)).toBeNull();
    });
  });

  describe("checkWeatherForm", () => {
    describe("castform", () => {
      it("sun sets sunny form", () => {
        const result = checkWeatherForm("castform", "sun", null);
        expect(result).not.toBeNull();
        expect(result!.newForm).toBe("castform-sunny");
      });

      it("rain sets rainy form", () => {
        const result = checkWeatherForm("castform", "rain", null);
        expect(result).not.toBeNull();
        expect(result!.newForm).toBe("castform-rainy");
      });

      it("hail sets snowy form", () => {
        const result = checkWeatherForm("castform", "hail", null);
        expect(result).not.toBeNull();
        expect(result!.newForm).toBe("castform-snowy");
      });

      it("no weather reverts to base", () => {
        const result = checkWeatherForm("castform", undefined, "castform-sunny");
        expect(result).not.toBeNull();
        expect(result!.newForm).toBeNull();
      });

      it("sandstorm reverts to base", () => {
        const result = checkWeatherForm("castform", "sandstorm", "castform-rainy");
        expect(result).not.toBeNull();
        expect(result!.newForm).toBeNull();
      });

      it("returns null if already in correct form", () => {
        expect(checkWeatherForm("castform", "sun", "castform-sunny")).toBeNull();
      });

      it("returns null if already base with no weather", () => {
        expect(checkWeatherForm("castform", undefined, null)).toBeNull();
      });
    });

    describe("cherrim", () => {
      it("sun sets sunshine form", () => {
        const result = checkWeatherForm("cherrim", "sun", null);
        expect(result).not.toBeNull();
        expect(result!.newForm).toBe("cherrim-sunshine");
      });

      it("non-sun reverts to base", () => {
        const result = checkWeatherForm("cherrim", "rain", "cherrim-sunshine");
        expect(result).not.toBeNull();
        expect(result!.newForm).toBeNull();
      });

      it("returns null if already in correct form", () => {
        expect(checkWeatherForm("cherrim", "sun", "cherrim-sunshine")).toBeNull();
      });
    });

    it("returns null for non-weather-form species", () => {
      expect(checkWeatherForm("pikachu", "sun", null)).toBeNull();
    });
  });

  describe("checkFirstHitForm (eiscue)", () => {
    it("physical hit switches to noice face", () => {
      const result = checkFirstHitForm("eiscue", null, true);
      expect(result).not.toBeNull();
      expect(result!.newForm).toBe("eiscue-noice");
    });

    it("returns null if already noice face", () => {
      expect(checkFirstHitForm("eiscue", "eiscue-noice", true)).toBeNull();
    });

    it("returns null for non-physical hit", () => {
      expect(checkFirstHitForm("eiscue", null, false)).toBeNull();
    });

    it("returns null for non-eiscue", () => {
      expect(checkFirstHitForm("pikachu", null, true)).toBeNull();
    });
  });

  describe("checkPostSurfForm (cramorant)", () => {
    it("gulping form when HP>50%", () => {
      const result = checkPostSurfForm("cramorant", 60, 100);
      expect(result).not.toBeNull();
      expect(result!.newForm).toBe("cramorant-gulping");
    });

    it("gorging form when HP<=50%", () => {
      const result = checkPostSurfForm("cramorant", 50, 100);
      expect(result).not.toBeNull();
      expect(result!.newForm).toBe("cramorant-gorging");
    });

    it("returns null for non-cramorant", () => {
      expect(checkPostSurfForm("pikachu", 50, 100)).toBeNull();
    });
  });

  describe("checkMoveForm (meloetta)", () => {
    it("relic-song toggles from aria to pirouette", () => {
      const result = checkMoveForm("meloetta", "relic-song", null);
      expect(result).not.toBeNull();
      expect(result!.newForm).toBe("meloetta-pirouette");
    });

    it("relic-song toggles from pirouette to aria", () => {
      const result = checkMoveForm("meloetta", "relic-song", "meloetta-pirouette");
      expect(result).not.toBeNull();
      expect(result!.newForm).toBeNull();
    });

    it("non-relic-song does nothing", () => {
      expect(checkMoveForm("meloetta", "tackle", null)).toBeNull();
    });

    it("returns null for non-meloetta", () => {
      expect(checkMoveForm("pikachu", "relic-song", null)).toBeNull();
    });
  });

  describe("getBattleEndForm", () => {
    it("returns null (base form) for battle form species", () => {
      expect(getBattleEndForm("aegislash")).toBeNull();
      expect(getBattleEndForm("morpeko")).toBeNull();
      expect(getBattleEndForm("meloetta")).toBeNull();
      expect(getBattleEndForm("castform")).toBeNull();
      expect(getBattleEndForm("cherrim")).toBeNull();
      expect(getBattleEndForm("wishiwashi")).toBeNull();
      expect(getBattleEndForm("minior")).toBeNull();
      expect(getBattleEndForm("zygarde")).toBeNull();
      expect(getBattleEndForm("darmanitan")).toBeNull();
      expect(getBattleEndForm("cramorant")).toBeNull();
      expect(getBattleEndForm("eiscue")).toBeNull();
    });

    it("returns undefined for non-battle-form species", () => {
      expect(getBattleEndForm("pikachu")).toBeUndefined();
      expect(getBattleEndForm("charizard")).toBeUndefined();
    });
  });
});
