// themes.ts: rutas de temas (v0.60 P2.4)
import { FastifyInstance } from "fastify";
import { getThemesService, type Theme, type ThemeColors } from "../services/themesService.js";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";

export async function themesRoutes(app: FastifyInstance): Promise<void> {
  const svc = getThemesService();

  app.get<{ Querystring: { builtin?: string } }>("/themes", async (req) => {
    const includeBuiltin = req.query.builtin !== "false";
    const list = svc.list(includeBuiltin);
    return { themes: list, active: svc.active() };
  });

  app.get<{ Params: { id: string } }>("/themes/:id", async (req) => {
    const t = svc.get(req.params.id);
    if (!t) throw E.val("EC-TH-001", "Tema no encontrado", { context: { id: req.params.id }, statusCode: 404 });
    return t;
  });

  app.get<{ Params: { id: string } }>("/themes/:id/css", async (req) => {
    const t = svc.get(req.params.id);
    if (!t) throw E.val("EC-TH-002", "Tema no encontrado", { context: { id: req.params.id }, statusCode: 404 });
    return { css: svc.toCss(t) };
  });

  app.post<{ Body: Omit<Theme, "id" | "createdAt" | "builtin"> }>("/themes", async (req, reply) => {
    const b = req.body ?? {} as any;
    if (!b.name || !b.colors) {
      throw E.val("EC-TH-003", "name y colors requeridos", { context: { body: b } });
    }
    const t = svc.create({
      name: b.name,
      description: b.description ?? "",
      mode: b.mode ?? "auto",
      author: b.author ?? "user",
      colors: b.colors,
    });
    reply.code(201);
    logOp("themes", "created", true, { id: t.id, name: t.name });
    return t;
  });

  app.patch<{ Params: { id: string }; Body: Partial<Theme> }>("/themes/:id", async (req) => {
    const t = svc.update(req.params.id, req.body ?? {});
    if (!t) throw E.val("EC-TH-004", "Tema no encontrado o es builtin", {
      context: { id: req.params.id }, statusCode: 404,
    });
    return t;
  });

  app.delete<{ Params: { id: string } }>("/themes/:id", async (req) => {
    const ok = svc.remove(req.params.id);
    if (!ok) throw E.val("EC-TH-005", "Tema no encontrado o es builtin", {
      context: { id: req.params.id }, statusCode: 404,
    });
    return { deleted: true };
  });

  app.post<{ Params: { id: string } }>("/themes/active/:id", async (req) => {
    const ok = svc.setActive(req.params.id);
    if (!ok) throw E.val("EC-TH-006", "Tema no encontrado", {
      context: { id: req.params.id }, statusCode: 404,
    });
    return { active: req.params.id };
  });

  app.get("/themes/export", async () => ({
    json: svc.exportUserThemes(),
  }));
}
