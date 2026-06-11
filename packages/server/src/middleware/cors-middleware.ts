import type { Request, Response, NextFunction, RequestHandler } from "express";
import cors from "cors";
import { getConfig } from "../storage/config-store.js";
import { childLogger } from "../logger.js";

const log = childLogger("cors");

/**
 * Config-driven CORS for browser-based web integrations.
 *
 * Allowed origins come from `config.server.corsAllowedOrigins`. The list is an
 * explicit allowlist — only those exact origins may read responses from a
 * browser. When the list is empty or unset, CORS is disabled entirely (no
 * CORS headers are emitted), which keeps same-origin browsers, non-browser
 * clients (the CLI), and the existing test suite unaffected.
 *
 * Credentials are allowed (Authorization: Bearer survives preflight), and the
 * reflected origin is echoed per the allowlist — never the wildcard "*", which
 * is incompatible with credentialed requests.
 */

/** Normalize an origin for comparison: trim and drop any trailing slash. */
function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

async function resolveAllowedOrigins(): Promise<string[]> {
  try {
    const config = await getConfig();
    const list = config.server?.corsAllowedOrigins;
    if (!Array.isArray(list)) return [];
    return list.map(normalizeOrigin).filter(Boolean);
  } catch (err) {
    log.error({ err }, "Failed to load CORS allowlist; denying cross-origin");
    return [];
  }
}

const corsOptionsDelegate: Parameters<typeof cors>[0] = (req, callback) => {
  // The cors package types the first arg loosely; it is the request.
  void resolveAllowedOrigins().then((allowed) => {
    if (allowed.length === 0) {
      // CORS disabled: no headers, behave as if the middleware is absent.
      callback(null, { origin: false });
      return;
    }
    callback(null, {
      origin: (requestOrigin, originCallback) => {
        // Requests without an Origin header (same-origin, curl, CLI) pass through.
        if (!requestOrigin) {
          originCallback(null, true);
          return;
        }
        const isAllowed = allowed.includes(normalizeOrigin(requestOrigin));
        if (!isAllowed) {
          log.warn({ requestOrigin }, "Rejected cross-origin request (origin not in allowlist)");
        }
        // Do not error on rejection; simply omit CORS headers so the browser
        // blocks it, while the request itself still completes server-side.
        originCallback(null, isAllowed);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Key"],
      exposedHeaders: ["X-Request-Id"],
      maxAge: 600,
    });
  });
};

/** Express middleware applying the config-driven CORS policy. */
export function corsMiddleware(): RequestHandler {
  const handler = cors(corsOptionsDelegate);
  return (req: Request, res: Response, next: NextFunction) => handler(req, res, next);
}
