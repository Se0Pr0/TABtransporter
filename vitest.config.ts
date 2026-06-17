import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    pool: "threads"
  },
  resolve: {
    alias: {
      "@shared": new URL("./src/shared", import.meta.url).pathname
    }
  }
});
