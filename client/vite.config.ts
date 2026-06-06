import { defineConfig } from "vite";

// @pixeloffice/shared is consumed as raw TypeScript source (its package "main"
// points at src/index.ts). Excluding it from dep pre-bundling lets Vite compile
// it together with the client so we always read the single source of truth.
export default defineConfig({
  server: {
    port: 5173,
  },
  optimizeDeps: {
    exclude: ["@pixeloffice/shared"],
  },
});
