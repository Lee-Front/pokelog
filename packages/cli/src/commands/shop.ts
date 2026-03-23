import { apiGet, apiPost } from "../api-client.js";

export async function shopCommand() {
  const res = await apiGet("/api/shop");
  if (!res.ok) {
    console.error(`오류: ${res.data.error}`);
    return;
  }
  const d = res.data;
  console.log(`  상점 (보유 포인트: ${d.points}P)`);
  console.log("  " + "─".repeat(30));
  const items = d.items as Record<string, { name: string; price: number }>;
  for (const [key, item] of Object.entries(items)) {
    console.log(`  ${key.padEnd(15)} ${item.name.padEnd(10)} ${item.price}P`);
  }
}

export async function buyCommand(item: string, quantity: number) {
  const res = await apiPost("/api/shop/buy", { item, quantity });
  if (res.ok) {
    console.log(`${item} ${quantity}개 구매 완료!`);
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}
