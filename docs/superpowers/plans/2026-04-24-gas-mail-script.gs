/**
 * Fixx Booking Mail Relay (GAS Web App)
 * ------------------------------------------------
 * fixbox-biz@fixbox.jp から予約確定/リマインダーメールを送信する。
 * Cloudflare Worker (line-harness) からHTTPS POSTで叩かれる。
 *
 * デプロイ:
 *   デプロイ → ウェブアプリ
 *   実行するユーザー: 自分 (fixbox-biz@fixbox.jp)
 *   アクセスできるユーザー: 全員
 *   → 発行されたURLを GAS_MAIL_URL に設定
 *
 * セキュリティ: URLは opaque (推測不可能) だが念のため shared secret でも検証。
 */

const SECRET = 'c32f9dad5b65d8feb8966d731ad387a9ab82a4331243f48273fd823291b7a176';
const SENDER_NAME = 'Fixx 予約システム';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.secret !== SECRET) {
      return jsonResponse({ error: 'unauthorized' });
    }

    if (!body.to || !body.subject || !body.html) {
      return jsonResponse({ error: 'missing required fields: to, subject, html' });
    }

    const to = Array.isArray(body.to) ? body.to.join(',') : String(body.to);
    // cc: respect client — empty/missing array means no CC at all.
    const cc = Array.isArray(body.cc) && body.cc.length > 0
      ? body.cc.join(',')
      : '';

    const options = {
      to: to,
      subject: String(body.subject),
      htmlBody: String(body.html),
      name: SENDER_NAME,
    };
    if (cc) {
      options.cc = cc;
    }

    MailApp.sendEmail(options);

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: String(err && err.message || err) });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ヘルスチェック用 (ブラウザで開いて動作確認)
function doGet() {
  return jsonResponse({ service: 'fixx-booking-mail-relay', status: 'ok' });
}
