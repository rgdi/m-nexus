// Structured routes: databases + rows + views (orchestrator).

import type { FastifyInstance } from "fastify";
import { registerDatabaseRoutes } from "./structuredDatabases.js";
import { registerRowRoutes } from "./structuredRows.js";
import { registerViewRoutes } from "./structuredViews.js";

export async function structuredRoutes(app: FastifyInstance): Promise<void> {
  await registerDatabaseRoutes(app);
  await registerRowRoutes(app);
  await registerViewRoutes(app);
}
