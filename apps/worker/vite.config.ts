import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [cloudflare()],
  server: {
    port: 8787,
    strictPort: true,
  },
  preview: {
    port: 8787,
    strictPort: true,
  },
});
