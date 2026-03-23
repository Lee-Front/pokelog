import { apiGet } from "../api-client.js";

export async function pokedexCommand() {
  const res = await apiGet("/api/game/pokedex");
  if (!res.ok) {
    console.error(`오류: ${res.data.error}`);
    return;
  }
  const pokedex = res.data.pokedex as string[];
  console.log(`  포켓몬 도감 (${pokedex.length}종)`);
  console.log("  " + "─".repeat(30));
  for (const species of pokedex) {
    console.log(`  - ${species}`);
  }
}
