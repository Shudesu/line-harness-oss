# OSS 同期憲章 (OSS Sync Charter)

> L Harness プロジェクトにおける Private ↔ OSS リポジトリの同期・運用ルール。
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

### 2.1 Private → OSS（PR ベース運用）

```
Private PR merge → OSS sync branch → OSS PR → OSS CI → OSS merge
```

**OSS `main` への直 push は禁止。必ず OSS PR を作る。**

- `scripts/sync-oss.sh` は dry-run がデフォルト
- 実書き込みは `--apply` が必要
- `--apply` は OSS checkout が `main` / `master` の場合に失敗する
- `rsync --delete` は使わない
- 除外リスト・秘匿化ルール・リーク検知パターンは `scripts/oss-*` に集約する
- `.github/workflows/sync-oss.yml` も同じ `scripts/sync-oss.sh` を呼び出し、OSS branch + PR を作る
- OSS-only の README / community health files / GitHub templates / workflows は同期対象外として保護する

#### ローカル dry-run

```bash
cd /Users/ai/claudecode/line-harness
bash scripts/sync-oss.sh \
  --dry-run \
  --oss-dir /Users/ai/claudecode/line-harness-oss
```

#### ローカル apply

OSS 側は必ず専用 worktree / branch にする。

```bash
git -C /Users/ai/claudecode/line-harness-oss worktree add \
  /Users/ai/claudecode/.worktrees/line-harness-oss/sync-example \
  main -b sync/private-example

cd /Users/ai/claudecode/line-harness
bash scripts/sync-oss.sh \
  --apply \
  --oss-dir /Users/ai/claudecode/.worktrees/line-harness-oss/sync-example

git -C /Users/ai/claudecode/.worktrees/line-harness-oss/sync-example status
```

### 2.2 OSS → Private（手動・必須）

```
OSS PR マージ → Private に cherry-pick → Private push → sync で OSS に反映
```

**OSS で PR がマージされたら、次の Private → OSS sync の前に必ず Private に取り込むこと。**
取り込まないと、次の Private → OSS sync PR で同じ領域の変更が競合・上書きされる。

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

# 4. push（必要に応じて sync-oss.yml を手動実行して OSS PR を作る）
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

### 2.4 OSS PR Sandbox Merge Gate

OSS PR は、merge 前に sandbox gate を通す。特に auth / CORS / LIFF / migration / webhook / scenario / broadcast / cron に触る PR は、OSS CI 成功だけで merge しない。

詳細手順は `docs/OSS-SANDBOX-MERGE-GATE.md` を参照すること。

### 2.5 フローチャート

```
[Private 開発] ──merge──→ [OSS sync PR] ──CI──→ [OSS 反映]
                                                    ↑
[OSS PR マージ] ──cherry-pick──→ [Private に取込] ──┘
```

---

## 3. 除外ファイル（OSS に含めないもの）

同期対象外のファイルは `scripts/oss-sync.excludes` を唯一の真実にすること。

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
| `.github/ISSUE_TEMPLATE/` / `.github/PULL_REQUEST_TEMPLATE.md` / `.github/labeler.yml` | OSS 運用ファイル |
| `CONTRIBUTING.md` / `SECURITY.md` / `SUPPORT.md` | OSS community health files |
| `node_modules/` / `dist/` / `.next/` / `apps/web/out/` | ビルド成果物 |

**新しい除外ファイルを追加する場合、`scripts/oss-sync.excludes` を更新すること。**

---

## 4. シークレット保護

### 4.1 自動置換パターン

sync 時に以下のパターンを自動で置換する。新しいシークレットが追加された場合、`scripts/oss-secret-redactions.sed` と `scripts/oss-secret-grep.patterns` を更新すること。

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

semver に従う。**root `package.json` を唯一の真実**とし、umbrella package (apps/web, apps/worker, packages/sdk, packages/mcp-server) は `scripts/sync-versions.sh` で同一バージョンに揃える。

- **patch** (x.x.N): バグ修正
- **minor** (x.N.0): 新機能追加
- **major** (N.0.0): 破壊的変更

`packages/db` / `packages/shared` / `packages/create-line-harness` / `packages/plugin-template` は umbrella 外 — それぞれ独立した version を持つ (内部依存 or CLI/template の独自リリース cadence のため)。

### 7.2 リリース手順

**publish は手元から実行できない。GitHub Actions の `publish-npm.yml` が trusted publishing (OIDC) で行う。**
npm アカウントはパスキー運用で TOTP コードが出せないため、手元の `npm publish` / `pnpm publish` は 2FA を満たせず実行不可能。

