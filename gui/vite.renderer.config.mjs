import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Renderer build for the Electron GUI. Output goes to gui/renderer-dist/ which
// main.js loads in production; dev uses DEEPSEEK_CODE_GUI_DEV_URL → this dev server.
// .mjs so it is ESM even though gui/ is a CommonJS package (main.js/preload.js use require).
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  base: "./", // Electron loads via file:// — relative asset paths required
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  build: {
    outDir: "renderer-dist",
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  }
});
