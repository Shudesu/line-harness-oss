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

### 2.1 Private → OSS（手動運用）

```
Private の同期対象ブランチ → bash scripts/sync-oss.sh を手動実行 → OSS に反映
```

- `.github/workflows/sync-oss.yml` は意図的に失敗運用 (即時公開でうっかり OSS に出る事故防止)
- OSS に反映したいタイミングで `bash scripts/sync-oss.sh` を手動実行
- `rsync` は **no-delete** で実行（OSS-only community files を消さない）
- 除外ルールは `scripts/oss-sync.excludes`
- シークレット自動置換は `scripts/oss-secret-redactions.sed`
- リーク検知は `scripts/oss-secret-grep.patterns`
- リーク検知で失敗時は同期中止

同期前に必ず確認すること:

```bash
cd /path/to/line-harness
git status --short
git branch --show-current
```

作業ブランチから同期する場合は、そのブランチが「今回 OSS に出してよい内容だけ」を含むこと。`origin/main` が古い場合でも、最新の安全な同期元が作業ブランチであれば、そのブランチを同期対象にしてよい。

### 2.2 OSS → Private（手動・必須）

```
OSS PR マージ → Private に取り込み → Private の同期対象ブランチから sync で OSS に反映
```

**OSS で PR がマージされたら、次の Private → OSS sync の前に必ず Private に取り込むこと。**
取り込まないまま private 側で同名ファイルを持つと、次の sync で OSS 側の変更が上書きされる。

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

# 4. push または同期対象ブランチ上で manual sync
git push
```

### 2.3 OSS Issue / PR 対応の Definition of Done

OSS の Issue / PR は、ユーザーが自分で検証しなくてもよい状態まで AI エージェントが責任を持って進める。完了条件は次の通り。

- [ ] 対象 Issue / PR の再現条件・期待動作・影響範囲を整理した
- [ ] 修正は必ず Private リポで行った（OSS への直接変更・直 push はしない）
- [ ] 仕様の分岐、fallback、過去データ互換性をコード上で扱った
- [ ] 回帰テストまたは source-level test を追加/更新した
- [ ] 変更範囲に応じた typecheck / build / test を実行し、結果を記録した
- [ ] `git diff --check` を通した
- [ ] OSS sync 前に `scripts/sync-oss.sh --dry-run` で公開差分を確認した
- [ ] OSS sync PR を作成し、OSS CI が通ったことを確認した
- [ ] 対応した Issue / PR に、修正内容・検証コマンド・同期 PR / commit を返信した
- [ ] 本番影響がある場合は private 側のデプロイ有無とロールバック方針を明記した

「コードを書いた」だけでは完了ではない。GitHub 上で保守されていることが外部から分かる状態、つまり Issue / PR に検証済みの返信が残り、OSS 側に同期 PR が出ている状態を完了とする。

### 2.4 フローチャート

```
[Private 開発] ──manual sync──→ [OSS 反映]
                                                        ↑
