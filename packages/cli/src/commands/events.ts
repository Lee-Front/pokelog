import { apiGet } from "../api-client.js";
import { selectAction } from "../ui/prompts.js";
import { renderPokemonArt, printHeader } from "../ui/display.js";
import { encounterCommand } from "./encounter.js";

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

export async function eventsCommand() {
  while (true) {
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

    clearScreen();
    await printHeader("encounters");

    if (events.length === 0) {
      console.log("  야생 조우가 없습니다.");
      console.log();
      await selectAction("", [{ name: "← 돌아가기", value: "back" }]);
      return;
    }

    const choices = events.map((evt) => {
      const remaining = new Date(evt.expiresAt).getTime() - Date.now();
      const hours = Math.floor(remaining / 3600000);
      const mins = Math.floor((remaining % 3600000) / 60000);
      const species = evt.pokemon.species.padEnd(12);
      const level = `Lv.${evt.pokemon.level}`.padEnd(6);
      const time = `${hours}시간 ${mins}분`;
      return {
        name: `${species} ${level} ${time}`,
        value: evt.id,
      };
    });
    choices.push({ name: "← 돌아가기", value: "__back__" });

    const selected = await selectAction("조우를 선택하세요:", choices);
    if (selected === "__back__") return;

    // 선택한 야생 포켓몬 미리보기
    clearScreen();
    await printHeader("encounters");
    await renderPokemonArt(events.find((e) => e.id === selected)!.pokemon.species);
    const evt = events.find((e) => e.id === selected)!;
    console.log(`  야생 ${evt.pokemon.species} Lv.${evt.pokemon.level}`);
    console.log();

    await encounterCommand(selected);
  }
}
