import { apiGet } from "../api-client.js";
import { selectAction } from "../ui/prompts.js";
import { encounterCommand } from "./encounter.js";

export async function eventsCommand() {
  const res = await apiGet("/api/game/events");
  if (!res.ok) {
    console.error(`오류: ${res.data.error}`);
    return;
  }
  const events = res.data.events as Array<{
    id: string;
    type: string;
    pokemon: { species: string; level: number };
    expiresAt: string;
  }>;

  if (events.length === 0) {
    console.log("미확인 이벤트가 없습니다.");
    return;
  }

  const choices = events.map((evt) => {
    const remaining = new Date(evt.expiresAt).getTime() - Date.now();
    const hours = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    return {
      name: `야생 ${evt.pokemon.species} Lv.${evt.pokemon.level} (남은 시간: ${hours}시간 ${mins}분)`,
      value: evt.id,
    };
  });
  choices.push({ name: "← 돌아가기", value: "__back__" });

  const selected = await selectAction("이벤트를 선택하세요:", choices);
  if (selected === "__back__") return;

  await encounterCommand(selected);
}
