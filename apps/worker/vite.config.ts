import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// React + Tailwind は salon-booking ページ (?page=salon-book) でのみ使う。
// main.ts から動的 import するので React チャンクは別ファイルに分離され、
// 既存の form / Google Calendar booking 利用者には load されない。
export default defineConfig({
  plugins: [cloudflare(), react(), tailwindcss()],
  // Windows: Vite のデフォルトは IPv6 (::1) のみになり、Chrome が localhost を
  // 127.0.0.1 に解決すると管理画面 (3001) から API へ fetch できない。
  server: {
    host: "127.0.0.1",
  },
});
