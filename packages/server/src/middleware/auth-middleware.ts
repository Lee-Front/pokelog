import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../auth/auth.js";
import { getUser } from "../storage/user-store.js";

export interface AuthRequest extends Request {
  userId?: string;
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "인증이 필요합니다" });
    return;
  }
  const token = header.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "유효하지 않은 토큰입니다" });
    return;
  }

  // Token-invalidation gate: if the user has explicitly invalidated all
  // issued sessions (via the logout-all endpoint), reject any token
  // whose issued-at timestamp predates the invalidation. Tokens issued
  // after that moment remain valid.
  const user = await getUser(payload.userId);
  if (user?.tokenInvalidatedAt && typeof payload.iat === "number") {
    const iatMs = payload.iat * 1000;
    const invalidatedMs = new Date(user.tokenInvalidatedAt).getTime();
    if (Number.isFinite(invalidatedMs) && iatMs < invalidatedMs) {
      res.status(401).json({ error: "세션이 만료되었습니다. 다시 로그인해주세요" });
      return;
    }
  }

  req.userId = payload.userId;
  next();
}
