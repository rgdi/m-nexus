// Vitest config para el backend.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // v0.28: node:sqlite es experimental; vite puede tener problemas para resolverlo.
    server: {
      deps: {
        external: ["node:sqlite", "sqlite"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts", "src/**/*.d.ts"],
    },
  },
});
