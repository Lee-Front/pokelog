import { DIM, RED, BLD, R } from "../ui/colors.js";
import { apiGet, apiPost } from "../api-client.js";
import { encounterCommand } from "./encounter.js";
import { separator } from "../ui/prompts.js";
import { formatScreenMessage, runMenuLoop, type ScreenMessage } from "../ui/screen.js";

type EncounterEvent = {
  id: string;
  type: string;
  pokemon: { species: string; level: number };
};

const SEARCH_VALUE = "__search__";

export async function eventsCommand() {
  type EventsState = { message: ScreenMessage | null };
  type EventsData = { events: EncounterEvent[] };

  try {
    await runMenuLoop<EventsState, EventsData, string>({
      initialState: { message: null },
      pageSize: 14,
      load: async () => {
        const res = await apiGet("/api/game/events");
        if (!res.ok) throw new Error(String(res.data.error ?? "이벤트를 불러올 수 없습니다"));
        return { events: (res.data.events as EncounterEvent[]) ?? [] };
      },
      prompt: () => "Events",
      items: (data, state) => {
        const items: Array<{ name: string; value: string; disabled?: boolean } | { separator: string }> = [
          separator(`  ${BLD}야생 조우${R}`),
          { name: "탐색(무료)", value: SEARCH_VALUE },
          separator(" "),
        ];

        if (data.events.length === 0) {
          items.push({ name: `${DIM}야생 조우가 없습니다. 탐색으로 조우를 생성하세요.${R}`, value: "__empty__", disabled: true });
        } else {
          for (const evt of data.events) {
            const label = `${evt.pokemon.species.padEnd(14)} ${DIM}Lv.${evt.pokemon.level}${R}`;
            items.push({ name: label, value: evt.id });
          }
        }

        if (state.message) {
          items.push(separator(" "));
          items.push(separator(`  ${formatScreenMessage(state.message)}`));
        }

        items.push(separator(" "));
        items.push({ name: "뒤로", value: "__close__" });
        return items;
      },
      onSelect: async (selected, _data, state) => {
        if (selected === "__close__" || selected === "__empty__") {
          return selected === "__close__" ? { state, close: true } : state;
        }

        if (selected === SEARCH_VALUE) {
          // 무료 지역 탐색 — 야생 조우 목록을 새로 생성(교체)
          const res = await apiPost("/api/game/wild/search", {});
          if (!res.ok) {
            return { message: { tone: "error", text: String(res.data.error ?? "탐색에 실패했습니다") } as ScreenMessage };
          }
          const count = (res.data.count as number) ?? ((res.data.events as unknown[])?.length ?? 0);
          return { message: { tone: "success", text: `야생 ${count}마리를 발견했습니다!` } as ScreenMessage };
        }

        await encounterCommand(selected, _data.events.find(e => e.id === selected)?.pokemon ?? { species: "", level: 0 });
        return { message: null };
      },
    });
  } catch (error) {
    console.log(`  ${RED}${String(error instanceof Error ? error.message : "이벤트를 불러올 수 없습니다")}${R}`);
  }
}
