import { getServers, getCurrentServer, removeServer } from "../config.js";
import { separator } from "../ui/prompts.js";
import { DIM, RED, YEL, BLD, R } from "../ui/colors.js";
import { confirmFrame, formatScreenMessage, runMenuLoop, type ScreenMessage } from "../ui/screen.js";

type LeaveScreenState = {
  message: ScreenMessage | null;
};

type LeaveScreenData = {
  servers: Awaited<ReturnType<typeof getServers>>;
  currentId: string | null;
};

export async function leaveCommand() {
  await runMenuLoop<LeaveScreenState, LeaveScreenData, string>({
    initialState: { message: null },
    pageSize: 20,
    load: async () => {
      const current = await getCurrentServer();
      return {
        servers: await getServers(),
        currentId: current?.id ?? null,
      };
    },
    prompt: () => "雮橁皥 靹滊矂 靹犿儩",
    items: (data, state) => {
      if (data.servers.length === 0) {
        return [
          separator("  彀戈皜頃?靹滊矂臧€ 鞐嗢姷雼堧嫟."),
          separator(" "),
          { name: "Close", value: "__close__" },
        ];
      }

      const items: Array<{ name: string; value: string } | { separator: string }> = [];
      for (const server of data.servers) {
        const isCurrent = server.id === data.currentId;
        const marker = isCurrent ? ` ${YEL}CURRENT${R}` : "";
        const name = `  ${server.name.padEnd(12)} ${DIM}${server.displayName.padEnd(18)}${R} ${DIM}${server.url}${R}${marker}`;
        items.push({ name, value: server.id });
      }

      if (state.message) {
        items.push(separator(" "));
        items.push(separator(`  ${formatScreenMessage(state.message)}`));
      }

      items.push(separator(" "));
      items.push({ name: "Close", value: "__close__" });
      return items;
    },
    onSelect: async (selected, data, state) => {
      if (selected === "__close__") {
        return { state, close: true };
      }

      const target = data.servers.find((server) => server.id === selected);
      if (!target) {
        return state;
      }

      const confirm = await confirmFrame(
        `${RED}${BLD}${target.name}${R} 靹滊矂鞐愳劀 雮橁皜鞁滉矤鞀惦媹旯?`,
        { yes: `  ${RED}${BLD}Yes${R}`, no: "  No" },
      );
      if (!confirm) {
        return state;
      }

      const removed = await removeServer(selected);
      if (!removed) {
        return {
          message: { tone: "error", text: `Failed to leave ${target.name}.` },
        };
      }

      return {
        message: { tone: "success", text: `Left ${target.name}.` },
      };
    },
  });
}
