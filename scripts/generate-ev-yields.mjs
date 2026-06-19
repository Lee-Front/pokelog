// data/pokemon/ev-yields.json 생성 — 종족별 본가 실측 EV 수율.
//
// PokéAPI /pokemon/{slug} 응답의 stats[].effort 가 본가 EV 수율이다. species 동기화가
// 이미 같은 엔드포인트를 받아오지만(baseStats만 사용) effort는 버려서, 여기서 effort만
// 추려 별도 파일로 떨군다(species.json은 건드리지 않아 blast radius 최소).
//
// 출력: { [speciesSlug]: { attack?: 1, speed?: 1, ... } }  — 0인 스탯은 생략(희소 저장).
// 실행: node scripts/generate-ev-yields.mjs   (캐시 .cache/pokeapi/pokemon 재사용)

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { fetchJson } from "./pokeapi/fetch.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPECIES_PATH = path.join(REPO_ROOT, "data", "pokemon", "species.json");
const OUT_PATH = path.join(REPO_ROOT, "data", "pokemon", "ev-yields.json");

// PokéAPI 스탯명 → 내부 키.
const STAT_MAP = {
  hp: "hp",
  attack: "attack",
  defense: "defense",
  "special-attack": "spAttack",
  "special-defense": "spDefense",
  speed: "speed",
};

async function main() {
  const species = JSON.parse(await readFile(SPECIES_PATH, "utf8"));
  const slugs = species.map((s) => s.species);
  console.log(`종족 ${slugs.length}개 EV 수율 수집 시작...`);

  const yields = {};
  const missing = [];
  let done = 0;

  for (const slug of slugs) {
    try {
      const pokemon = await fetchJson(`/pokemon/${slug}`, {
        cacheKey: ["pokemon", `${slug}.json`],
      });
      const y = {};
      for (const entry of pokemon.stats ?? []) {
        const key = STAT_MAP[entry.stat?.name];
        if (key && entry.effort > 0) y[key] = entry.effort;
      }
      // 수율이 전부 0인 종(예: 일부 폼)도 명시적 {} 로 남기지 않고 생략 — getEvYield 폴백이 처리.
      if (Object.keys(y).length > 0) yields[slug] = y;
    } catch (err) {
      missing.push(slug);
    }
    done += 1;
    if (done % 100 === 0) console.log(`  ${done}/${slugs.length}...`);
  }

  // 키 정렬로 diff 안정화.
  const sorted = {};
  for (const key of Object.keys(yields).sort()) sorted[key] = yields[key];

  await writeFile(OUT_PATH, JSON.stringify(sorted, null, 2) + "\n", "utf8");
  console.log(`완료: ${Object.keys(sorted).length}종 수율 기록 → ${OUT_PATH}`);
  if (missing.length > 0) {
    console.log(`수집 실패/누락 ${missing.length}종(종족값 파생 폴백): ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? " ..." : ""}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