```bash
# 1. CHANGELOG.md にエントリ追加

# 2. root package.json のバージョンを bump (例: 0.22.0 → 0.23.0)
node -e "const fs=require('fs');const p=require('./package.json');p.version='0.23.0';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');"

# 3. umbrella packages を同期 (apps/web, apps/worker, packages/sdk, packages/mcp-server)
bash scripts/sync-versions.sh

# 4. ビルド + テスト
pnpm --filter @line-harness/sdk build && pnpm --filter @line-harness/sdk test
pnpm --filter @line-harness/mcp-server build

# 5. commit + push → PR を main にマージ
#    (pre-push hook が版差を再検証 → 不一致なら拒否)
git add -A
git commit -m "chore: release v0.23.0"
git push  # GitHub Actions が deploy を走らせる

# 6. main にマージされた後に publish workflow を dispatch
gh workflow run publish-npm.yml --ref main -f target=all -f dry_run=false
gh run watch  # 完走を確認

# 7. OSS リポに GitHub Release 作成
gh release create v0.23.0 --repo Shudesu/line-harness-oss --title "v0.23.0" --notes "..."
```

**順序が重要**: publish workflow は `main` の内容を checkout する。バージョン bump が main に入る前に dispatch しても、古いバージョンを publish する（もしくは publish 済み扱いで skip する）だけで意味がない。必ず「commit + push（PR マージ）→ workflow_dispatch」の順にすること。2026-08-25 の v0.23.0 リリースはこの順で実施した。

### 7.3 publish workflow (`publish-npm.yml`)

手元 publish は禁止ではなく、そもそも不可能。すべて `.github/workflows/publish-npm.yml` 経由で行う（前提・ハマりどころは workflow 冒頭のコメントに詳述）。

| input | 値 |
|-------|-----|
| `target` | `all` / `sdk-only` / `mcp-server-only` / `create-line-harness-only` |
| `dry_run` | `true` なら build + pack までで publish しない |

- **通常は `target=all` を使う。** `packages/mcp-server` の `@line-harness/sdk` 依存は `workspace:*` で、`pnpm pack` 時に厳密バージョン（例 `0.23.0`）へ書き換わる。したがって **mcp-server だけを publish することはできず、sdk も同じバージョンで同時に publish する必要がある**
- workflow は「既に npm 上にあるバージョンは skip」する冪等実装。`target=all` に未変更パッケージが混ざっても no-op になるので、迷ったら `all` でよい。部分失敗しても同じ dispatch を再実行できる
- 内部は `pnpm pack` でパックして `npm publish <tarball>` する。pnpm 9 の publish パスが OIDC ハンドシェイクをしないため、pack は pnpm・publish は npm という組み合わせにしている
- `create-line-harness` は umbrella 外の独立バージョンで、`@line-harness/update-engine` に `workspace:^` 依存する。update-engine はこの workflow では publish されないため、参照先バージョンが npm 上に存在しないと install が壊れる。`npm view @line-harness/update-engine version` で先に確認すること
- 事前確認したいときは `gh workflow run publish-npm.yml --ref main -f target=all -f dry_run=true`

### 7.4 ダッシュボード表示バージョン

`apps/web/next.config.ts` がビルド時に root `package.json` を読み、`APP_VERSION` env として注入する。サイドバーの `L Harness v{APP_VERSION}` 表示はこの値を使う。手動の env 上書き不要。

Admin UI はスクリーンショットだけでデプロイ元を判別できるよう、`APP_COMMIT_SHA` (GitHub Actions の `GITHUB_SHA`、またはローカル git SHA) と `APP_BUILD_TIME` もビルド時に埋め込み、サイドバーに `build <sha> · <UTC time>` として表示する。

root version だけを変更した場合にも Admin deploy が走るよう、`deploy-web.yml` の path filter には root `package.json` を含める。通常リリースでは `scripts/sync-versions.sh` で `apps/web/package.json` も更新されるが、path filter 側でも root version を明示的に監視して二重に守る。

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
- **npm publish を手元で実行しない**（パスキー 2FA のため不可能） — `gh workflow run publish-npm.yml --ref main -f target=all -f dry_run=false` で GitHub Actions に任せる
- **publish workflow の dispatch は main へのマージ後**（workflow は main を checkout する）

---

## 10. チェックリスト

### Private → OSS sync 前

- [ ] 新しいファイルにシークレットが含まれていないか
- [ ] `scripts/sync-oss.sh --dry-run` を実行した
- [ ] OSS 側は専用 branch / worktree になっている
- [ ] `scripts/oss-sync.excludes` に OSS-only ファイルが含まれている
- [ ] `scripts/oss-secret-redactions.sed` と `scripts/oss-secret-grep.patterns` に漏れがない
- [ ] OSS PR を作り、OSS CI が通った

### OSS PR マージ後

- [ ] Private リポに cherry-pick した
- [ ] コンフリクトを解消した
- [ ] Private push して sync が成功した
- [ ] OSS 側で変更が生存しているか確認した

### リリース時

- [ ] CHANGELOG.md 更新した
- [ ] SDK と MCP のバージョンを揃えた
- [ ] バージョン bump を main にマージしてから publish workflow を dispatch した（手元 publish ではない）
- [ ] `target=all` で dispatch した（mcp-server 単独 publish は不可）
- [ ] workflow run が成功し、npm 上に新バージョンが出たことを確認した
- [ ] OSS に GitHub Release を作成した
- [ ] 本番デプロイした（必要な場合）
