import { apiGet } from "../api-client.js";
import { renderPokemonArt, renderHpBar } from "../ui/display.js";

export async function pokemonCommand(uid: string) {
  const res = await apiGet(`/api/game/pokemon/${uid}`);
  if (!res.ok) {
    console.error(`오류: ${res.data.error}`);
    return;
  }
  const p = res.data.pokemon as {
    uid: string;
    species: string;
    nickname: string | null;
    level: number;
    exp: number;
    hp: number;
    maxHp: number;
    stats: { attack: number; defense: number; speed: number; spAttack: number; spDefense: number };
    moves: Array<{ id: string; pp: number; maxPp: number }>;
    caughtAt: string;
  };

  await renderPokemonArt(p.species);
  console.log(`  ${p.nickname || p.species} Lv.${p.level}`);
  console.log(`  HP: ${renderHpBar(p.hp, p.maxHp)}`);
  console.log(`  EXP: ${p.exp}`);
  console.log(`  공격: ${p.stats.attack}  방어: ${p.stats.defense}`);
  console.log(`  특공: ${p.stats.spAttack}  특방: ${p.stats.spDefense}`);
  console.log(`  스피드: ${p.stats.speed}`);
  console.log(`  기술:`);
  for (const m of p.moves) {
    console.log(`    - ${m.id} (PP: ${m.pp}/${m.maxPp})`);
  }
}
