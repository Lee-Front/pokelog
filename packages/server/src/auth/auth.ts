import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const SALT_ROUNDS = 10;

function getJwtSecret(): string {
  const secret = process.env.POKELOG_JWT_SECRET;
  if (!secret) {
    throw new Error("POKELOG_JWT_SECRET environment variable is required");
  }
  return secret;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Mints a JWT for the given user. Optionally accepts an explicit `iat`
 * (seconds-since-epoch) that overrides jsonwebtoken's auto-stamped value.
 * Used by logout-all to issue a successor token whose iat is strictly
 * greater than the just-recorded `tokenInvalidatedAt` cutoff so the new
 * token doesn't get rejected by the iat-vs-cutoff gate.
 */
export function issueToken(userId: string, iat?: number): string {
  if (iat === undefined) {
    return jwt.sign({ userId }, getJwtSecret(), { expiresIn: "30d" });
  }
  // When supplying iat manually we must also set exp manually because
  // `expiresIn` and a payload `exp` cannot coexist; we replicate the
  // 30-day window relative to the supplied iat.
  const exp = iat + 30 * 24 * 60 * 60;
  return jwt.sign({ userId, iat, exp }, getJwtSecret());
}

export interface TokenPayload {
  userId: string;
  /** Seconds-since-epoch, as set by jsonwebtoken. Present for any token issued by issueToken. */
  iat?: number;
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (typeof decoded === "string" || !decoded || typeof decoded !== "object") {
      return null;
    }
    const userId = "userId" in decoded ? decoded.userId : null;
    if (typeof userId !== "string") return null;
    const iat = "iat" in decoded && typeof decoded.iat === "number" ? decoded.iat : undefined;
    return { userId, iat };
  } catch {
    return null;
  }
}
