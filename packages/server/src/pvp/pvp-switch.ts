/**
 * Switch-in/out logic extracted from pvp-room.ts.
 *
 * Covers the shared `applySwitch` used by:
 *   - submitAction forced-switch handling
 *   - resolveTurn action dispatch (a player chose "switch")
 *   - executeFight phazing (Roar / Whirlwind / Dragon Tail)
 *
 * Preserves the prior behavior exactly:
 *   - Ability onSwitchOut/onSwitchIn hooks run
 *   - Transform state is restored onto the outgoing pokemon
 *   - Per-side "new mechanic" state (substitute, chargingMove, locks,
 *     metronome count, paradox boost, etc) is reset
 *   - Baton Pass keeps stat stages and volatiles; other switches clear them
 *   - Mega form persists if the transformation was used earlier
 *   - Paradox re-evaluates on field change
 *   - Entry hazards hit the incoming pokemon
 */
import { defaultStatStages } from "../game/battle.js";
import {
  triggerOnSwitchIn, triggerOnSwitchOut, tryActivateParadoxOnFieldChange,
} from "./pvp-abilities.js";
import { applyHazardDamage } from "./pvp-field-effects.js";
import type {
  PvpRoomState, PvpPlayerState,
} from "../../../../shared/pvp-types.js";

export function applySwitch(room: PvpRoomState, player: PvpPlayerState, index: number): void {
  if (index < 0 || index >= player.party.length) return;
  if (player.party[index].hp <= 0) return;

  // ── Ability: onSwitchOut for old pokemon ──
  const oldPoke = player.party[player.activeIndex];
  if (oldPoke.hp > 0) {
    triggerOnSwitchOut({ player, pokemon: oldPoke });
  }

  // ── Transform: restore original species/stats/moves on switch out ──
  if (player.preTransformState) {
    oldPoke.species = player.preTransformState.species;
    oldPoke.variantId = player.preTransformState.variantId ?? null;
    oldPoke.stats = player.preTransformState.stats;
    oldPoke.moves = player.preTransformState.moves;
    oldPoke.abilityId = player.preTransformState.abilityId ?? null;
    player.preTransformState = undefined;
  }

  // Reset toxic counter on the pokemon being switched out
  if (oldPoke.toxicCounter) oldPoke.toxicCounter = undefined;

  // Reset choice lock on switch
  player.lockedMoveId = undefined;

  // Reset trapping on switch
  player.trapped = false;

  // Reset new mechanic state on switch
  player.substitute = undefined;
  player.chargingMove = undefined;
  player.disabledMoveId = undefined;
  player.encoreMoveId = undefined;
  player.lastMoveUsed = undefined;
  player.lastDamageTaken = undefined;
  player.trapDamageBoost = false;
  player.metronomeCount = 0;
  player.movesUsed = [];
  player.wasHitThisTurn = false;
  // Paradox boost does NOT persist across switches (canon behavior).
  player.paradoxBoost = undefined;

  player.activeIndex = index;

  // ── Baton Pass: keep stat stages and volatiles ──
  const side = room.playerA === player ? "a" : "b";
  const isBaton = room.batonPass?.[side];
  if (!isBaton) {
    player.statStages = defaultStatStages();
    player.volatiles = [];
  } else {
    // Baton Pass: KEEP stat stages and volatiles, clear the flag
    if (room.batonPass) delete room.batonPass[side];
  }
  player.battleForm = undefined;

  // Mega form persists when switching back in
  const poke = player.party[index];
  if (poke.megaForm && player.transformationUsed && player.transformationType === "mega") {
    player.battleForm = poke.megaForm.variantId;
  }

  // ── Fake Out: mark that a switch-in happened this turn. At end of turn,
  // this promotes to justSwitchedIn=true, which Fake Out checks on the NEXT turn.
  player.switchedInThisTurn = true;

  room.log.push(`${player.nickname}: ${player.party[index].species}(으)로 교체!`);

  // ── Ability: onSwitchIn for new pokemon ──
  const opponent = player === room.playerA ? room.playerB : room.playerA;
  triggerOnSwitchIn({ room, player, opponent, pokemon: poke });
  // ── Paradox: re-check if weather/terrain was just changed by the new lead ──
  tryActivateParadoxOnFieldChange(room);

  // ── Entry hazard damage on switch-in ──
  if (poke.hp > 0) {
    applyHazardDamage(room, player, poke);
  }
}
