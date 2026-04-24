import type { Request, Response, NextFunction } from "express";

export function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = req.headers["x-admin-key"];
  const expected = process.env.POKELOG_ADMIN_KEY;
  if (!expected) {
    res.status(503).json({ error: "관리자 API가 비활성화되어 있습니다 (POKELOG_ADMIN_KEY 미설정)" });
    return;
  }
  if (key !== expected) {
    res.status(403).json({ error: "관리자 키가 올바르지 않습니다" });
    return;
  }
  next();
}
