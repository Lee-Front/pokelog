import { apiGet } from "../api-client.js";
import { selectAction } from "../ui/prompts.js";
import { useItemCommand } from "./use-item.js";

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

export async function inventoryCommand() {
  while (true) {
    clearScreen();

    const res = await apiGet("/api/game/inventory");
    if (!res.ok) {
      console.error(`오류: ${res.data.error}`);
      await selectAction("", [{ name: "← 돌아가기", value: "back" }]);
      return;
    }
    const inv = res.data.inventory as Record<string, number>;
    const items = Object.entries(inv).filter(([, count]) => count > 0);

    console.log("  인벤토리");
    console.log("  " + "─".repeat(30));

    if (items.length === 0) {
      console.log("  인벤토리가 비어 있습니다.");
      console.log();
      await selectAction("", [{ name: "← 돌아가기", value: "back" }]);
      return;
    }

    for (const [item, count] of items) {
      console.log(`  ${item.padEnd(15)} x${count}`);
    }
    console.log();

    const healItems = items.filter(([k]) => k.toLowerCase().includes("potion"));

    if (healItems.length === 0) {
      console.log("  사용 가능한 회복 아이템이 없습니다.");
      console.log();
      await selectAction("", [{ name: "← 돌아가기", value: "back" }]);
      return;
    }

    const choices = healItems.map(([k, v]) => ({
      name: `${k} (x${v}) 사용하기`,
      value: k,
    }));
    choices.push({ name: "← 돌아가기", value: "__back__" });

    const selected = await selectAction("아이템을 사용하시겠습니까?", choices);
    if (selected === "__back__") return;

    // 파티 조회
    const partyRes = await apiGet("/api/game/party");
    if (!partyRes.ok) {
      console.error(`  파티 조회 오류: ${partyRes.data.error}`);
      await selectAction("", [{ name: "← 돌아가기", value: "back" }]);
      continue;
    }
    const party = partyRes.data.party as Array<{
      uid: string;
      species: string;
      level: number;
      hp: number;
      maxHp: number;
    }>;

    const injured = party.filter((p) => p.hp < p.maxHp);
    if (injured.length === 0) {
      console.log("\n  회복이 필요한 포켓몬이 없습니다.");
      await selectAction("", [{ name: "← 돌아가기", value: "back" }]);
      continue;
    }

    const targetChoices = injured.map((p) => ({
      name: `${p.species} Lv.${p.level} HP:${p.hp}/${p.maxHp}`,
      value: p.uid,
    }));
    targetChoices.push({ name: "← 돌아가기", value: "__back__" });

    const target = await selectAction("회복할 포켓몬을 선택하세요:", targetChoices);
    if (target === "__back__") continue;

    await useItemCommand(selected, target);
  }
}
