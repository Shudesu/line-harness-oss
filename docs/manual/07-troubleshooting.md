---
chapter: 7
title: トラブルシュート
tier: free
status: placeholder
---

# 第7章 トラブルシュート

> 【tier: 無料】実運用で踏んだ事故ナレッジ集。配信・デプロイ・認証・LIFF 周りの「やらかし」を辞書的に引ける形にする。

## 章の目的

- 各事故パターンを「症状 → 原因 → 対処 → 再発防止」の 4 行で引ける
- 配信・デプロイ・LIFF・Cloudflare 周りの定番事故を踏む前に予防できる
- 事故時に「どの feedback ナレッジを読めばいいか」が辞書的に分かる

## 想定読者

- 既に LINE Harness を稼働させている全運用者
- 過去の事故を踏まないために事前に目を通しておきたい新規導入者

## 目次

- 7.1 配信系事故
- 7.2 デプロイ・本番環境系事故
- 7.3 LIFF / 認証系事故
- 7.4 Cloudflare / wrangler 系事故
- 7.5 OSS 同期 / シークレット系事故

## 参考ナレッジリンク（見出しのみ）

各項目の本文は別セッションで執筆予定。ここではナレッジ ID の対応のみ列挙する。

### 配信系
- メッセージ送信は必ず事前確認（`feedback-never-send-without-confirmation`）
- LINE 配信の URL は必ずトラッキングリンク経由（`feedback-line-harness-tracked-links`）

### デプロイ・本番環境系
- 本番 `.env.production` に絶対触るな（`feedback-never-touch-production-env`）
- `.wrangler/deploy` は絶対消すな（`feedback-never-rm-wrangler-deploy`）
- コード変更後は必ずデプロイ（`feedback-always-deploy`）
- デプロイは Mac Mini SSH 不要（`feedback-deploy-no-macmini`）

### LIFF / 認証系
- 友だち追加は `/auth/line` 経由必須（`feedback-auth-line-uuid`）
- PC 向け QR は LIFF URL（`feedback-liff-qr-uuid`）
- LIFF エンドポイント URL 必須ルール（`liff-endpoint-url-rule`）
- `NEXT_PUBLIC_API_URL` に localhost フォールバック禁止（`feedback-no-localhost-fallback`）

### Cloudflare / wrangler 系
- `wrangler secret put` は `printf` で（`feedback-wrangler-secret-printf`）
- `.env` に `CLOUDFLARE_API_TOKEN` 入れるな（`feedback-cf-env-no-api-token`）
- CF Pages プロジェクト名はユニークに（`feedback-cf-pages-naming`）

### OSS 同期 / シークレット系
- LINE Harness OSS sync は手動運用（`feedback-line-harness-oss-manual-sync`）
- CLAUDE.md にシークレット書くな（`feedback-no-secrets-in-claude-md`）
- 公開ドキュメントに実値書くな（`feedback-no-real-values-in-wiki`）

### 運用判断系
- 自分が触ってない変更に手を出すな（`feedback-dont-touch-unrelated-changes`）
- 手動コマンドはクリップボードコピー + 1 行（`feedback-manual-commands`）

## 前提

- 第 2 章でセットアップを済ませている
- 事故時はまず本章で症状を引き、該当 feedback ナレッジへ進む

## 次の章

なし。本マニュアルの最終章。獲得設計・運用フローに戻る場合は第 4 章 / 第 5 章へ、自動化に進む場合は第 6 章へ。

---
*このファイルはプレースホルダーです。各事故の「症状 → 原因 → 対処 → 再発防止」本文は別セッションで執筆します。*
