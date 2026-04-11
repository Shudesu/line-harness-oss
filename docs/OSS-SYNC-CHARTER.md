# OSS 同期憲章 (OSS Sync Charter)

> LINE Harness プロジェクトにおける Private ↔ OSS リポジトリの同期・運用ルール。
> 全コントリビューター・AIエージェントはこの憲章に従うこと。

---

## 1. リポジトリ構成

| リポ | 用途 | 可視性 | URL |
|------|------|--------|-----|
| `Shudesu/line-harness` | 開発用（本番設定・シークレット含む） | Private | — |
| `Shudesu/line-harness-oss` | 公開用（コミュニティ貢献受付） | Public | github.com/Shudesu/line-harness-oss |

**原則: Private が upstream、OSS が downstream。ただし OSS への外部 PR は Private に逆マージする。**

---

## 2. 同期フロー

### 2.1 Private → OSS（自動）

```
Private push → GitHub Actions (sync-oss.yml) → OSS に自動反映
```

- main ブランチへの push で自動実行
- `rsync --delete` で同期（除外ファイルあり）
- シークレット自動置換（sed）
- リーク検知で失敗時は同期中止

### 2.2 OSS → Private（手動・必須）

```
OSS PR マージ → Private に cherry-pick → Private push → sync で OSS に反映
```

**OSS で PR がマージされたら、次の Private → OSS sync の前に必ず Private に取り込むこと。**
取り込まないと sync の `rsync --delete` で OSS 側の変更が消える。

#### 手順

```bash
# 1. Private リポで OSS を fetch
cd /path/to/line-harness
git fetch oss

# 2. PR の diff をパッチとして適用
gh pr diff <PR番号> --repo Shudesu/line-harness-oss > /tmp/pr<番号>.patch
git apply /tmp/pr<番号>.patch --3way

# 3. コンフリクトがあれば解消して commit
git add -A
git commit -m "feat: <説明> (from OSS PR #<番号>)"

# 4. push（sync-oss.yml が自動で OSS に反映）
git push
```

### 2.3 フローチャート

```
[Private 開発] ──push──→ [GitHub Actions sync] ──→ [OSS 反映]
                                                        ↑
[OSS PR マージ] ──cherry-pick──→ [Private に取込] ──push──┘
```

---

## 3. 除外ファイル（OSS に含めないもの）

sync-oss.yml と sync-oss.sh の両方で一致させること。

| ファイル/ディレクトリ | 理由 |
|---------------------|------|
| `CLAUDE.md` | 本番環境情報・デプロイ手順 |
| `.mcp.json` | API キー |
| `*.toml.bak` | 本番設定のバックアップ |
| `.claude/` | AIエージェント設定 |
| `.env` / `.env.local` / `.env.production` / `.env.staging` | 環境変数 |
| `.env.example` | Private 版は除外（OSS 独自版あり） |
| `docs/superpowers/` | 内部プラン・設計書 |
| `README.md` | OSS 独自版あり |
| `CHANGELOG.md` | OSS 独自版あり |
| `PROGRESS.md` | 内部進捗 |
| `SPEC.md` | 内部仕様 |
| `COMPETITOR_FEATURES.md` | 競合分析 |
| `.github/workflows/` | Private 用 CI/CD |
| `node_modules/` / `dist/` / `.next/` / `apps/web/out/` | ビルド成果物 |

**新しい除外ファイルを追加する場合、sync-oss.yml と sync-oss.sh の両方を更新すること。**

---

## 4. シークレット保護

### 4.1 自動置換パターン

sync 時に以下のパターンを自動で置換する。新しいシークレットが追加された場合、両方のスクリプトに追加すること。

| パターン | 置換後 |
|---------|--------|
| 本番 CF アカウント ID | `YOUR_ACCOUNT_ID` |
| テスト CF アカウント ID | `YOUR_DEV_ACCOUNT_ID` |
| 本番 D1 ID | `YOUR_D1_DATABASE_ID` |
| テスト D1 ID | `YOUR_DEV_D1_DATABASE_ID` |
| 運営メールアドレス | `your-email@example.com` |

### 4.2 リーク検知

sync 完了前に grep でリークチェック。検出されたら sync 中止。

### 4.3 絶対禁止事項

- **CLAUDE.md にシークレットを書かない**（プレースホルダーのみ）
- **コミットメッセージにシークレットを書かない**
- **PR の説明文にシークレットを書かない**
- **新しいファイルを作成したら、シークレットが含まれないか確認してから push**

### 4.4 事故時の対応

