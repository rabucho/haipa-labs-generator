import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./src"),
      // `server-only` throws outside a React Server Component environment;
      // tests run in plain node, so stub it out.
      "server-only": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./tests/stubs/server-only.ts"),
    },
  },
});
