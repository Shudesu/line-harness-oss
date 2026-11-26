import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// three-surfaces bundle（2026-08-24）: このアプリを配布ビルドで他の2サーフェス
// （admin, apps/worker 自身の dist/client）と同居させて同一オリジンから配信するとき、
// asset URL が `/<base>/assets/...` に解決されるよう `base` を渡す必要がある。
// `VITE_BASE_PATH` は配布ビルド時のみ設定される（未設定時は従来どおり
// '/' — このアプリ自身の `dev`/`preview`/`deploy`（`wrangler pages deploy`）は変わらず動く）。
// `import.meta.env.BASE_URL` としてクライアント側にも自動で伝播する（vite の既定動作）ので、
// main.tsx の BrowserRouter の `basename` にもそのまま使える。
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
  build: { outDir: 'dist' },
});
