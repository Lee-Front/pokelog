import { apiGet } from "../api-client.js";
import { evolutionsCommand } from "./evolutions.js";
import { renderBox } from "../ui/display.js";
import { selectAction } from "../ui/prompts.js";

type StatusResponse = {
  nickname: string;
  points: number;
  totalExp: number;
  combo?: { count?: number } | null;
  pendingEventCount: number;
  pendingEvolutionCount?: number;
  region?: string;
};

export async function statusCommand() {
  const res = await apiGet("/api/game/status");
  if (!res.ok) {
    console.error(`Error: ${String(res.data.error ?? "Failed to load status.")}`);
    return;
  }

  const data = res.data as StatusResponse;
  const pendingEvolutionCount = Number(data.pendingEvolutionCount ?? 0);

  renderBox([
    `pokelog - ${data.nickname}`,
    "-".repeat(30),
    `Points              ${data.points}P`,
    `Total EXP           ${data.totalExp}`,
    `Combo               x${Number(data.combo?.count ?? 0)}`,
    `Pending Encounters  ${data.pendingEventCount}`,
    `Pending Evolutions  ${pendingEvolutionCount}`,
    `Region              ${data.region ?? "default"}`,
  ]);

  if (pendingEvolutionCount <= 0) {
    return;
  }

  const action = await selectAction("Pending evolutions are ready.", [
    { name: "Resolve pending evolutions", value: "resolve" },
    { name: "Back", value: "back" },
  ]);

  if (action === "resolve") {
    await evolutionsCommand();
  }
}
