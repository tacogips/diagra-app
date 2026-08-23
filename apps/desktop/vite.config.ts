import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [solid()],
  clearScreen: false,
  // Workspace packages are symlinked, so a second physical copy of the Solid
  // runtime would break reactivity across package boundaries.
  resolve: {
    dedupe: ["solid-js"],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
