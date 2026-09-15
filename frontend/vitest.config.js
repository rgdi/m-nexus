// vitest.config.js — config for frontend unit tests.
// v2.2.0 W6: jsdom environment for DOM testing (since we have vanilla JS).

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.js"],
      exclude: ["src/screens/**", "src/widgets/**", "src/main.js"],
    },
  },
});
