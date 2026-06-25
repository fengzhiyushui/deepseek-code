import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: fileURLToPath(new URL("./node_modules/react/jsx-dev-runtime.js", import.meta.url)),
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: fileURLToPath(new URL("./node_modules/react/jsx-runtime.js", import.meta.url)),
      },
      {
        find: /^react$/,
        replacement: fileURLToPath(new URL("./node_modules/react/index.js", import.meta.url)),
      },
      {
        find: /^react-dom\/client$/,
        replacement: fileURLToPath(new URL("./node_modules/react-dom/client.js", import.meta.url)),
      },
      {
        find: /^lucide-react$/,
        replacement: fileURLToPath(new URL("./node_modules/lucide-react/dist/esm/lucide-react.js", import.meta.url)),
      },
      {
        find: /^@douyinfe\/semi-ui$/,
        replacement: fileURLToPath(new URL("./node_modules/@douyinfe/semi-ui/lib/es/index.js", import.meta.url)),
      },
      {
        find: /^@douyinfe\/semi-ui\/react19-adapter$/,
        replacement: fileURLToPath(new URL("./node_modules/@douyinfe/semi-ui/lib/es/react19-adapter.js", import.meta.url)),
      },
      {
        find: /^@douyinfe\/semi-ui\/dist\/css\/semi\.min\.css$/,
        replacement: fileURLToPath(new URL("./node_modules/@douyinfe/semi-ui/dist/css/semi.min.css", import.meta.url)),
      },
      {
        find: /^@douyinfe\/semi-icons$/,
        replacement: fileURLToPath(new URL("./node_modules/@douyinfe/semi-icons/lib/es/index.js", import.meta.url)),
      },
    ],
  },
  server: {
    fs: {
      allow: [".."],
    },
  },
});