シークレットが OSS に漏洩した場合:

1. **即座にシークレットをローテーション**（API キー再生成、パスワード変更等）
2. OSS リポからファイル削除
3. 漏洩したのがアカウント ID 等（単独では悪用不可）の場合、履歴書き換えは不要（force push は全フォークに影響）
4. 漏洩したのが API キー・トークン等（単独で悪用可能）の場合、BFG で履歴除去 + force push を検討（フォーク数とリスクを天秤にかける）
5. GitHub Support にキャッシュ削除を依頼

---

## 5. ブランチ保護

### OSS リポ（line-harness-oss）

| 設定 | 値 |
|------|-----|
| Force push | 禁止 |
| Branch 削除 | 禁止 |
| Admin にも適用 | はい |

### Private リポ（line-harness）

main ブランチに直接 push 可（開発速度優先）。

---

## 6. 外部 PR の受け入れ基準

### 6.1 レビュー必須項目

- [ ] セキュリティ上の懸念がないか（SQL injection, XSS, 認証バイパス等）
- [ ] 既存機能を壊さないか
- [ ] コードスタイルが一貫しているか
- [ ] シークレットが含まれていないか
- [ ] テストが追加/更新されているか（該当する場合）

### 6.2 マージ後の必須作業

1. **Private リポに cherry-pick**（必須・即時）
2. 本番デプロイが必要な場合は Mac Mini から deploy
3. npm パッケージの更新が必要な場合は SDK / MCP Server を publish

### 6.3 マージしてはいけないもの

- 破壊的変更（事前に Issue で議論）
- 大規模なリファクタリング（事前に提案）
- ライセンス変更
- 依存関係の大幅な変更

---

## 7. リリースフロー

### 7.1 バージョニング

semver に従う。次回リリースから SDK・MCP・タグを統一バージョンに揃える。

- **patch** (x.x.N): バグ修正
- **minor** (x.N.0): 新機能追加
- **major** (N.0.0): 破壊的変更

### 7.2 リリース手順

```bash
# 1. CHANGELOG.md にエントリ追加
# 2. package.json バージョン更新（SDK, MCP 両方）
# 3. ビルド + テスト
pnpm --filter @line-harness/sdk build && pnpm --filter @line-harness/sdk test
pnpm --filter @line-harness/mcp-server build

# 4. npm publish（pnpm で）
cd packages/sdk && pnpm publish --access public --no-git-checks
cd packages/mcp-server && pnpm publish --access public --no-git-checks

# 5. commit + push（sync-oss.yml が OSS に反映）
git commit -m "chore: release vX.Y.Z"
git push

# 6. OSS リポに GitHub Release 作成
gh release create vX.Y.Z --repo Shudesu/line-harness-oss --title "vX.Y.Z" --notes "..."
```

### 7.3 npm publish は pnpm で

`npm publish` ではなく `pnpm publish` を使う。`workspace:*` が自動で実バージョンに変換される。

---

## 8. 本番デプロイ

### 8.1 デプロイ元

Mac Mini SSH 経由。wrangler.toml を一時的に書き換えてデプロイ → 元に戻す。

### 8.2 注意事項

- wrangler.toml を本番設定のままコミットしない
- デプロイ後は `git checkout wrangler.toml` で必ず元に戻す
- OSS の PR をマージした場合、Private に取り込んでからデプロイ

---

## 9. AI エージェント向けルール

MCP や Claude Code で操作する際の追加ルール。

- **メッセージ送信（send_message, broadcast）はユーザー確認なしで実行しない**
- **OSS に sync されるファイルにシークレットを書かない**
- **CLAUDE.md にアカウント ID・DB ID・メールアドレスの実値を書かない**
- **外部 PR がマージされたら、次の作業前に Private に取り込む**
- **npm publish は `pnpm publish` を使う**

---

## 10. チェックリスト

### Private → OSS sync 前

- [ ] 新しいファイルにシークレットが含まれていないか
- [ ] sync-oss.yml と sync-oss.sh の除外リストが一致しているか
- [ ] 置換パターンに漏れがないか

### OSS PR マージ後

- [ ] Private リポに cherry-pick した
- [ ] コンフリクトを解消した
- [ ] Private push して sync が成功した
- [ ] OSS 側で変更が生存しているか確認した

### リリース時

- [ ] CHANGELOG.md 更新した
- [ ] SDK と MCP のバージョンを揃えた
- [ ] pnpm publish した（npm publish ではない）
- [ ] OSS に GitHub Release を作成した
- [ ] 本番デプロイした（必要な場合）
