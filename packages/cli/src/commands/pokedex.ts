import { apiGet } from "../api-client.js";
import { selectAction } from "../ui/prompts.js";
import { pokemonCommand } from "./pokemon.js";

export async function pokedexCommand() {
  const res = await apiGet("/api/game/pokedex");
  if (!res.ok) {
    console.error(`오류: ${res.data.error}`);
    return;
  }
  const pokedex = res.data.pokedex as string[];

  if (pokedex.length === 0) {
    console.log("도감이 비어 있습니다.");
    return;
  }

  console.log(`  포켓몬 도감 (${pokedex.length}종)`);
  console.log("  " + "─".repeat(30));

  // 보유 포켓몬 목록도 가져와서 매칭
  const pokemonRes = await apiGet("/api/game/party");
  const storageRes = await apiGet("/api/game/storage");
  const allPokemon = [
    ...((pokemonRes.data?.party as Array<{ uid: string; species: string; level: number }>) || []),
    ...((storageRes.data?.storage as Array<{ uid: string; species: string; level: number }>) || []),
  ];

  const choices = pokedex.map((species) => {
    const owned = allPokemon.filter((p) => p.species === species);
    const info = owned.length > 0 ? ` (보유: ${owned.length}마리)` : "";
    return { name: `${species}${info}`, value: species };
  });
  choices.push({ name: "← 돌아가기", value: "__back__" });

  const selected = await selectAction("포켓몬을 선택하세요:", choices);
  if (selected === "__back__") return;

  // 해당 종의 보유 포켓몬 중 하나 보여주기
  const match = allPokemon.find((p) => p.species === selected);
  if (match) {
    await pokemonCommand(match.uid);
  } else {
    console.log(`${selected} — 도감에 등록되었지만 현재 보유하고 있지 않습니다.`);
  }
}
