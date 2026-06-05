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
