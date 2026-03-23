import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../auth/auth.js";

export interface AuthRequest extends Request {
  userId?: string;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
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
  req.userId = payload.userId;
  next();
}
