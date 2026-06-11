import { pino } from "pino";
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Structured application logger.
 *
 * Level is taken from POKELOG_LOG_LEVEL (default: "info", or "silent" under
 * tests so the suite output stays clean). In development a human-readable,
 * colorized transport is used when POKELOG_LOG_PRETTY is set; production emits
 * newline-delimited JSON for log aggregators.
 */

function resolveLevel(): string {
  if (process.env.POKELOG_LOG_LEVEL) return process.env.POKELOG_LOG_LEVEL;
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return "silent";
  return "info";
}

const usePretty = process.env.POKELOG_LOG_PRETTY === "1"
  || process.env.POKELOG_LOG_PRETTY === "true";

export const logger = pino({
  level: resolveLevel(),
  base: undefined, // drop default pid/hostname noise
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(usePretty
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        },
      }
    : {}),
});

/**
 * Express middleware that attaches a child logger and a request id to every
 * request (available as `req.log` and `req.id`), and logs request completion.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req: IncomingMessage, res: ServerResponse) => {
    const incoming = req.headers["x-request-id"];
    const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
    res.setHeader("x-request-id", id);
    return id;
  },
  // Health-style/static art endpoints are noisy; keep them at debug.
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
});

/** Create a named child logger for a subsystem (e.g. "polling", "storage"). */
export function childLogger(component: string): typeof logger {
  return logger.child({ component });
}
