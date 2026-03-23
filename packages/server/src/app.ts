import express from "express";
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

  app.use("/api/auth", authRoutes);
  app.use("/api/user", userRoutes);
  app.use("/api/game", gameRoutes);
  app.use("/api/shop", shopRoutes);
  app.use("/api/battle", battleRoutes);
  app.use("/api/social", socialRoutes);
  app.use("/api/admin", adminRoutes);

  return app;
}
