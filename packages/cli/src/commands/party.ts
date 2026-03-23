import { apiGet, apiPut, apiPost } from "../api-client.js";
import { renderHpBar } from "../ui/display.js";

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
    types: string[];
  }>;

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
}

export async function partySetCommand(uids: string[]) {
  const res = await apiPut("/api/game/party", { uids });
  if (res.ok) {
    console.log("파티 편성 완료!");
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}
