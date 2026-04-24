/**
 * End-of-turn processing extracted from pvp-room.ts.
 *
 * Called by pvp-room.ts AFTER both attacks resolve and AFTER pending-switch
 * redirection. Runs in a fixed order so tests and behavior match the prior
 * inline implementation exactly:
 *
 *   1. Yawn countdown  → sleep on tick 0 (before tickVolatiles runs)
 *   2. Per-pokemon status/volatile damage loop
 *        - Toxic (escalating), normal EOT (poison/burn/leech/etc)
 *        - Curse, Binding Band extra trap, Salt Cure, Syrup Bomb
 *        - tickVolatiles → clears trap/trapDamageBoost
 *        - Ability EOT (triggerEndOfTurn)
 *        - Item EOT (triggerItemEndOfTurn)
 *   3. Disable / Encore expiry cleanup
 *   4. Weather damage + weather tick
 *   5. Grassy Terrain heal + terrain tick
 *   6. Weather-based form changes
 *   7. Gigantamax/Dynamax countdown
 *   8. Clear flinch volatiles
 *   9. Perish Song countdown
 *  10. Screen tick (Reflect / Light Screen / Aurora Veil)
 *  11. Trick Room / Magic Room / Wonder Room ticks
 *  12. Tailwind tick
 *  13. Wish countdown
 */
import { applyStatChanges } from "../game/battle.js";
import { getEffectiveTypes } from "../game/pokemon-state.js";
import {
  applyEndOfTurn, tickVolatiles, rollSleepTurns, hasVolatile,
} from "../game/status-conditions.js";
import { getWeatherDamage, tickWeather } from "../game/weather.js";
import { checkWeatherForm } from "../game/battle-forms.js";
import {
  triggerEndOfTurn,
} from "./pvp-abilities.js";
import { triggerItemEndOfTurn } from "./pvp-items.js";
import { isGrounded, TERRAIN_NAMES } from "./pvp-field-effects.js";
import type {
  PvpRoomState,
} from "../../../../shared/pvp-types.js";

/**
 * Run every end-of-turn effect in canonical order. Mutates `room` in place
 * and appends log lines to `room.log`. Does not change phase / turn counter
 * (pvp-room.ts handles that after faint checks).
 */
