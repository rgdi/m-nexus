// Vitest config: alias para mockear el módulo `obsidian`.
//
// El package `obsidian` v1.13+ tiene `"main": ""` lo que rompe la resolución
// de vite. Usamos un alias al mock local.

import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/main.ts"],
    },
  },
  resolve: {
    alias: {
      // Mock del módulo obsidian
      obsidian: resolve(__dirname, "tests/mockObsidian.ts"),
      // Alias común para el paquete
      "@": resolve(__dirname, "src"),
    },
  },
});
