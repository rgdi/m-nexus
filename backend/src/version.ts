// Versión del backend — sincronizada con package.json vía build.
// v0.28: extraída a un módulo separado para evitar el ciclo de imports
// entre server.ts (que importa utils/log.js) y los routes.
export const VERSION = "0.29.1";
