import type { Request, Response, NextFunction } from "express";

export function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = req.headers["x-admin-key"];
  const expected = process.env.POKELOG_ADMIN_KEY;
  if (!expected) {
    res.status(503).json({ error: "Admin API is disabled (no POKELOG_ADMIN_KEY set)" });
    return;
  }
  if (key !== expected) {
    res.status(403).json({ error: "Invalid admin key" });
    return;
  }
  next();
}
