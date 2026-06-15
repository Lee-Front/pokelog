// 이로치(shiny) 확률 단일 소스. createPokemon/createWildPokemon이 동기 함수라
// (커밋 폴링 등 깊은 동기 경로에서 호출됨) 매 호출마다 config를 await 하기 어렵다.
// 대신 config-store.getConfig()가 호출될 때마다 이 캐시를 갱신하고(refreshShinyRate),
// 팩토리는 동기 getShinyRate()로 최신 값을 읽는다. 저장 전/config 없을 땐 기본값 폴백.

export const DEFAULT_SHINY_RATE = 1 / 4096;

let shinyRate = DEFAULT_SHINY_RATE;

/** 현재 이로치 확률(0~1). config 로드 전이면 기본값. */
export function getShinyRate(): number {
  return shinyRate;
}

/** config 로드/저장 시 캐시 갱신. 유효하지 않은 값은 기본값으로 폴백. */
export function refreshShinyRate(rate: number | undefined): void {
  shinyRate =
    typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 1
      ? rate
      : DEFAULT_SHINY_RATE;
}
