import { apiGet, apiPut } from "../api-client.js";
import { renderHpBar } from "../ui/display.js";
import { selectAction } from "../ui/prompts.js";
import { pokemonCommand } from "./pokemon.js";

export async function partyCommand() {
  const res = await apiGet("/api/game/party");
  if (!res.ok) {
    console.error(`오류: ${res.data.error}`);
    return;
  }
  const party = res.data.party as Array<{
    uid: string;
    species: string;
    level: number;
    hp: number;
    maxHp: number;
  }>;

  if (party.length === 0) {
    console.log("파티가 비어 있습니다.");
    return;
  }

  while (true) {
    process.stdout.write("\x1b[2J\x1b[H");
    console.log("  파티 포켓몬");
    console.log("  " + "─".repeat(30));
    for (let i = 0; i < 6; i++) {
      const p = party[i];
      if (p) {
        console.log(`  ${i + 1}. ${p.species.padEnd(12)} Lv.${String(p.level).padEnd(4)} HP: ${renderHpBar(p.hp, p.maxHp, 10)}`);
      } else {
        console.log(`  ${i + 1}. (빈 슬롯)`);
      }
    }

    const choices = party.map((p) => ({
      name: `${p.species} Lv.${p.level} - 상세 정보`,
      value: p.uid,
    }));
    choices.push({ name: "← 돌아가기", value: "__back__" });

    const selected = await selectAction("\n포켓몬을 선택하세요:", choices);
    if (selected === "__back__") return;

    await pokemonCommand(selected);
  }
}

export async function partySetCommand(uids: string[]) {
  const res = await apiPut("/api/game/party", { uids });
  if (res.ok) {
    console.log("파티 편성 완료!");
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}