[OSS PR マージ] ──cherry-pick/apply──→ [Private に取込] ──sync──┘
```

---

## 3. 除外ファイル（OSS に含めないもの）

除外ルールは `scripts/oss-sync.excludes` を正とする。同期スクリプト内に
同じ除外リストを重複定義しないこと。

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
| `CONTRIBUTING.md` / `SECURITY.md` / `SUPPORT.md` | OSS 独自の community / security policy |
| `CHANGELOG.md` | OSS 独自版あり |
| `PROGRESS.md` | 内部進捗 |
| `SPEC.md` | 内部仕様 |
| `COMPETITOR_FEATURES.md` | 競合分析 |
| `.github/ISSUE_TEMPLATE` / `.github/PULL_REQUEST_TEMPLATE.md` / `.github/labeler.yml` | OSS 独自の intake 設定 |
| `.github/workflows/` | Private 用 CI/CD |
| `node_modules/` / `.pnpm-store/` / `dist/` / `.next/` / `apps/web/out/` / `apps/liff/dist/` / `*.tsbuildinfo` | ビルド成果物 |
| `scripts/sync-oss.sh` / `scripts/oss-*` | private→OSS 同期の内部運用 |
| `scripts/deploy-production.sh` / `scripts/fix-liff-endpoint-url.mjs` | private 本番運用 |

**新しい除外ファイルを追加する場合、`scripts/oss-sync.excludes` を更新すること。**

---

## 4. シークレット保護

### 4.1 自動置換パターン

sync 時に `scripts/oss-secret-redactions.sed` のパターンを自動で置換する。新しいシークレットが追加された場合、同ファイルと `scripts/oss-secret-grep.patterns` の両方を更新すること。

| パターン | 置換後 |
|---------|--------|
| 本番 CF アカウント ID | `YOUR_ACCOUNT_ID` |
| テスト CF アカウント ID | `YOUR_DEV_ACCOUNT_ID` |
| 本番 D1 ID | `YOUR_D1_DATABASE_ID` |
| テスト D1 ID | `YOUR_DEV_D1_DATABASE_ID` |
| 運営メールアドレス | `your-email@example.com` |

### 4.2 リーク検知

sync 完了前に `scripts/oss-secret-grep.patterns` でリークチェック。検出されたら sync 中止。

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

semver に従う。**root `package.json` を唯一の真実**とし、umbrella package (apps/web, apps/worker, packages/sdk, packages/mcp-server) は `scripts/sync-versions.sh` で同一バージョンに揃える。

- **patch** (x.x.N): バグ修正
- **minor** (x.N.0): 新機能追加
- **major** (N.0.0): 破壊的変更

`packages/db` / `packages/shared` / `packages/create-line-harness` / `packages/plugin-template` は umbrella 外 — それぞれ独立した version を持つ (内部依存 or CLI/template の独自リリース cadence のため)。

### 7.2 リリース手順

```bash
# 1. CHANGELOG.md にエントリ追加

# 2. root package.json のバージョンを bump (例: 0.12.0 → 0.13.0)
node -e "const fs=require('fs');const p=require('./package.json');p.version='0.13.0';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');"

# 3. umbrella packages を同期 (apps/web, apps/worker, packages/sdk, packages/mcp-server)
bash scripts/sync-versions.sh

# 4. ビルド + テスト
pnpm --filter @line-harness/sdk build && pnpm --filter @line-harness/sdk test
pnpm --filter @line-harness/mcp-server build

# 5. npm publish (pnpm で)
cd packages/sdk && pnpm publish --access public --no-git-checks
cd packages/mcp-server && pnpm publish --access public --no-git-checks

# 6. commit + push (pre-push hook が版差を再検証 → 不一致なら拒否)
git add -A
git commit -m "chore: release v0.13.0"
git push  # GitHub Actions が deploy を走らせる

# 7. OSS リポに GitHub Release 作成
gh release create v0.13.0 --repo Shudesu/line-harness-oss --title "v0.13.0" --notes "..."
```

### 7.3 npm publish は pnpm で

`npm publish` ではなく `pnpm publish` を使う。`workspace:*` が自動で実バージョンに変換される。

### 7.4 ダッシュボード表示バージョン

`apps/web/next.config.ts` がビルド時に root `package.json` を読み、`APP_VERSION` env として注入する。サイドバーの `LINE Harness v{APP_VERSION}` 表示はこの値を使う。手動の env 上書き不要。

### 7.5 バージョン同期チェック

- `bash scripts/sync-versions.sh` — root → umbrella packages へ伝播 (apply mode)
- `bash scripts/sync-versions.sh --check` — 不一致を検出のみ (CI/hook 用)
- `.githooks/pre-push` が push 前に `--check` を自動実行。不一致なら push 拒否

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
- [ ] `scripts/oss-sync.excludes` に除外漏れがないか
- [ ] 置換パターンに漏れがないか
- [ ] OSS で先行した community / governance 変更が private に取り込まれているか
- [ ] `bash scripts/sync-oss.sh` の実行対象ブランチが、今回公開してよい内容だけを含むか

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
