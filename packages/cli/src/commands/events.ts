import { apiGet } from "../api-client.js";

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

  for (const evt of events) {
    const remaining = new Date(evt.expiresAt).getTime() - Date.now();
    const hours = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    console.log(
      `[${evt.id.slice(0, 8)}] 야생 ${evt.pokemon.species} Lv.${evt.pokemon.level} 출현! (남은 시간: ${hours}시간 ${mins}분)`
    );
  }
}
