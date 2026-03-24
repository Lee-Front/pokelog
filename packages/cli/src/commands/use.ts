import { switchServer } from "../config.js";

export async function useCommand(nameOrId: string) {
  const server = await switchServer(nameOrId);
  if (server) {
    console.log(`서버 전환 완료: ${server.displayName} (${server.name})`);
  } else {
    console.error(`서버를 찾을 수 없습니다: ${nameOrId}`);
    console.log("  pokelog servers 로 목록을 확인하세요.");
  }
}
