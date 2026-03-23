import { apiGet } from "../api-client.js";
import { renderBox } from "../ui/display.js";

export async function statusCommand() {
  const res = await apiGet("/api/game/status");
  if (!res.ok) {
    console.error(`오류: ${res.data.error}`);
    return;
  }
  const d = res.data;
  renderBox([
    `pokelog - ${d.nickname}`,
    "─".repeat(30),
    `보유 포인트:    ${d.points}P`,
    `총 경험치:      ${d.totalExp}`,
    `현재 콤보:      ${d.comboCount}x`,
    `미확인 이벤트:  ${d.pendingEventCount}건`,
  ]);
}
