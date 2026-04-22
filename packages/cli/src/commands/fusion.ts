import { apiGet, apiPost } from "../api-client.js";
import { BLD, DIM, GRN, R, RED, YEL } from "../ui/colors.js";
import { selectFrame } from "../ui/screen.js";

interface OwnedPokemon {
  uid: string;
  species: string;
  level: number;
  hp: number;
  maxHp: number;
  fusedPartnerUid?: string;
}

interface FusionRecipe {
  base: string;
  partner: string;
  item: string;
  result: string;
}

const RECIPES: FusionRecipe[] = [
  { base: "kyurem", partner: "reshiram", item: "dna-splicers", result: "kyurem-white" },
  { base: "kyurem", partner: "zekrom", item: "dna-splicers", result: "kyurem-black" },
  { base: "necrozma", partner: "solgaleo", item: "n-solarizer", result: "necrozma-dusk" },
  { base: "necrozma", partner: "lunala", item: "n-lunarizer", result: "necrozma-dawn" },
  { base: "calyrex", partner: "glastrier", item: "reins-of-unity", result: "calyrex-ice" },
  { base: "calyrex", partner: "spectrier", item: "reins-of-unity", result: "calyrex-shadow" },
];

async function fetchPokemon(): Promise<OwnedPokemon[] | null> {
  const res = await apiGet("/api/user/profile");
  if (!res.ok) {
    console.log(`${RED}오류: ${String(res.data.error ?? "프로필을 불러오지 못했습니다")}${R}`);
    return null;
  }
  const pokemon = (res.data.pokemon as OwnedPokemon[] | undefined) ?? [];
  return pokemon;
}

function formatPokemonLabel(p: OwnedPokemon): string {
  return `${p.species.padEnd(18)} ${DIM}Lv.${p.level}  HP ${p.hp}/${p.maxHp}${R}`;
}

async function selectMode(): Promise<"fuse" | "unfuse" | null> {
  const choice = await selectFrame("합체 / 해제", [
    { name: "합체 (Fuse)", value: "fuse" as const },
    { name: "해제 (Unfuse)", value: "unfuse" as const },
    { name: "취소", value: "__cancel__" as const },
  ]);
  if (!choice || choice === "__cancel__") return null;
  return choice;
}

async function handleFuse(): Promise<void> {
  const pokemon = await fetchPokemon();
  if (!pokemon) return;

  const bases = pokemon.filter(
    (p) => RECIPES.some((r) => r.base === p.species) && !p.fusedPartnerUid,
  );
  if (bases.length === 0) {
    console.log(
      `${YEL}합체 가능한 포켓몬이 없습니다 (큐레무/네크로즈마/버드렉스 필요)${R}`,
    );
    return;
  }

  const baseUid = await selectFrame("합체할 포켓몬 선택", [
    ...bases.map((p) => ({ name: formatPokemonLabel(p), value: p.uid })),
    { name: "취소", value: "__cancel__" },
  ]);
  if (!baseUid || baseUid === "__cancel__") return;
  const base = bases.find((p) => p.uid === baseUid);
  if (!base) return;

  const recipesForBase = RECIPES.filter((r) => r.base === base.species);
  const availableRecipes = recipesForBase.filter((r) =>
    pokemon.some((p) => p.species === r.partner && !p.fusedPartnerUid),
  );
  if (availableRecipes.length === 0) {
    console.log(`${YEL}합체 파트너가 없습니다${R}`);
    return;
  }

  const recipeIndex = await selectFrame("합체 파트너 선택", [
    ...availableRecipes.map((r, i) => ({
      name: `${r.partner.padEnd(14)} ${DIM}→ ${r.result}  (${r.item})${R}`,
      value: String(i),
    })),
    { name: "취소", value: "__cancel__" },
  ]);
  if (!recipeIndex || recipeIndex === "__cancel__") return;
  const recipe = availableRecipes[Number(recipeIndex)];
  if (!recipe) return;

  const partner = pokemon.find(
    (p) => p.species === recipe.partner && !p.fusedPartnerUid,
  );
  if (!partner) {
    console.log(`${RED}파트너 포켓몬을 찾을 수 없습니다${R}`);
    return;
  }

  const confirm = await selectFrame(
    `${base.species} + ${partner.species} → ${recipe.result}  (아이템: ${recipe.item})`,
    [
      { name: `${GRN}진행${R}`, value: "ok" },
      { name: "취소", value: "__cancel__" },
    ],
  );
  if (confirm !== "ok") return;

  const postRes = await apiPost("/api/game/fusion/fuse", {
    baseUid: base.uid,
    partnerUid: partner.uid,
    itemId: recipe.item,
  });
  if (postRes.ok) {
    console.log(`\n  ${GRN}${BLD}합체 성공!${R} ${recipe.result} 탄생!`);
  } else {
    console.log(`\n  ${RED}실패: ${String(postRes.data.error ?? "fusion failed")}${R}`);
  }
}

async function handleUnfuse(): Promise<void> {
  const pokemon = await fetchPokemon();
  if (!pokemon) return;

  const fused = pokemon.filter((p) => p.fusedPartnerUid);
  if (fused.length === 0) {
    console.log(`${YEL}합체된 포켓몬이 없습니다${R}`);
    return;
  }

  const targetUid = await selectFrame("해제할 포켓몬 선택", [
    ...fused.map((p) => ({ name: formatPokemonLabel(p), value: p.uid })),
    { name: "취소", value: "__cancel__" },
  ]);
  if (!targetUid || targetUid === "__cancel__") return;

  const postRes = await apiPost("/api/game/fusion/unfuse", { fusedUid: targetUid });
  if (postRes.ok) {
    console.log(`\n  ${GRN}해제 완료!${R}`);
  } else {
    console.log(`\n  ${RED}실패: ${String(postRes.data.error ?? "unfuse failed")}${R}`);
  }
}

export async function fusionCommand(): Promise<void> {
  const mode = await selectMode();
  if (!mode) return;

  if (mode === "fuse") await handleFuse();
  else if (mode === "unfuse") await handleUnfuse();
}
