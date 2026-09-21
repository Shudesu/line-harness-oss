# 自前 OSS vs L Harness Cloud（Phase E 判断メモ）

## 概要

| 観点 | OSS 自前（create-line-harness） | [L Harness Cloud](https://lharness.cloud/) |
|------|----------------------------------|--------------------------------------------|
| 初期ハードル | Cloudflare + LINE チャネル設定が必要 | Google アカウント連携でプロビジョニング（動画で紹介のワンクリック） |
| 月額ソフトウェア | 0 円（MIT） | 開発元マネージド（料金は公式サイト） |
| インフラ費用 | Cloudflare 無料枠 + LINE 配信料 | Cloud 側に含まれる／別途の可能性あり |
| カスタム改変 | 自由（フォーク・Worker 改修） | 制限あり（マネージド） |
| LINE Login / LIFF | セットアップで自分で登録 | テナントによっては未設定から開始（後から設定） |
| データ所在 | 自分の D1 / R2 | 開発元運用のマルチテナント |

## ハイブリッド運用の推奨パターン

1. **学習・検証**: OSS を自前デプロイし、ウェビナー・マイル・プールを [30-Video-Feature-Playbook.md](../wiki/30-Video-Feature-Playbook.md) で試す。
2. **本番スケール**: 運用負荷を下げたい場合は Cloud へ移行を検討。移行時は API キー・Worker URL・LINE Webhook の差し替え、D1 データのエクスポート／再投入方針を事前に決める。
3. **カスタム PR**: OSS フォークで機能開発し、上流に PR（例: Cursor/MCP 対応）を送りつつ、本番は Cloud または自前のどちらか一方に固定する。

## OSS 単体では再現しないもの

- Google ログインだけでテナントが立ち上がる **Workers for Platforms 型のマルチテナント基盤**
- **ザ・ハーネス** による X / Instagram / Threads の配信パネル一体運用（LINE Harness OSS のスコープ外）

## 意思決定チェックリスト

- [ ] チームに `wrangler` / Cloudflare 運用スキルがあるか
- [ ] LINE チャネル（複数アカウント・プール）を自社で保持するか
- [ ] 動画アップロード（ffmpeg + R2）を誰が実行するか（Cursor MCP 想定）
- [ ] 本番 SLA を Cloud に委ねる必要があるか

## 参照

- [README — L Harness Cloud](../../README.md)
- [29-Cursor-Integration.md](../wiki/29-Cursor-Integration.md)
