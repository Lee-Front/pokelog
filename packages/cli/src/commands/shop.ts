import { apiGet, apiPost } from "../api-client.js";
import { selectAction, numberPrompt } from "../ui/prompts.js";

export async function shopCommand() {
  const res = await apiGet("/api/shop");
  if (!res.ok) {
    console.error(`오류: ${res.data.error}`);
    return;
  }
  const d = res.data;
  const items = d.items as Record<string, { name: string; price: number }>;

  console.log(`  상점 (보유 포인트: ${d.points}P)`);
  console.log("  " + "─".repeat(30));

  const choices = Object.entries(items).map(([key, item]) => ({
    name: `${item.name.padEnd(10)} ${String(item.price).padStart(5)}P`,
    value: key,
  }));
  choices.push({ name: "← 돌아가기", value: "__back__" });

  const selected = await selectAction("구매할 아이템을 선택하세요:", choices);
  if (selected === "__back__") return;

  const quantity = await numberPrompt("수량:");
  if (!quantity || quantity <= 0) {
    console.log("취소되었습니다.");
    return;
  }

  await buyCommand(selected, quantity);
}

export async function buyCommand(item: string, quantity: number) {
  const res = await apiPost("/api/shop/buy", { item, quantity });
  if (res.ok) {
    console.log(`${item} ${quantity}개 구매 완료! (남은 포인트: ${res.data.points}P)`);
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}
