/**
 * Setup-guidance page for deployments without a LINE Login channel / LIFF.
 *
 * L Harness Cloud tenants are provisioned without LINE Login config:
 * LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET / LIFF_URL are unset and
 * the tenant's line_accounts row has no login_channel_id / liff_id yet. Routes
 * that build LINE Login or LIFF URLs from those values must return this page
 * instead of crashing with a 500 (`liffUrl.match()` on undefined) or sending
 * client_id=undefined to access.line.me.
 *
 * 503 (not 200): the link is expected to work once the operator finishes
 * setup — 503 keeps crawlers and uptime checks from treating the guidance
 * page as a healthy endpoint, and ad platforms from caching it.
 */
export const LOGIN_SETUP_DOCS_URL = 'https://harness-wiki.pages.dev/line';

export function loginUnconfiguredPage(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>LINE ログインが未設定です</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Hiragino Sans', 'Helvetica Neue', system-ui, sans-serif; background: #f5f7f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 20px; box-shadow: 0 2px 20px rgba(0,0,0,0.06); text-align: center; max-width: 480px; width: 90%; padding: 48px 32px; border: 1px solid rgba(0,0,0,0.04); }
    h2 { font-size: 18px; color: #333; margin-bottom: 16px; }
    p { font-size: 14px; color: #666; line-height: 1.8; margin-bottom: 24px; }
    .docs { display: inline-block; background: #06C755; color: #fff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 999px; }
    .footer { font-size: 11px; color: #bbb; margin-top: 28px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h2>LINE ログインが未設定です</h2>
    <p>このリンクを利用するには LINE ログインチャネルの設定が必要です。<br>管理者の方は、管理画面から LINE ログインチャネル（および LIFF）を設定してください。</p>
    <a class="docs" href="${LOGIN_SETUP_DOCS_URL}" rel="noopener">設定ドキュメントを見る</a>
    <p class="footer">設定が完了すると、このリンクは自動的に有効になります</p>
  </div>
</body>
</html>`;
}
