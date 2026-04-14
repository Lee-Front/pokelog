import { getServers, getCurrentServer, switchServer } from "../config.js";
import { separator } from "../ui/prompts.js";
import { DIM, CYN, YEL, BLD, R } from "../ui/colors.js";
import { formatScreenMessage, runMenuLoop, type ScreenMessage } from "../ui/screen.js";

type ServerScreenState = {
  currentId: string | null;
  message: ScreenMessage | null;
};

type ServerScreenData = Awaited<ReturnType<typeof getServers>>;

export async function serversCommand() {
  const current = await getCurrentServer();

  await runMenuLoop<ServerScreenState, ServerScreenData, string>({
    initialState: {
      currentId: current?.id ?? null,
      message: null,
    },
    pageSize: 20,
    defaultValue: (_servers, state) => state.currentId ?? undefined,
    load: async () => getServers(),
    prompt: () => "서버 목록",
    items: (servers, state) => {
      if (servers.length === 0) {
        return [
          separator("  참가한 서버가 없습니다."),
          separator("  join <url> 로 서버에 참가하세요."),
          separator(" "),
          { name: "Close", value: "__close__" },
        ];
      }

      const items: Array<{ name: string; value: string } | { separator: string }> = [];
      for (const server of servers) {
        const isCurrent = server.id === state.currentId;
        const marker = isCurrent ? ` ${YEL}CURRENT${R}` : "";
        const nameColor = isCurrent ? `${CYN}${BLD}` : "";
        const name = `  ${nameColor}${server.name.padEnd(12)}${R} ${DIM}${server.displayName.padEnd(18)}${R} ${DIM}${server.url}${R}${marker}`;
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
    onSelect: async (selected, servers, state) => {
      if (selected === "__close__") {
        return { state, close: true };
      }

      const currentServer = servers.find((server) => server.id === state.currentId);
      if (selected === state.currentId) {
        return {
          ...state,
          message: { tone: "info", text: `Already connected to ${currentServer?.name ?? "this server"}.` },
        };
      }

      const switched = await switchServer(selected);
      if (!switched) {
        return {
          ...state,
          message: { tone: "error", text: "Failed to switch server." },
        };
      }

      return {
        currentId: switched.id,
        message: { tone: "success", text: `Switched to ${switched.displayName} (${switched.name}).` },
      };
    },
  });
}
