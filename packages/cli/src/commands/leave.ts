import { removeServer } from "../config.js";

export async function leaveCommand(nameOrId: string) {
  const removed = await removeServer(nameOrId);
  if (removed) {
    console.log(`서버에서 나갔습니다: ${nameOrId}`);
  } else {
    console.error(`서버를 찾을 수 없습니다: ${nameOrId}`);
  }
}
