import crypto from "node:crypto";
import type { PokemonGender } from "../../../../shared/types.js";

export function resolvePokemonGender(genderRate: number | undefined, randomValue: number): PokemonGender {
  if (genderRate == null || genderRate < 0) {
    return "genderless";
  }

  if (genderRate <= 0) {
    return "male";
  }

  if (genderRate >= 8) {
    return "female";
  }

  return randomValue < (genderRate / 8) ? "female" : "male";
}

export function seededGenderRoll(seed: string): number {
  const digest = crypto.createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) / 0xFFFFFFFF;
}
