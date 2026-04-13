import { readCache, writeCache } from "./cache.mjs";

const API_ROOT = "https://pokeapi.co/api/v2";
const REQUEST_INTERVAL_MS = 100;
let nextRequestAt = 0;

async function waitForTurn() {
  const now = Date.now();
  const waitMs = Math.max(0, nextRequestAt - now);
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  nextRequestAt = Date.now() + REQUEST_INTERVAL_MS;
}

export function toApiUrl(pathOrUrl) {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }

  const normalized = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${API_ROOT}${normalized}`;
}

export async function fetchJson(pathOrUrl, options = {}) {
  const {
    cacheKey,
    noCache = false,
    retries = 3,
    fetchImpl = fetch,
  } = options;

  if (cacheKey && !noCache) {
    const cached = await readCache(...cacheKey);
    if (cached) {
      return cached;
    }
  }

  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await waitForTurn();
      const response = await fetchImpl(toApiUrl(pathOrUrl), {
        headers: { "user-agent": "pokelog-pokeapi-sync" },
      });

      if (!response.ok) {
        throw new Error(`PokeAPI ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      if (cacheKey && !noCache) {
        await writeCache(cacheKey, data);
      }
      return data;
    } catch (error) {
      lastError = error;
      const isRetryable = attempt < retries - 1;
      if (!isRetryable) break;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  throw lastError;
}
