import { apiPost } from "../api-client.js";

export async function useItemCommand(item: string, pokemonUid: string) {
  const res = await apiPost("/api/shop/use", { item, pokemonUid });
  if (res.ok) {
    console.log(`${item} 사용 완료!`);
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}
