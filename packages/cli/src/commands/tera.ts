import { apiGet, apiPost } from "../api-client.js";
import { BLD, DIM, GRN, R, RED, YEL } from "../ui/colors.js";
import { selectFrame } from "../ui/screen.js";

interface PartyMon {
  uid: string;
  species: string;
  level: number;
  nickname?: string | null;
}

interface PokemonDetail {
  uid: string;
  species: string;
  nickname?: string | null;
  teraType?: string | null;
}

const TERA_TYPES: { id: string; name: string }[] = [
  { id: "normal", name: "노말" },
  { id: "fire", name: "불꽃" },
  { id: "water", name: "물" },
  { id: "electric", name: "전기" },
  { id: "grass", name: "풀" },
  { id: "ice", name: "얼음" },
  { id: "fighting", name: "격투" },
  { id: "poison", name: "독" },
  { id: "ground", name: "땅" },
  { id: "flying", name: "비행" },
  { id: "psychic", name: "에스퍼" },
  { id: "bug", name: "벌레" },
  { id: "rock", name: "바위" },
  { id: "ghost", name: "고스트" },
  { id: "dragon", name: "드래곤" },
  { id: "dark", name: "악" },
  { id: "steel", name: "강철" },
  { id: "fairy", name: "페어리" },
];

async function pickPokemon(uidFromArg?: string): Promise<string | null> {
  if (uidFromArg) return uidFromArg;

  const partyRes = await apiGet("/api/game/party");
  if (!partyRes.ok) {
    console.log(`${RED}오류: ${String(partyRes.data.error ?? "Failed to load party.")}${R}`);
    return null;
  }
  const party = (partyRes.data.party as PartyMon[] | undefined) ?? [];
  if (party.length === 0) {
    console.log(`${YEL}파티가 비어 있습니다${R}`);
    return null;
  }

  const selected = await selectFrame("테라 타입을 변경할 포켓몬", [
    ...party.map((p) => ({
      name: `${p.nickname ?? p.species.padEnd(16)} ${DIM}Lv.${p.level}${R}`,
      value: p.uid,
    })),
    { name: "취소", value: "__cancel__" },
  ]);
  if (!selected || selected === "__cancel__") return null;
  return selected;
}

export async function teraCommand(pokemonUidArg?: string): Promise<void> {
  const pokemonUid = await pickPokemon(pokemonUidArg);
  if (!pokemonUid) return;

  const pokeRes = await apiGet(`/api/game/pokemon/${pokemonUid}`);
  if (!pokeRes.ok) {
    console.log(`${RED}오류: ${String(pokeRes.data.error ?? "포켓몬을 불러오지 못했습니다")}${R}`);
    return;
  }

  const pokemon = pokeRes.data.pokemon as PokemonDetail;
  const currentTera = pokemon.teraType ?? "없음";

  console.log(
    `\n  ${BLD}${pokemon.nickname ?? pokemon.species}${R}  ${DIM}현재 테라 타입:${R} ${YEL}${currentTera}${R}`,
  );

  const choices = TERA_TYPES.map((t) => {
    const marker = t.id === pokemon.teraType ? `${GRN}●${R}` : `${DIM}○${R}`;
    return { name: `${marker} ${t.name}`, value: t.id };
  });

  const selected = await selectFrame("변경할 테라 타입", [
    ...choices,
    { name: "취소", value: "__cancel__" },
  ]);
  if (!selected || selected === "__cancel__") return;

  const res = await apiPost("/api/game/change-tera-type", {
    pokemonUid,
    teraType: selected,
  });
  if (res.ok) {
    console.log(`\n  ${GRN}테라 타입이 변경되었습니다: ${selected}${R}`);
  } else {
    console.log(`\n  ${RED}실패: ${String(res.data.error ?? "change failed")}${R}`);
  }
}
