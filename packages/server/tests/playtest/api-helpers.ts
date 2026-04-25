/**
 * HTTP and Socket.IO helpers for AI playtest scenarios.
 *
 * HttpClient wraps supertest with a fluent token/admin-key API so a single
 * client instance can switch between authenticated and admin contexts.
 *
 * createPvpClient wraps a socket.io-client connection with a
 * promise-based emit/wait API: tests can `await client.waitFor("pvp:matched")`
 * with a timeout instead of hand-rolling event listeners.
 */
import request from "supertest";
import type { Express } from "express";
import { io as ioClient, type Socket } from "socket.io-client";

export class HttpClient {
  public token?: string;
  /** Admin key — sent as x-admin-key header (NOT bearer; admin-middleware reads x-admin-key). */
  public adminKey?: string;

  constructor(public app: Express, token?: string) {
    this.token = token;
  }

  setToken(token: string | undefined): this {
    this.token = token;
    return this;
  }

  setAdminKey(key: string | undefined): this {
    this.adminKey = key;
    return this;
  }

  /**
   * Returns a fresh HttpClient sharing the same app but using the given
   * admin key. Useful when a scenario needs to mix authenticated user
   * calls with admin calls without mutating its base client.
   */
  asAdmin(adminKey?: string): HttpClient {
    const next = new HttpClient(this.app, this.token);
    next.adminKey = adminKey ?? this.adminKey ?? process.env.POKELOG_ADMIN_KEY;
    return next;
  }

  private applyHeaders(req: request.Test): request.Test {
    if (this.token) req.set("Authorization", `Bearer ${this.token}`);
    if (this.adminKey) req.set("x-admin-key", this.adminKey);
    return req;
  }

  get(path: string): request.Test {
    return this.applyHeaders(request(this.app).get(path));
  }
  post(path: string, body?: unknown): request.Test {
    return this.applyHeaders(request(this.app).post(path).send(body ?? {}));
  }
  put(path: string, body?: unknown): request.Test {
    return this.applyHeaders(request(this.app).put(path).send(body ?? {}));
  }
  delete(path: string, body?: unknown): request.Test {
    const r = request(this.app).delete(path);
    if (body !== undefined) r.send(body);
    return this.applyHeaders(r);
  }
}

export interface PvpClientHandle {
  socket: Socket;
  /** Emit an event and resolve once the underlying socket has flushed it. */
  emit(event: string, data?: unknown): Promise<void>;
  /**
   * Wait for the next occurrence of `event`. Rejects if it doesn't arrive
   * within `timeoutMs` (default 5000). Listener is one-shot.
   */
  waitFor<T = unknown>(event: string, timeoutMs?: number): Promise<T>;
  /** Disconnect and clean up listeners. */
  close(): void;
}

/**
 * Connect a Socket.IO client to the playtest server, perform the
 * pvp:auth handshake with the supplied JWT, and return a thin handle
 * around the socket exposing promise-based emit/wait helpers.
 */
export async function createPvpClient(
  baseUrl: string,
  token: string,
): Promise<PvpClientHandle> {
  const socket = ioClient(baseUrl, {
    autoConnect: false,
    transports: ["websocket"],
    forceNew: true,
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("pvp client connect timeout")), 5000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.connect();
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("pvp client auth timeout")), 5000);
    socket.once("pvp:authenticated", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("pvp:error", (e) => {
      clearTimeout(timer);
      const message = (e as { message?: string })?.message ?? "pvp:auth error";
      reject(new Error(message));
    });
    socket.emit("pvp:auth", { token });
  });

  const handle: PvpClientHandle = {
    socket,
    emit(event: string, data?: unknown): Promise<void> {
      return new Promise<void>((resolve) => {
        socket.emit(event, data);
        // socket.io has no per-emit ack on the basic API; we resolve on
        // the next tick so callers can `await client.emit(...)` and trust
        // the event has been queued onto the wire.
        setImmediate(resolve);
      });
    },
    waitFor<T>(event: string, timeoutMs = 5000): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.off(event, listener);
          reject(new Error(`waitFor("${event}") timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        const listener = (data: unknown) => {
          clearTimeout(timer);
          resolve(data as T);
        };
        socket.once(event, listener);
      });
    },
    close() {
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch {
        // ignore
      }
    },
  };
  return handle;
}