export function applyEndOfTurnEffects(room: PvpRoomState): void {
  // ── Yawn countdown: put to sleep (checked BEFORE tickVolatiles) ──
  for (const player of [room.playerA, room.playerB]) {
    const poke = player.party[player.activeIndex];
    if (poke.hp <= 0) continue;
    const yawnVol = player.volatiles.find(v => v.id === "yawn");
    if (yawnVol && yawnVol.turnsRemaining <= 1 && !poke.statusCondition) {
      poke.statusCondition = "sleep";
      poke.sleepTurns = rollSleepTurns();
      room.log.push(`${player.nickname}의 ${poke.species}: 잠들어 버렸다!`);
      player.volatiles = player.volatiles.filter(v => v.id !== "yawn");
    }
  }

  // ── End-of-turn effects (status damage, volatile tick) ──
  for (const player of [room.playerA, room.playerB]) {
    const poke = player.party[player.activeIndex];
    if (poke.hp <= 0) continue;
    const opp = player === room.playerA ? room.playerB : room.playerA;
    const oppPoke = opp.party[opp.activeIndex];

    // ── Ability: Magic Guard skips all indirect damage ──
    const hasMagicGuard = poke.abilityId === "magic-guard";

    // ── Toxic: escalating poison damage (poison-heal skips damage, magic-guard skips damage) ──
    if (poke.statusCondition === "poison" && poke.toxicCounter != null && poke.toxicCounter > 0) {
      if (!hasMagicGuard && poke.abilityId !== "poison-heal") {
        const toxicDmg = Math.max(1, Math.floor(poke.maxHp * poke.toxicCounter / 16));
        poke.hp = Math.max(0, poke.hp - toxicDmg);
        room.log.push(`${player.nickname}의 ${poke.species}: 독 데미지 ${toxicDmg}!`);
      }
      poke.toxicCounter += 1;

      // Still apply non-poison end-of-turn (trap, leech seed, etc.)
      if (!hasMagicGuard) {
        const eot = applyEndOfTurn(null, player.volatiles, poke.maxHp, oppPoke.maxHp);
        const healBlocked = hasVolatile(player.volatiles, "heal-block");
        if (eot.damage > 0) poke.hp = Math.max(0, poke.hp - eot.damage);
        if (eot.healing > 0 && !healBlocked) poke.hp = Math.min(poke.maxHp, poke.hp + eot.healing);
        if (eot.opponentHealing > 0 && oppPoke.hp > 0) {
          oppPoke.hp = Math.min(oppPoke.maxHp, oppPoke.hp + eot.opponentHealing);
        }
        for (const msg of eot.messages) {
          room.log.push(`${player.nickname}의 ${poke.species}: ${msg}`);
        }
      }
      if (poke.hp <= 0) {
        room.log.push(`${player.nickname}의 ${poke.species}이(가) 쓰러졌다!`);
      }
    } else {
      // Normal end-of-turn (existing code)
      if (!hasMagicGuard) {
        const eot = applyEndOfTurn(poke.statusCondition, player.volatiles, poke.maxHp, oppPoke.maxHp);
        const healBlocked = hasVolatile(player.volatiles, "heal-block");
        if (eot.damage > 0) {
          poke.hp = Math.max(0, poke.hp - eot.damage);
        }
        if (eot.healing > 0 && !healBlocked) {
          poke.hp = Math.min(poke.maxHp, poke.hp + eot.healing);
        }
        if (eot.opponentHealing > 0 && oppPoke.hp > 0) {
          oppPoke.hp = Math.min(oppPoke.maxHp, oppPoke.hp + eot.opponentHealing);
        }
        for (const msg of eot.messages) {
          room.log.push(`${player.nickname}의 ${poke.species}: ${msg}`);
        }
      }
      if (poke.hp <= 0) {
        room.log.push(`${player.nickname}의 ${poke.species}이(가) 쓰러졌다!`);
      }
    }

    // ── Curse end-of-turn damage (1/4 maxHp for cursed pokemon, unless magic-guard) ──
    if (poke.hp > 0 && !hasMagicGuard && hasVolatile(player.volatiles, "curse")) {
      const curseDmg = Math.max(1, Math.floor(poke.maxHp / 4));
      poke.hp = Math.max(0, poke.hp - curseDmg);
      room.log.push(`${player.nickname}의 ${poke.species}: 저주로 ${curseDmg} 데미지!`);
      if (poke.hp <= 0) {
        room.log.push(`${player.nickname}의 ${poke.species}이(가) 쓰러졌다!`);
      }
    }

    // ── Binding Band: extra trap damage so the total becomes 1/6 maxHp (base 1/8 + extra 1/24) ──
    if (poke.hp > 0 && !hasMagicGuard && player.trapDamageBoost && hasVolatile(player.volatiles, "trap")) {
      const extra = Math.max(1, Math.floor(poke.maxHp / 24));
      poke.hp = Math.max(0, poke.hp - extra);
      room.log.push(`${player.nickname}의 ${poke.species}: 바인드밴드로 추가 ${extra} 데미지!`);
      if (poke.hp <= 0) {
        room.log.push(`${player.nickname}의 ${poke.species}이(가) 쓰러졌다!`);
      }
    }

    // ── Gen 9: Salt Cure end-of-turn damage (1/8, doubled to 1/4 on Steel/Water) ──
    if (poke.hp > 0 && !hasMagicGuard && hasVolatile(player.volatiles, "salt-cure")) {
      const types = getEffectiveTypes(poke.species, poke.variantId, player.battleForm);
      const denom = types.includes("steel") || types.includes("water") ? 4 : 8;
      const saltDmg = Math.max(1, Math.floor(poke.maxHp / denom));
      poke.hp = Math.max(0, poke.hp - saltDmg);
      room.log.push(`${player.nickname}의 ${poke.species}: 소금절임 데미지 ${saltDmg}!`);
      if (poke.hp <= 0) {
        room.log.push(`${player.nickname}의 ${poke.species}이(가) 쓰러졌다!`);
      }
    }

    // ── Gen 9: Syrup Bomb — speed drops each turn while the volatile ticks ──
    if (poke.hp > 0 && hasVolatile(player.volatiles, "syrup-bomb")) {
      player.statStages = applyStatChanges(player.statStages, [{ stat: "speed", change: -1 }]);
      room.log.push(`${player.nickname}의 ${poke.species}: 시럽폭탄으로 스피드가 내려갔다!`);
    }

    // Tick volatiles
    player.volatiles = tickVolatiles(player.volatiles);

    // ── Clear trap-related side state once the trap volatile is gone ──
    if (!hasVolatile(player.volatiles, "trap") && player.trapDamageBoost) {
      player.trapDamageBoost = false;
    }

    // ── Ability: end-of-turn effects ──
    if (poke.hp > 0) {
      triggerEndOfTurn({ room, player, opponent: opp, pokemon: poke });
    }

    // ── Item: end-of-turn effects (leftovers, flame-orb, etc.) ──
    if (poke.hp > 0) {
      triggerItemEndOfTurn({ room, player, opponent: opp, pokemon: poke });
    }
  }

  // ── Disable / Encore volatile expiry cleanup ──
  for (const player of [room.playerA, room.playerB]) {
    if (player.disabledMoveId && !hasVolatile(player.volatiles, "disable")) {
      player.disabledMoveId = undefined;
    }
    if (player.encoreMoveId && !hasVolatile(player.volatiles, "encore")) {
      player.encoreMoveId = undefined;
    }
  }

  // ── Weather end-of-turn ──
  if (room.weather) {
    for (const player of [room.playerA, room.playerB]) {
      const poke = player.party[player.activeIndex];
      if (poke.hp <= 0) continue;
      // ── Ability: Magic Guard skips weather damage ──
      if (poke.abilityId === "magic-guard") continue;
      // ── Item: Safety Goggles skips weather damage ──
      if (poke.heldItem === "safety-goggles") continue;
      // ── Item: Utility Umbrella blocks weather effects ──
      if (poke.heldItem === "utility-umbrella") continue;
      const types = getEffectiveTypes(poke.species, poke.variantId, player.battleForm);
      const weatherDmg = getWeatherDamage(room.weather, types, poke.maxHp);
      if (weatherDmg > 0) {
        poke.hp = Math.max(0, poke.hp - weatherDmg);
        room.log.push(`${player.nickname}의 ${poke.species}: 날씨로 ${weatherDmg} 데미지!`);
        if (poke.hp <= 0) {
          room.log.push(`${player.nickname}의 ${poke.species}이(가) 쓰러졌다!`);
        }
      }
    }
    const tick = tickWeather(room.weather, room.weatherTurns);
    room.weather = tick.weather;
    room.weatherTurns = tick.turns;
    if (tick.expired) {
      room.log.push("날씨가 사라졌다!");
    }
  }

  // ── Grassy Terrain: heal grounded pokemon each turn ──
  if (room.terrain === "grassy") {
    for (const player of [room.playerA, room.playerB]) {
      const poke = player.party[player.activeIndex];
      if (poke.hp > 0 && isGrounded(poke, player)) {
        const heal = Math.max(1, Math.floor(poke.maxHp / 16));
        poke.hp = Math.min(poke.maxHp, poke.hp + heal);
        room.log.push(`${player.nickname}의 ${poke.species}: 그래스필드로 HP 회복!`);
      }
    }
  }

  // ── Terrain tick ──
  if (room.terrain && room.terrainTurns != null) {
    room.terrainTurns -= 1;
    if (room.terrainTurns <= 0) {
      room.log.push(`${TERRAIN_NAMES[room.terrain]}이(가) 사라졌다!`);
      room.terrain = undefined;
      room.terrainTurns = undefined;
    }
  }

  // ── Weather-based form changes (Castform, Cherrim) ──
  for (const player of [room.playerA, room.playerB]) {
    const poke = player.party[player.activeIndex];
    if (poke.hp <= 0) continue;
    const weatherForm = checkWeatherForm(poke.species, room.weather, player.battleForm ?? poke.variantId ?? null);
    if (weatherForm) {
      player.battleForm = weatherForm.newForm;
      room.log.push(`${player.nickname}의 ${poke.species}: ${weatherForm.message}`);
    }
  }

  // ── Gigantamax / Dynamax countdown ──
  for (const player of [room.playerA, room.playerB]) {
    if ((player.transformationType === "gigantamax" || player.transformationType === "dynamax") && player.gmaxTurnsRemaining != null) {
      player.gmaxTurnsRemaining -= 1;
      if (player.gmaxTurnsRemaining <= 0) {
        const poke = player.party[player.activeIndex];
        const wasDynamax = player.transformationType === "dynamax";
        if (player.preTransformMaxHp != null && poke.hp > 0) {
          const hpRatio = poke.hp / poke.maxHp;
          poke.maxHp = player.preTransformMaxHp;
          poke.hp = Math.max(1, Math.floor(hpRatio * poke.maxHp));
        } else if (player.preTransformMaxHp != null && poke.hp <= 0) {
          poke.maxHp = player.preTransformMaxHp; // don't resurrect
        }
        player.battleForm = undefined;
        player.transformationType = null;
        player.gmaxTurnsRemaining = undefined;
        player.preTransformMaxHp = undefined;
        if (poke.hp > 0) {
          room.log.push(`${player.nickname}의 ${poke.species}: ${wasDynamax ? "다이맥스" : "기가맥스"}가 풀렸다!`);
        }
      }
    }
  }

  // ── Clear flinch volatiles at end of turn ──
  room.playerA.volatiles = room.playerA.volatiles.filter(v => v.id !== "flinch");
  room.playerB.volatiles = room.playerB.volatiles.filter(v => v.id !== "flinch");

  // ── Perish Song countdown ──
  for (const player of [room.playerA, room.playerB]) {
    const poke = player.party[player.activeIndex];
    if (poke.hp <= 0) continue;
    const perishVol = player.volatiles.find(v => v.id === "perish-song");
    if (perishVol) {
      if (perishVol.turnsRemaining <= 1) {
        poke.hp = 0;
        room.log.push(`${player.nickname}의 ${poke.species}: 멸망의 카운트가 0이 되었다!`);
        player.volatiles = player.volatiles.filter(v => v.id !== "perish-song");
      } else {
        room.log.push(`${player.nickname}의 ${poke.species}: 멸망의 카운트 ${perishVol.turnsRemaining - 1}!`);
      }
    }
  }

  // ── Screen tick (Reflect, Light Screen, Aurora Veil) ──
  for (const player of [room.playerA, room.playerB]) {
    if (player.screens) {
      if (player.screens.reflect) {
        player.screens.reflect--;
        if (player.screens.reflect <= 0) {
          delete player.screens.reflect;
          room.log.push(`${player.nickname}: 리플렉터가 사라졌다!`);
        }
      }
      if (player.screens.lightScreen) {
        player.screens.lightScreen--;
        if (player.screens.lightScreen <= 0) {
          delete player.screens.lightScreen;
          room.log.push(`${player.nickname}: 빛의장막이 사라졌다!`);
        }
      }
      if (player.screens.auroraVeil) {
        player.screens.auroraVeil--;
        if (player.screens.auroraVeil <= 0) {
          delete player.screens.auroraVeil;
          room.log.push(`${player.nickname}: 오로라베일이 사라졌다!`);
        }
      }
    }
  }

  // ── Trick Room tick ──
  if (room.trickRoom && room.trickRoom > 0) {
    room.trickRoom--;
    if (room.trickRoom <= 0) {
      room.trickRoom = undefined;
      room.log.push("트릭룸이 해제됐다!");
    }
  }

  // ── Magic Room tick ──
  if (room.magicRoom && room.magicRoom > 0) {
    room.magicRoom--;
    if (room.magicRoom <= 0) {
      room.magicRoom = undefined;
      room.log.push("매직룸이 해제됐다!");
    }
  }

  // ── Wonder Room tick ──
  if (room.wonderRoom && room.wonderRoom > 0) {
    room.wonderRoom--;
    if (room.wonderRoom <= 0) {
      room.wonderRoom = undefined;
      room.log.push("원더룸이 해제됐다!");
    }
  }

  // ── Tailwind tick ──
  for (const player of [room.playerA, room.playerB]) {
    if (player.tailwind && player.tailwind > 0) {
      player.tailwind--;
      if (player.tailwind <= 0) {
        player.tailwind = undefined;
        room.log.push(`${player.nickname}: 순풍이 그쳤다!`);
      }
    }
  }

  // ── Wish countdown (heal 2 turns after set) ──
  for (const player of [room.playerA, room.playerB]) {
    if (player.wish) {
      player.wish.turns--;
      if (player.wish.turns <= 0) {
        const targetPoke = player.party[player.wish.targetIndex];
        if (targetPoke && targetPoke.hp > 0) {
          if (hasVolatile(player.volatiles, "heal-block")) {
            room.log.push(`${player.nickname}의 ${targetPoke.species}: 회복봉인으로 회복할 수 없다!`);
          } else {
            targetPoke.hp = Math.min(targetPoke.maxHp, targetPoke.hp + player.wish.healAmount);
            room.log.push(`${player.nickname}의 ${targetPoke.species}: 바라기로 HP를 회복했다!`);
          }
        }
        player.wish = undefined;
      }
    }
  }
}
