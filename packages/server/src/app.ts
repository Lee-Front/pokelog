import express from "express";
import fs from "node:fs";
import path from "node:path";
import { projectPath } from "./paths.js";
import { httpLogger } from "./logger.js";
import { getConfig } from "./storage/config-store.js";
import { resolveArtName } from "./game/data-loader.js";
import { authRoutes } from "./routes/auth-routes.js";
import { userRoutes } from "./routes/user-routes.js";
import { gameRoutes } from "./routes/game-routes.js";
import { tradeRoutes } from "./routes/trade-routes.js";
import { eggRoutes } from "./routes/egg-routes.js";
import { evolutionRoutes } from "./routes/evolution-routes.js";
import { itemRoutes } from "./routes/item-routes.js";
import { storageRoutes } from "./routes/storage-routes.js";
import { shopRoutes } from "./routes/shop-routes.js";
import { battleShopRoutes } from "./routes/battle-shop-routes.js";
import { battleRoutes } from "./routes/battle-routes.js";
import { pvpRoutes } from "./routes/pvp-routes.js";
import { socialRoutes } from "./routes/social-routes.js";
import { adminRoutes } from "./routes/admin-routes.js";
import { authRateLimiter, gameRateLimiter, publicRateLimiter } from "./middleware/rate-limit-middleware.js";
import { corsMiddleware } from "./middleware/cors-middleware.js";

/**
 * API path prefixes. `/api` is the original prefix kept for CLI compatibility;
 * `/api/v1` is a stable versioned alias for external web consumers. Both serve
 * identical routes.
 */
const API_PREFIXES = ["/api", "/api/v1"] as const;

export function createApp() {
  const app = express();
  app.use(httpLogger);
  // CORS runs before body parsing so preflight (OPTIONS) is answered cheaply.
  app.use(corsMiddleware());
  app.use(express.json({ limit: "1mb" }));

  // 아트 파일 읽기 헬퍼 — 경로 순회 방어 포함
  const BALL_ART_DIR = projectPath("data/colorscripts/small/ball");
  const POKEMON_ART_DIR = projectPath("data/colorscripts/small/regular");
  const EGG_ART_DIR = projectPath("data/colorscripts/small/egg");

  function safeReadArt(baseDir: string, name: string): string | null {
    const sanitized = name.replace(/[^a-zA-Z0-9-]/g, "");
    const resolved = path.resolve(baseDir, sanitized);
    if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) return null;
    try { return fs.readFileSync(resolved, "utf-8"); } catch { return null; }
  }

  // 모든 라우트를 /api 와 /api/v1 양쪽에 동일하게 마운트한다.
  // /api 는 CLI 호환용, /api/v1 은 외부 웹 소비자용 안정 계약.
  for (const prefix of API_PREFIXES) {
    // 공개 라우트(meta, art)는 느슨한 한도 적용
    app.use(`${prefix}/meta`, publicRateLimiter);
    app.use(`${prefix}/art`, publicRateLimiter);

    // 서버 메타데이터 (인증 불필요)
    app.get(`${prefix}/meta`, async (_req, res) => {
      const config = await getConfig();
      res.json(config.meta);
    });

    // 알 ANSI 아트 API
    app.get(`${prefix}/art/egg/:name`, (req, res) => {
      const art = safeReadArt(EGG_ART_DIR, req.params.name);
      if (art) res.type("text/plain").send(art);
      else res.status(404).send("");
    });

    // 볼 ANSI 아트 API — /:species보다 먼저 등록해야 매칭됨
    app.get(`${prefix}/art/ball/:name`, (req, res) => {
      const art = safeReadArt(BALL_ART_DIR, req.params.name);
      if (art) res.type("text/plain").send(art);
      else res.status(404).send("");
    });

    // 포켓몬 ANSI 아트 API (인증 불필요)
    // 종 id를 아트 파일명으로 정규화한다(폼 풀 id "mimikyu-disguised" → 베이스 "mimikyu").
    app.get(`${prefix}/art/:species`, (req, res) => {
      const art = safeReadArt(POKEMON_ART_DIR, resolveArtName(req.params.species));
      if (art) res.type("text/plain").send(art);
      else res.status(404).send("");
    });

    // 인증 라우트는 엄격한 한도(브루트포스 방어), 나머지 게임 라우트는 보통 한도
    app.use(`${prefix}/auth`, authRateLimiter, authRoutes);
    app.use(`${prefix}/user`, gameRateLimiter, userRoutes);
    app.use(`${prefix}/game`, gameRateLimiter, gameRoutes);
    app.use(`${prefix}/game`, tradeRoutes);
    app.use(`${prefix}/game`, eggRoutes);
    app.use(`${prefix}/game`, evolutionRoutes);
    app.use(`${prefix}/game`, itemRoutes);
    app.use(`${prefix}/game`, storageRoutes);
    app.use(`${prefix}/shop`, gameRateLimiter, shopRoutes);
    app.use(`${prefix}/battle-shop`, gameRateLimiter, battleShopRoutes);
    app.use(`${prefix}/battle`, gameRateLimiter, battleRoutes);
    app.use(`${prefix}/pvp`, gameRateLimiter, pvpRoutes);
    app.use(`${prefix}/social`, gameRateLimiter, socialRoutes);
    app.use(`${prefix}/admin`, adminRoutes);
  }

  return app;
}
