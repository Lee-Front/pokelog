import { getCurrentServer } from "../config.js";

export async function whereamiCommand() {
  const server = await getCurrentServer();
  if (!server) {
    console.log("현재 연결된 서버가 없습니다.");
    console.log("  pokelog join <url> 로 서버에 참가하세요.");
    return;
  }
  console.log(`  현재 서버 정보`);
  console.log("  " + "─".repeat(30));
  console.log(`  이름:     ${server.name}`);
  console.log(`  표시명:   ${server.displayName}`);
  console.log(`  URL:      ${server.url}`);
  console.log(`  API:      v${server.apiVersion}`);
  console.log(`  참가일:   ${server.joinedAt.slice(0, 10)}`);
}
