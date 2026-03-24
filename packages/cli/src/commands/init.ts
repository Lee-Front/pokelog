import { joinCommand } from "./join.js";

export async function initCommand(serverUrl: string) {
  console.log("[deprecated] pokelog join <url> 을 사용하세요.\n");
  await joinCommand(serverUrl);
}
