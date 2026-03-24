import express from "express";
import path from "node:path";
import fs from "node:fs";
import { authRoutes } from "./routes/auth-routes.js";
import { userRoutes } from "./routes/user-routes.js";
import { gameRoutes } from "./routes/game-routes.js";
import shopRoutes from "./routes/shop-routes.js";
import battleRoutes from "./routes/battle-routes.js";
import socialRoutes from "./routes/social-routes.js";
import { adminRoutes } from "./routes/admin-routes.js";

export function createApp() {
  const app = express();
  app.use(express.json());

  // 포켓몬 ANSI 아트 API (인증 불필요)
  app.get("/api/art/:species", (req, res) => {
    const species = req.params.species.replace(/[^a-zA-Z0-9-]/g, "");
    const artPath = path.resolve(process.cwd(), "data/colorscripts/small/regular", species);
    try {
      const art = fs.readFileSync(artPath, "utf-8");
      res.type("text/plain").send(art);
    } catch {
      res.status(404).send("");
    }
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/user", userRoutes);
  app.use("/api/game", gameRoutes);
  app.use("/api/shop", shopRoutes);
  app.use("/api/battle", battleRoutes);
  app.use("/api/social", socialRoutes);
  app.use("/api/admin", adminRoutes);

  return app;
}
