import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";

/** Matches the Worker: anything else is rejected there anyway. */
const UPLOADABLE_EXTENSIONS = [".m3u8", ".ts"];
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
/** Per call. A full two-hour encode is ~3,600 files, so the agent loops ~8 times. */
const BATCH = 500;
const PARALLEL = 10;

/**
 * The Worker's rate limiter (apps/worker/src/middleware/rate-limit.ts) allows
 * AUTHENTICATED_MAX = 1000 requests/minute per token, sliding window. At
 * BATCH=500 / PARALLEL=10 an unthrottled upload dispatches fast enough that
 * a two-hour encode (~3,600 files, i.e. ~3,600 requests plus one `finish`)
 * blows through that limit inside the second or third batch. Pace sustained
 * throughput to 900 req/min instead — 10% headroom under the hard limit so
 * normal jitter (retries, a concurrent admin-UI request on the same token)
 * doesn't tip it over 1000 and start a 429 loop in the first place.
 */
const SAFE_REQUESTS_PER_MINUTE = 900;
const SAFE_REQUESTS_PER_MS = SAFE_REQUESTS_PER_MINUTE / 60_000;

/** Cap on 429 retries per request. A persistent 429 (limiter stuck, or
 * another client sharing the token) must surface as a real error instead of
 * retrying forever. */
const MAX_429_RETRIES = 3;
/** Used only if the server ever omits Retry-After on a 429. */
const DEFAULT_429_WAIT_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Blocks, if necessary, so that having dispatched `requestsSoFar` requests
 * since `batchStart` does not exceed SAFE_REQUESTS_PER_MINUTE. Called
 * between chunks of PARALLEL requests so a fast connection can't dispatch
 * a whole batch faster than the target rate — the proactive half of staying
 * under the Worker's limiter (see fetchWithRetry429 for the reactive half).
 */
async function paceToTarget(batchStart: number, requestsSoFar: number): Promise<void> {
  const minElapsedMs = requestsSoFar / SAFE_REQUESTS_PER_MS;
  const actualElapsedMs = Date.now() - batchStart;
  if (actualElapsedMs < minElapsedMs) {
    await sleep(minElapsedMs - actualElapsedMs);
  }
}

/**
 * fetch() that retries on 429, honouring the Worker's Retry-After header
 * (seconds — see rate-limit.ts:53). This is the safety net for when the
 * proactive pacing above still isn't enough (e.g. another process sharing
 * the same API key, or a batch resumed right after another one finished).
 * Non-429 responses (including other error statuses) are returned as-is —
 * only rate-limiting is retried here, everything else is the caller's job.
 */
async function fetchWithRetry429(url: string, init: RequestInit): Promise<Response> {
  let res = await fetch(url, init);
  for (let attempt = 0; res.status === 429 && attempt < MAX_429_RETRIES; attempt++) {
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : DEFAULT_429_WAIT_MS;
    await sleep(waitMs);
    res = await fetch(url, init);
  }
  return res;
}

/**
 * `rel` is interpolated unencoded into the request URL. Percent-encoding is
 * NOT an option here: the server rejects any path that still contains "%"
 * after decoding, so encoding e.g. a space into "%20" would make an
 * otherwise-legitimate file fail server-side instead of client-side. The
 * pipeline only ever emits names like "master.m3u8", "index.m3u8",
 * "seg_00001.ts" under directories like "1080p/" — anything outside this
 * charset is not a file this tool is meant to send, so it is skipped and
 * reported rather than mangled into something the server will also refuse.
 */
const SAFE_REL_PATH = /^[A-Za-z0-9._/-]+$/;

/** True for a path (relative, "/"-joined) whose basename is exactly "master.m3u8". */
function isMasterPlaylist(rel: string): boolean {
  return rel === "master.m3u8" || rel.endsWith("/master.m3u8");
}

interface ListAssetsResult {
  /** Uploadable files, sorted with master.m3u8 forced last (see below). */
  files: string[];
  /** Files that matched the extension allowlist but were excluded, with why. */
  skipped: { rel: string; reason: string }[];
}

/**
 * List uploadable files under `dir`, sorted, as paths relative to `dir`.
 *
 * Sorted because the agent addresses batches by index: the order must be the
 * same on every call or a resumed upload would skip files.
 *
 * Within that sort, master.m3u8 is forced to the very end regardless of its
 * alphabetical position (plain sort would put it near the front, since "m"
 * sorts before segment folders like "1080p/"). This is defence in depth on
 * top of the server's completeness check in POST /api/webinars/:id/video
 * (which already refuses to publish a revision with any missing segment): if
 * an upload is abandoned partway through, uploading master.m3u8 last means
 * the abandoned revision never has a master playlist at all, which is a
 * cleaner failure than a master.m3u8 pointing at partially-missing segments.
 * Do not "simplify" this back to a plain alphabetical sort. Note that "last
 * in the sorted list" only bounds *dispatch* order across batches — the
 * upload loop below additionally has to hold master back until every other
 * file in its own batch has *finished*, since a batch is uploaded with
 * bounded concurrency, not strictly in list order.
 */
