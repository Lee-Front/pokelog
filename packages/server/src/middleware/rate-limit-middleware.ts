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
 * 한도 버킷 키. 웹 포털은 프록시라 모든 사용자가 같은 IP(localhost)로 들어온다.
 * 그래서 IP 기준이면 모든 웹 사용자가 한 버킷을 공유해 금방 막힌다.
 * 인증 토큰이 있으면 토큰별로 버킷을 나눠 사용자마다 독립 한도를 준다.
 * 토큰 없는 요청(auth/art 등)만 IP로 묶는다.
 */
function clientKey(req: Parameters<RequestHandler>[0]): string {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.length > 0) return `tok:${auth}`;
  return `ip:${req.ip ?? "unknown"}`;
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
    keyGenerator: clientKey,
    validate: false,
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

// 분당 한도. 인증 라우트는 IP(브루트포스 방어)·게임은 사용자별·공개(art/meta)는 IP 공유라 넉넉히.
export const authRateLimiter = createRateLimiter(30);
export const gameRateLimiter = createRateLimiter(300);
export const publicRateLimiter = createRateLimiter(2000);
