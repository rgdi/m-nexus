// JWT real con access + refresh tokens.
// v0.12: reemplaza el antiguo X-Device-Id simple.
// - Access token: vida corta (15 min), firma HS256
// - Refresh token: vida larga (30 días), almacenado en tabla revocable
// - Refresh rota el token (rotación de tokens = mejor seguridad)

import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { config } from "../config.js";

const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;

export interface AccessTokenPayload {
  sub: string;        // deviceId
  name?: string;
  scope: string;      // ej. "device"
  iat: number;
  exp: number;
  jti: string;        // jwt id único
}

export interface RefreshTokenRecord {
  tokenId: string;
  deviceId: string;
  issuedAt: number;
  expiresAt: number;
  /** Cuando se rota, este queda revocado. */
  revoked: boolean;
}

const refreshTokens = new Map<string, RefreshTokenRecord>();

export function generateTokenId(): string {
  return randomBytes(16).toString("hex");
}

export function signAccessToken(deviceId: string, name?: string): { token: string; jti: string; expiresAt: number } {
  const jti = generateTokenId();
  const payload: Omit<AccessTokenPayload, "iat" | "exp"> = {
    sub: deviceId,
    name,
    scope: "device",
    jti,
  };
  const token = jwt.sign(payload, config.jwtSecret, { algorithm: "HS256", expiresIn: ACCESS_TTL_SEC });
  const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_TTL_SEC;
  return { token, jti, expiresAt };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] }) as AccessTokenPayload;
  } catch (e) {
    throw new Error("INVALID_TOKEN");
  }
}

export interface IssueRefreshResult {
  token: string;
  tokenId: string;
  expiresAt: number;
}

export function issueRefreshToken(deviceId: string): IssueRefreshResult {
  const tokenId = generateTokenId();
  const raw = randomBytes(48).toString("hex");
  const token = `${tokenId}.${raw}`; // formato "id.payload" para lookup O(1)
  const now = Date.now();
  const expiresAt = now + REFRESH_TTL_SEC * 1000;
  refreshTokens.set(tokenId, { tokenId, deviceId, issuedAt: now, expiresAt, revoked: false });
  return { token, tokenId, expiresAt };
}

export function rotateRefreshToken(oldToken: string, deviceId: string): IssueRefreshResult {
  // Revocar el viejo y emitir uno nuevo (token rotation)
  const oldId = oldToken.split(".")[0];
  const old = refreshTokens.get(oldId);
  if (old) old.revoked = true;
  return issueRefreshToken(deviceId);
}

export function validateRefreshToken(token: string): RefreshTokenRecord | null {
  const id = token.split(".")[0];
  const rec = refreshTokens.get(id);
  if (!rec) return null;
  if (rec.revoked) return null;
  if (rec.expiresAt < Date.now()) {
    refreshTokens.delete(id);
    return null;
  }
  return rec;
}

export function revokeAllForDevice(deviceId: string): number {
  let count = 0;
  for (const rec of refreshTokens.values()) {
    if (rec.deviceId === deviceId && !rec.revoked) {
      rec.revoked = true;
      count++;
    }
  }
  return count;
}

export function getRefreshTokenStats() {
  return {
    total: refreshTokens.size,
    revoked: Array.from(refreshTokens.values()).filter((r) => r.revoked).length,
  };
}
