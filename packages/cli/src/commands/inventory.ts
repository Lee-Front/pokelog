import { apiGet } from "../api-client.js";

export async function inventoryCommand() {
  const res = await apiGet("/api/game/inventory");
  if (!res.ok) {
    console.error(`오류: ${res.data.error}`);
    return;
  }
  const inv = res.data.inventory as Record<string, number>;
  console.log("  인벤토리");
  console.log("  " + "─".repeat(30));
  for (const [item, count] of Object.entries(inv)) {
    if (count > 0) console.log(`  ${item.padEnd(15)} x${count}`);
  }
}
