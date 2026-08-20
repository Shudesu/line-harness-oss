-- 外部 SSO (GET /admin/sso?token=...) のリプレイ防止用 jti 台帳。
--
-- SSO トークンは URL に載るため、ブラウザ履歴・Referer・プロキシログに残る。
-- 署名と exp だけでは「一度使われたトークンの再送」を防げないので、jti を
-- 使い捨てにする。Worker isolate のメモリは共有されないため D1 に置く。
--
-- exp はトークンの有効期限 (unix 秒)。行は次回以降の SSO 時に遅延削除する
-- (consumeAdminSsoJti が INSERT の前に `exp <= now` を DELETE)。専用 cron は
-- 不要 — 行寿命は最大 300 秒 (ADMIN_SSO_MAX_TTL_SECONDS) で、SSO 自体が
-- 低頻度なため放置されても数行規模に収まる。
CREATE TABLE IF NOT EXISTS sso_jti (
  jti TEXT PRIMARY KEY,
  exp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sso_jti_exp ON sso_jti(exp);
