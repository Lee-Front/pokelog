import { apiPost } from "../api-client.js";

export async function useItemCommand(item: string, pokemonUid: string) {
  const res = await apiPost("/api/shop/use", { item, pokemonUid });
  if (res.ok) {
    console.log(res.data.message ?? `${item} used successfully.`);
  } else {
    console.error(`Error: ${res.data.error}`);
  }
}