function listAssets(dir: string): ListAssetsResult {
  const root = resolve(dir);
  const out: string[] = [];
  const skipped: { rel: string; reason: string }[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      // Authoritative symlink check: `entry.isDirectory()` / `entry.isSymbolicLink()`
      // from readdirSync's Dirent reflect the directory entry's own d_type,
      // which is not guaranteed populated on every filesystem, and even when
      // populated it never tells us the entry is a symlink pointing outside
      // `root` — it just says "this is a symlink". lstatSync is the one call
      // that reliably identifies a symlink without following it, so it runs
      // before any other decision about this entry. A symlinked file or
      // directory is rejected outright, never read or recursed into — this
      // is the actual defence against a symlink escaping the named
      // directory (e.g. root/creds.ts -> ~/.aws/credentials).
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        // Report like the charset rejection below: silently dropping a
        // symlinked segment (e.g. one left behind by a disk-saving
        // re-encode) would make "success: true" lie about completeness,
        // surfacing later only as an opaque "missing segments" 400 from
        // finish with nothing pointing back at this file.
        const rel = relative(root, full).split(sep).join("/");
        skipped.push({ rel, reason: "symlink" });
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!st.isFile()) continue; // sockets, fifos, devices, etc. — not uploadable
      if (!UPLOADABLE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
      const rel = relative(root, full).split(sep).join("/");
      if (!SAFE_REL_PATH.test(rel)) {
        skipped.push({ rel, reason: "characters outside [A-Za-z0-9._/-]; would need URL escaping" });
        continue;
      }
      out.push(rel);
    }
  };
  walk(root);
  out.sort((a, b) => {
    const aMaster = isMasterPlaylist(a);
    const bMaster = isMasterPlaylist(b);
    if (aMaster !== bMaster) return aMaster ? 1 : -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return { files: out, skipped };
}

export function registerManageWebinarVideo(server: McpServer): void {
  server.tool(
    "manage_webinar_video",
    [
      "Upload a webinar video (HLS) from this machine and publish it.",
      "",
      "Convert the source video FIRST, in the shell — this tool does not run ffmpeg",
      "(a two-hour encode takes 30+ minutes and would exceed the tool timeout).",
      "Use exactly these arguments so segment length and keyframe interval match",
      "what the player expects:",
      "",
      "  ffmpeg -hide_banner -i INPUT.mp4 \\",
      '    -filter_complex "[0:v]split=3[v1][v2][v3];[v1]scale=-2:1080[v1o];[v2]scale=-2:720[v2o];[v3]scale=-2:480[v3o]" \\',
      '    -map "[v1o]" -map 0:a -map "[v2o]" -map 0:a -map "[v3o]" -map 0:a \\',
      "    -c:v libx264 -preset veryfast -profile:v main -pix_fmt yuv420p -c:a aac -b:a 128k -ac 2 \\",
      "    -b:v:0 5000k -maxrate:v:0 5350k -bufsize:v:0 7500k \\",
      "    -b:v:1 2800k -maxrate:v:1 2996k -bufsize:v:1 4200k \\",
      "    -b:v:2 1400k -maxrate:v:2 1498k -bufsize:v:2 2100k \\",
      '    -force_key_frames "expr:gte(t,n_forced*6)" -sc_threshold 0 \\',
      '    -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2" \\',
      "    -master_pl_name master.m3u8 \\",
      "    -f hls -hls_time 6 -hls_playlist_type vod -hls_list_size 0 \\",
      '    -hls_segment_filename "OUTDIR/%v/seg_%05d.ts" \\',
      '    "OUTDIR/%v/index.m3u8"',
      "",
      "Then read the duration in seconds:",
      "  ffprobe -v error -show_entries format=duration -of csv=p=0 INPUT.mp4",
      "",
      "dir must be that ffmpeg output directory itself — master.m3u8 has to sit",
      "at its root. This is checked before anything is read or uploaded, and",
      "action='upload' fails immediately (no files sent) if master.m3u8 is",
      "missing there, since '.ts' also matches TypeScript source and nothing",
      "else about the directory's contents proves it's HLS output.",
      "",
      "Then:",
      "  1. Pick a revision: the current epoch in MILLISECONDS, as a string.",
      "  2. Call action='upload' repeatedly with that same revision, passing the",
      "     returned nextOffset as offset AND the returned total as expectedTotal",
      "     on every call after the first, until remaining is 0. expectedTotal",
      "     guards against the source directory changing between calls (e.g. a",
      "     segment added after you started uploading) — if the file count",
      "     no longer matches, the call fails instead of silently skipping a",
      "     file, and you must restart the whole upload from offset 0. Re-",
      "     sending a file is otherwise harmless, so a failed call can simply",
      "     be retried. Files are sent in a fixed order with master.m3u8",
      "     always uploaded last and strictly alone, so an interrupted upload",
      "     never leaves a master playlist pointing at missing segments.",
      "     Uploads are paced client-side to stay under the server's rate limit",
      "     (and auto-retry on a 429 with the server's Retry-After) — nothing to",
      "     configure, but budget wall-clock time accordingly: pacing alone puts",
      "     a floor of a few minutes on a ~3,600-file / two-hour encode, and the",
      "     actual multi-gigabyte transfer on top of that commonly makes the",
      "     whole upload take anywhere from several minutes to over an hour",
      "     depending on your connection — this is not a seconds-long operation.",
      "     Check the response's `skipped` field: any file whose name isn't",
      "     plain [A-Za-z0-9._/-] is left out and reported there instead of",
      "     being sent (this should never happen for ffmpeg's own output).",
      "  3. Call action='finish' with the same revision and the duration. This",
      "     verifies every segment referenced by master.m3u8 is present in R2 and",
      "     refuses to publish otherwise.",
      "",
      "Nothing is visible to viewers until 'finish' — an incomplete upload never",
      "goes live, because 'finish' only flips the live revision after confirming",
      "every segment master.m3u8 references is actually present.",
      "",
      "But if this is a REPLACEMENT (the webinar already has a video), 'finish'",
      "DOES affect anyone watching right now: playback is not pinned to a",
      "revision, so a viewer mid-stream is switched to the new revision on their",
      "very next segment request and may see a broken or stalled player. Prefer",
      "to replace a video when nobody is watching. The 'finish' response includes",
      "a `warning` field when this was a replacement — surface it to the user.",
    ].join("\n"),
    {
      action: z.enum(["upload", "finish"]).describe("'upload' sends a batch of files; 'finish' publishes the revision"),
      webinarId: z.string().describe("Webinar id (from list_crm_objects / the admin UI)"),
      revision: z.string().describe("Epoch milliseconds as a string. Use the SAME value for every upload call and for finish"),
      dir: z
        .string()
        .optional()
        .describe(
          "Local ffmpeg HLS output directory (required for 'upload'). master.m3u8 MUST be directly at its root — checked before anything is read or uploaded, and 'upload' fails immediately if absent.",
        ),
      offset: z.number().optional().default(0).describe("Index to resume from; pass the nextOffset returned by the previous call"),
      expectedTotal: z
        .number()
        .optional()
        .describe(
          "Total returned by the previous upload call. Pass it on every call after the first (omit only on the first call, offset 0) so a directory that changed mid-upload is caught instead of silently dropping a file.",
        ),
      durationSeconds: z.number().optional().describe("Video length in seconds from ffprobe (required for 'finish')"),
    },
    async ({ action, webinarId, revision, dir, offset, expectedTotal, durationSeconds }) => {
      const apiUrl = process.env.LINE_HARNESS_API_URL;
      const apiKey = process.env.LINE_HARNESS_API_KEY;
      const fail = (error: string) => ({
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error }, null, 2) }],
        isError: true,
      });
      if (!apiUrl || !apiKey) return fail("LINE_HARNESS_API_URL and LINE_HARNESS_API_KEY are required");
      if (!/^\d+$/.test(revision)) return fail("revision must be epoch milliseconds (digits only)");

      if (action === "finish") {
        if (!durationSeconds || durationSeconds <= 0) return fail("durationSeconds is required for finish");
        let res: Response;
        let text: string;
        try {
          // finish is one cheap request, but it lands right after a burst of
          // uploads (same token, same minute), so it can see a 429 too.
          res = await fetchWithRetry429(`${apiUrl}/api/webinars/${webinarId}/video`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ revision, durationSeconds }),
          });
          text = await res.text();
        } catch (err) {
          return fail(`finish request failed: ${(err as Error).message}`);
        }
        if (!res.ok) return fail(`finish failed: HTTP ${res.status} ${text}`);
        return { content: [{ type: "text" as const, text }] };
      }

      if (!dir) return fail("dir is required for upload");
      // ".ts" is ambiguous: MPEG-TS segment or TypeScript source. Nothing else
      // in listAssets()'s extension allowlist tells the two apart, so before
      // reading or sending a single byte, require the one file every ffmpeg
      // HLS output actually has at its root: master.m3u8. Pointed at the wrong
      // directory (e.g. a TypeScript project) without this check, the tool
      // would happily read and PUT arbitrary .ts source files to the remote
      // API — finish would eventually fail on the missing master.m3u8, but
      // only after everything was already uploaded.
      if (!existsSync(join(resolve(dir), "master.m3u8"))) {
        return fail(
          `${dir} は ffmpeg の HLS 出力ディレクトリではないようです。ルート直下に master.m3u8 が見つかりません(期待する構成: master.m3u8 と各レンディションの index.m3u8 / seg_NNNNN.ts)。`,
        );
      }
      let listing: ListAssetsResult;
      try {
        listing = listAssets(dir);
      } catch (err) {
        return fail(`cannot read ${dir}: ${(err as Error).message}`);
      }
      const { files, skipped } = listing;
      if (files.length === 0) return fail(`no uploadable .m3u8 or .ts files under ${dir}`);

      if (expectedTotal !== undefined && expectedTotal !== files.length) {
        return fail(
          `directory contents changed mid-upload: expected ${expectedTotal} files but found ${files.length} now. ` +
            "The upload must restart from offset 0 to avoid silently skipping a file.",
        );
      }

      const start = Math.max(0, Math.floor(offset ?? 0));
      const slice = files.slice(start, start + BATCH);
      const root = resolve(dir);
      const errors: string[] = [];

      const uploadOne = async (rel: string): Promise<void> => {
        const full = join(root, rel);
        try {
          const size = statSync(full).size;
          if (size > MAX_ASSET_BYTES) {
            errors.push(`${rel}: larger than 20MB`);
            return;
          }
          const body = readFileSync(full);
          const res = await fetchWithRetry429(`${apiUrl}/api/webinars/${webinarId}/assets/${revision}/${rel}`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${apiKey}` },
            body,
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "<no body>");
            errors.push(`${rel}: HTTP ${res.status} ${text}`);
          }
        } catch (err) {
          // Catch per-file: a DNS failure, connection reset, or a file removed
          // mid-upload must not reject the whole Promise.all group (which would
          // discard the accumulated errors[] and throw out of the handler
          // entirely, bypassing fail()'s response shape and losing track of
          // which sibling uploads in the same chunk actually succeeded).
          errors.push(`${rel}: ${(err as Error).message}`);
        }
      };

      // master.m3u8 must be uploaded strictly alone, after every other file in
      // this batch has settled. The global sort above only guarantees master
      // dispatches last across the whole file list; within one batch, files
      // are still sent in chunks of PARALLEL via Promise.all, which orders
      // dispatch but NOT completion — a sibling in the same chunk can still
      // be in flight when master's PUT resolves. So master is excluded from
      // the chunked loop and uploaded in its own pass afterwards.
      const masterEntries = slice.filter(isMasterPlaylist);
      const otherEntries = slice.filter((rel) => !isMasterPlaylist(rel));

      // Proactive pacing: keep this call's own request rate under
      // SAFE_REQUESTS_PER_MINUTE so the common case never trips the Worker's
      // limiter (see the constant's comment above for the target and why).
      // batchStart is local to this call — each `upload` invocation paces
      // itself independently — but since the limiter's window is a sliding
      // count of raw timestamps, not per-call, back-to-back calls that each
      // hold to the same target rate keep the combined stream under it too.
      const batchStart = Date.now();
      let dispatched = 0;

      for (let i = 0; i < otherEntries.length; i += PARALLEL) {
        await Promise.all(otherEntries.slice(i, i + PARALLEL).map(uploadOne));
        dispatched += Math.min(PARALLEL, otherEntries.length - i);
        await paceToTarget(batchStart, dispatched);
      }
      for (const rel of masterEntries) {
        await uploadOne(rel);
        dispatched += 1;
        await paceToTarget(batchStart, dispatched);
      }

      if (errors.length) {
        return fail(
          `${errors.length} file(s) failed (showing up to 20 of ${errors.length}): ${errors.slice(0, 20).join("; ")}`,
        );
      }

      const nextOffset = start + slice.length;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                uploaded: slice.length,
                nextOffset,
                remaining: Math.max(0, files.length - nextOffset),
                total: files.length,
                ...(skipped.length ? { skipped: skipped.slice(0, 20) } : {}),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
