import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";

/**
 * 속도 제한 미들웨어.
 *
 * 라우트 그룹별로 분당 허용 횟수가 다르다:
 * - 인증 라우트: 분당 10회 (브루트포스 방어)
 * - 게임 라우트: 분당 60회 (일반 플레이)
 * - 공개 라우트(art, meta): 분당 120회 (스팸 완화)
 *
 * 테스트 환경에서는 비활성화한다. 통합 테스트는 단일 앱 인스턴스에
 * 짧은 시간 동안 다수 요청을 보내므로 한도가 켜져 있으면 기존
 * 테스트가 429로 깨진다. 비활성화 판정은 요청마다 평가하므로
 * import 이후 환경변수를 바꿔도 반영된다.
 */

const ONE_MINUTE = 60 * 1000;

export function isRateLimitDisabled(): boolean {
  return process.env.VITEST === "true"
    || process.env.NODE_ENV === "test"
    || process.env.POKELOG_DISABLE_RATE_LIMIT === "1";
}

/**
 * 한도 미들웨어를 생성하되, 비활성화 환경에서는 요청을 그대로 통과시킨다.
 * 실제 한도 카운터는 활성 환경에서만 동작한다.
 */
export function createRateLimiter(max: number): RequestHandler {
  const limiter = rateLimit({
    windowMs: ONE_MINUTE,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." },
  });

  return (req, res, next) => {
    if (isRateLimitDisabled()) {
      next();
      return;
    }
    limiter(req, res, next);
  };
}

export const authRateLimiter = createRateLimiter(10);
export const gameRateLimiter = createRateLimiter(60);
export const publicRateLimiter = createRateLimiter(120);
