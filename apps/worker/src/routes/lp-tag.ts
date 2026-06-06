/**
 * L-TRACK 互換: LP用タグ JS 配信
 *
 * LP の HTML head 最下部に以下を設置すると、CTAボタンのURLが動的に書き換わる:
 *   <script src="https://<worker-domain>/lp/track.js"></script>
 *
 * 広告媒体への入稿URL: `<LPURL>?ltr_code=<トラックコード>`
 *  → LP表示時、JSが ltr_code パラメータを読み取り、
 *    LP内の `<a href="https://<worker-domain>/t/...">` の href を
 *    `/t/<ltr_code>` に書き換える。
 *  → 他のクエリパラメータ（ltp/fbclid/gclid/utm_*）も CTA URL に引継ぐ。
 *
 * L-TRACK の ltrack_lp.js と同等仕様。
 */

import { Hono } from 'hono';
import type { Env } from '../index.js';

const lpTag = new Hono<Env>();

/**
 * 検証用 LP HTML（本番では 404）。
 * 【C3 監査対応 2026-06-06】公開状態を放置すると第三者から踏まれて広告ログ汚染するため、
 * env.LP_TEST_ENABLED='true' のときだけ配信。default は配信しない。
 */
lpTag.get('/lp/test', async (c) => {
  const enabled = (c.env as unknown as { LP_TEST_ENABLED?: string }).LP_TEST_ENABLED === 'true';
  if (!enabled) {
    return c.notFound();
  }
  const workerOrigin = (c.env.WORKER_URL || `https://${new URL(c.req.url).host}`).replace(/\/+$/, '');
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LP用タグ JS 検証ページ</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 2em auto; padding: 1em; line-height: 1.6; }
    .cta { display: inline-block; padding: 1em 2em; background: #06c755; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; }
    .debug { background: #f5f5f5; padding: 1em; margin-top: 2em; font-family: monospace; font-size: 12px; word-break: break-all; }
  </style>
</head>
<body>
  <h1>LP用タグ JS 検証ページ</h1>
  <p>このページを <code>?ltr_code=&lt;linkId&gt;&amp;fbclid=...&amp;ltp=...</code> 付きで開くと、下のボタン URL が自動的に書き換わります。</p>

  <p style="text-align:center; margin: 2em 0;">
    <!-- href のドメインが LP用タグJS の TRACK_BASE と一致していれば置換対象。
         ltr_code は data 属性ではなく URL クエリから受け取る。 -->
    <a class="cta" href="${workerOrigin}/t/PLACEHOLDER">📲 LINE で追加する</a>
  </p>

  <div class="debug">
    <strong>クエリ:</strong> <span id="qs"></span><br>
    <strong>書き換え後のリンク:</strong> <span id="href"></span><br>
    <strong>lhm_lp_loaded:</strong> <span id="loaded"></span>
  </div>

  <script>
    document.getElementById('qs').textContent = window.location.search || '(なし)';
    // 書き換え後の href を遅延表示（LP用タグJS が実行された後）
    setTimeout(function() {
      var a = document.querySelector('a.cta');
      document.getElementById('href').textContent = a ? a.href : '(取得不可)';
      document.getElementById('loaded').textContent = String(!!window.lhm_lp_loaded);
    }, 200);
  </script>

  <!-- L-TRACK 互換: LP用タグ JS。LP HTML head か body 最下部に置く。 -->
  <script src="${workerOrigin}/lp/track.js"></script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
});

function buildLpTrackJs(workerOrigin: string): string {
  return `(function() {
  // 重複起動防止
  if (window.lhm_lp_loaded) return;
  window.lhm_lp_loaded = true;

  // トラックURLのベース
  var TRACK_BASE = ${JSON.stringify(workerOrigin + '/t/')};

  // 現在ページのクエリパラメータ
  var search = window.location.search;
  if (!search) return;

  // ltr_code でトラックコード置換
  function replaceLtrCode() {
    var params = new URLSearchParams(search);
    if (!params.has('ltr_code')) return;
    var ltrCode = params.get('ltr_code');
    // UUID 形式または英数字10文字以上を許可（L-TRACK は厳密10文字だが、harness は柔軟）
    if (!/^[a-zA-Z0-9-]{8,}$/.test(ltrCode)) return;

    var links = document.querySelectorAll('a[href^="' + TRACK_BASE + '"]');
    for (var i = 0; i < links.length; i++) {
      try {
        var url = new URL(links[i].getAttribute('href'), document.baseURI);
        // パスの末尾を ltr_code に差し替える
        url.pathname = '/t/' + ltrCode;
        links[i].setAttribute('href', url.toString());
      } catch (e) {
        console.warn('[lhm-lp] href parse error:', e);
      }
    }
  }

  // クエリパラメータ（ltr_code 以外）を CTA URL に引継ぐ
  function appendParams() {
    var inherit = new URLSearchParams(search);
    inherit.delete('ltr_code');

    var links = document.querySelectorAll('a[href^="' + TRACK_BASE + '"]');
    for (var i = 0; i < links.length; i++) {
      try {
        var url = new URL(links[i].getAttribute('href'), document.baseURI);
        var entries = inherit.entries();
        var entry = entries.next();
        while (!entry.done) {
          var key = entry.value[0];
          var val = entry.value[1];
          if (!url.searchParams.has(key)) {
            url.searchParams.append(key, val);
          }
          entry = entries.next();
        }
        links[i].setAttribute('href', url.toString());
      } catch (e) {
        console.warn('[lhm-lp] href parse error:', e);
      }
    }
  }

  // 広告媒体タグでパラメータが動的付与される場合があるため少し遅延
  function exec() {
    setTimeout(function() {
      replaceLtrCode();
      appendParams();
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', exec);
  } else {
    exec();
  }
})();`;
}

// GET /lp/track.js — LP用タグ JS（L-TRACK の ltrack_lp.js 相当）
lpTag.get('/lp/track.js', (c) => {
  // Low fix: WORKER_URL の末尾スラッシュを除去（TRACK_BASE が // にならないように）
  const origin = (c.env.WORKER_URL || new URL(c.req.url).origin).replace(/\/+$/, '');
  const js = buildLpTrackJs(origin);
  c.header('Content-Type', 'application/javascript; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=3600'); // 1時間キャッシュ
  return c.body(js);
});

export { lpTag };
