// tests/helpers/auth.ts — register a throwaway device and get a bearer token.
//
// v2.37.0. GET /api/v1/notes and GET /api/v1/flashcards are no longer in
// the auth middleware's PUBLIC_PATHS: they returned every note body and
// every card's correctIndex to anyone. Tests that exercise those routes
// through the full server now need a real token, or they would be
// asserting against a 401.
//
// Usage:
//
//   let auth: TestAuth;
//   beforeAll(async () => {
//     app = await buildServer();
//     auth = await registerDevice(app);
//   });
//   await app.inject({ method: "GET", url: "/api/v1/notes", ...auth.headers });

import type { FastifyInstance } from "fastify";

export interface TestAuth {
  token: string;
  refreshToken: string;
  deviceId: string;
  /** Spread directly into an `app.inject` options object. */
  headers: Record<string, string>;
}

export async function registerDevice(
  app: FastifyInstance,
  prefix = "t",
): Promise<TestAuth> {
  const unique = Math.random().toString(36).slice(2, 10);
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/register",
    payload: {
      username: `${prefix}${unique}`,
      password: "demo123",
      deviceId: `${prefix}-${unique}`,
      deviceName: "vitest",
      platform: "test",
    },
  });
  const body = r.json() ?? {};
  if (!body.accessToken) {
    throw new Error(
      `registerDevice failed (${r.statusCode}): ${r.body.slice(0, 300)}`,
    );
  }
  return {
    token: body.accessToken,
    refreshToken: body.refreshToken,
    deviceId: `${prefix}-${unique}`,
    headers: { authorization: `Bearer ${body.accessToken}` },
  };
}
