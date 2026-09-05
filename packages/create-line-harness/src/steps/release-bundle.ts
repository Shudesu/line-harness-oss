import * as p from "@clack/prompts";
import pc from "picocolors";
import { Readable } from "node:stream";
import {
  fetchManifest,
  findRelease,
  parseBundleStream,
  verifyBundleHashes,
  verifyBundleIntegrity,
  type Manifest,
  type ParsedBundle,
  type ReleaseEntry,
} from "@line-harness/update-engine";

export interface FetchedRelease {
  manifest: Manifest;
  release: ReleaseEntry;
  bundle: ParsedBundle;
}

/**
 * Fetch the release manifest and download + verify an official bundle.
 *
 * Setup deploys the Worker from this bundle (instead of building from
 * source) so the shipped `_version.ts` stamp — version + component hashes —
 * matches a manifest entry and `update`'s fork detection recognizes the
 * install as vanilla. A source build would report 0.0.0-dev and lock the
 * install out of automatic updates permanently.
 *
 * `pinVersion` re-selects the release a previous (resumed) setup run chose.
 * A resume must NOT float to a newer `latest`: earlier completed steps
 * (schema/migrations, deployed artifacts) belong to the pinned release, and
 * mixing releases would leave the Worker running against a mismatched
 * schema. Run `update` after setup completes to move to the newest release.
 *
 * Fail-fast by design: no silent fallback to a source deploy. An installer
 * who can't reach GitHub Releases should see why and decide (retry, or use
 * `--from-source` knowing updates won't apply).
 */
export async function fetchLatestRelease(
  manifestUrl: string,
  pinVersion?: string,
): Promise<FetchedRelease> {
  const s = p.spinner();

  s.start("リリース情報取得中...");
  let manifest: Manifest;
  try {
    manifest = await fetchManifest(manifestUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    s.stop(pc.red(`リリース情報の取得に失敗: ${msg}`));
    throw new Error(
      [
        "公式リリース情報 (release-manifest.json) を取得できませんでした。",
        `  URL: ${manifestUrl}`,
        "ネットワークを確認して再実行してください。",
        "（開発用にソースからデプロイする場合は --from-source を付けてください。",
        "  その場合、自動アップデートは利用できません）",
      ].join("\n"),
    );
  }

  const targetVersion = pinVersion ?? manifest.latest;
  const release = findRelease(manifest, targetVersion);
  if (!release) {
    s.stop(pc.red("リリース情報を解決できません"));
    throw new Error(
      pinVersion
        ? [
            `前回のセットアップで選択したリリース v${pinVersion} が manifest に見つかりません。`,
            "最初からやり直すには、インストールディレクトリの .line-harness-setup.json を削除して再実行してください。",
          ].join("\n")
        : `manifest が壊れています (latest=${manifest.latest} が releases にありません)`,
    );
  }
  if (pinVersion && pinVersion !== manifest.latest) {
    p.log.info(
      `再開のため前回選択したリリース v${pinVersion} を継続します（最新: v${manifest.latest}。セットアップ完了後に \`npx create-line-harness update\` で更新できます）`,
    );
  }
  if (!release.worker_bundle_hash) {
    // Old-pipeline release: its bundle ships a broken worker stub. Deploying
    // it would produce a dead install, so fail before touching anything.
    s.stop(pc.red(`最新リリース v${release.version} は新しいインストーラーに未対応`));
    throw new Error(
      [
        `最新リリース v${release.version} の bundle にはデプロイ可能な Worker が含まれていません`,
        "（新リリースパイプライン対応前の形式です）。対応リリースの公開をお待ちください。",
        "（開発用途では --from-source でソースからデプロイできます。",
        "  その場合、自動アップデートは利用できません）",
      ].join("\n"),
    );
  }
  s.stop(`最新リリース: v${release.version}`);

  s.start(
    `Bundle ダウンロード中 (${(release.bundle_size_bytes / 1024 / 1024).toFixed(1)} MB)...`,
  );
  let bundle: ParsedBundle;
  try {
    const res = await fetch(release.bundle_url);
    if (!res.ok) throw new Error(`bundle fetch HTTP ${res.status}`);
    if (!res.body) throw new Error("bundle response has no body");
    bundle = await parseBundleStream(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    );
    const hashes = verifyBundleHashes(bundle);
    verifyBundleIntegrity(hashes, release);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    s.stop(pc.red(`Bundle 検証失敗: ${msg}`));
    throw new Error(
      "リリース bundle のダウンロードまたはハッシュ検証に失敗しました。再実行してください。",
    );
  }
  s.stop(`Bundle 取得 + ハッシュ検証 OK (v${release.version})`);

  return { manifest, release, bundle };
}
