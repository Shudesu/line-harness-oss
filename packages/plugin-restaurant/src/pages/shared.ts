export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** For values embedded inside inline <script> string literals. */
export function escapeJs(s: string): string {
  return JSON.stringify(s)
}

export const BASE_CSS = /* css */ `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --brand: #b45309; --brand-dark: #92400e; --bg: #faf7f2; --card: #ffffff;
    --text: #1c1917; --muted: #78716c; --line: #e7e5e4; --ok: #15803d; --err: #b91c1c;
  }
  body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.6; padding-bottom: 40px; }
  .wrap { max-width: 480px; margin: 0 auto; padding: 16px; }
  .header { background: linear-gradient(135deg, var(--brand), var(--brand-dark)); color: #fff;
    padding: 20px 16px; text-align: center; }
  .header h1 { font-size: 18px; font-weight: 700; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    padding: 18px; margin-top: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
  .card h2 { font-size: 15px; margin-bottom: 10px; color: var(--brand-dark); }
  label { display: block; font-size: 13px; color: var(--muted); margin: 10px 0 4px; }
  input, select, textarea { width: 100%; padding: 12px; border: 1px solid var(--line);
    border-radius: 10px; font-size: 16px; background: #fff; }
  button { width: 100%; padding: 14px; margin-top: 14px; border: 0; border-radius: 10px;
    background: var(--brand); color: #fff; font-size: 16px; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: .5; }
  button.ghost { background: #fff; color: var(--brand); border: 1.5px solid var(--brand); }
  .msg { margin-top: 10px; font-size: 14px; padding: 10px 12px; border-radius: 8px; display: none; }
  .msg.ok { display: block; background: #f0fdf4; color: var(--ok); }
  .msg.err { display: block; background: #fef2f2; color: var(--err); }
  .muted { color: var(--muted); font-size: 13px; }
  .row { display: flex; gap: 10px; }
  .row > * { flex: 1; }
  .hidden { display: none !important; }
`
