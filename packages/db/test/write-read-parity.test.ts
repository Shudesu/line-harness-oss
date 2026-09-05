// 書き込み↔UI 読み出しの整合ゲート。
//
// 背景（2026-08-25 の実事故）:
// AI エージェントが MCP で `/r/{slug}` を作ったのに、コンソールの流入リンク画面には
// **「(未登録)」** と表示され、タグ自動付与も起動シナリオも発火しなかった。
// API は 201 を返しており、型検査もユニットテストも通っていた。
//
// 原因は「**書いたテーブルと、UI が読むテーブルが違う**」こと。
// traffic_pools に書いたが、UI の流入リンク画面は entry_routes を主軸に読む。
// この層は型でもモックでも捕まらない。実データを作って、UI と同じ読み方で
// 読み直すしかない。
//
// このテストがやること:
//   1. 実スキーマ（schema.sql + migrations 全部）で DB を作る
//   2. 「エージェントが作る」経路と同じ書き込みをする
//   3. **UI が実際に使うクエリ形**で読み直す
//   4. 出てこない／不完全なら落とす
import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');
const BENIGN = /already exists|duplicate column/i;

function execSafe(db: Database.Database, sql: string): void {
  for (const stmt of sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    try {
      db.exec(stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!BENIGN.test(msg)) throw err;
    }
  }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    execSafe(db, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

let db: Database.Database;
beforeEach(() => {
  db = setupDb();
  // traffic_pools.active_account_id が line_accounts を参照するので親行を先に置く。
  db.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret,
                                is_active, created_at, updated_at)
     VALUES ('acc1','2000000001','テスト','tok','sec',1,datetime('now'),datetime('now'))`,
  ).run();
});

/**
 * コンソールの「流入リンク」画面が実際にやっている読み方。
 *
 * 実流入（ref_tracking）と登録済み経路（entry_routes）を突き合わせ、
 * entry_routes に行が無い ref を **「(未登録)」** として出す
 * （`apps/web/src/app/inflow-links/page.tsx` の orphan 行）。
 */
function inflowLinkRows(): Array<{ refCode: string; name: string | null }> {
  const registered = db
    .prepare(`SELECT ref_code AS refCode, name FROM entry_routes`)
    .all() as Array<{ refCode: string; name: string | null }>;
  const seen = new Set(registered.map((r) => r.refCode));
  const orphans = (
    db.prepare(`SELECT DISTINCT ref_code AS refCode FROM ref_tracking`).all() as Array<{
      refCode: string;
    }>
  )
    .filter((r) => !seen.has(r.refCode))
    .map((r) => ({ refCode: r.refCode, name: null })); // name=null → UI では「(未登録)」
  return [...registered, ...orphans];
}

describe('書き込み↔UI 読み出しの整合', () => {
  test('流入リンク: プールだけ作っても UI では「(未登録)」になる（事故の再現）', () => {
    // これは「直すべきバグ」ではなく**仕様**。Traffic Pool は振り分け先しか決めず、
    // 流入時の挙動（タグ・シナリオ）は entry_route が持つ。
    // ここで固定しておくことで、「Pool だけ作れば足りる」という誤解が
    // 実装にもドキュメントにも二度と入らないようにする。
    db.prepare(
      `INSERT INTO traffic_pools (id, slug, name, active_account_id, is_active, created_at, updated_at)
       VALUES ('p1','sns-main','SNS','acc1',1,datetime('now'),datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO ref_tracking (id, ref_code, created_at) VALUES ('rt1','sns-main',datetime('now'))`,
    ).run();

    const rows = inflowLinkRows();
    const row = rows.find((r) => r.refCode === 'sns-main');
    expect(row, 'ref は UI に現れる（流入自体は記録される）').toBeDefined();
    expect(row!.name, 'ただし entry_route が無いので name は null =「(未登録)」表示').toBeNull();
  });

  test('流入リンク: entry_route も作れば UI に名前付きで出る（正しい手順）', () => {
    db.prepare(
      `INSERT INTO traffic_pools (id, slug, name, active_account_id, is_active, created_at, updated_at)
       VALUES ('p1','sns-main','SNS','acc1',1,datetime('now'),datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO entry_routes (id, ref_code, name, is_active, created_at, updated_at)
       VALUES ('e1','sns-main','SNS流入',1,datetime('now'),datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO ref_tracking (id, ref_code, created_at) VALUES ('rt1','sns-main',datetime('now'))`,
    ).run();

    const row = inflowLinkRows().find((r) => r.refCode === 'sns-main');
    expect(row!.name).toBe('SNS流入');
  });

  test('タグ: 作ったタグは UI の一覧クエリで必ず見える', () => {
    // シナリオのトリガータグ選択が空になる事故（2026-08-25）の下地。
    // 「タグはあるのに選択肢に出ない」なら、この層で落ちる。
    db.prepare(
      `INSERT INTO tags (id, name, created_at) VALUES ('t1','年商1億以上',datetime('now'))`,
    ).run();
    const rows = db.prepare(`SELECT id, name FROM tags ORDER BY created_at`).all() as Array<{
      id: string;
      name: string;
    }>;
    expect(rows.map((r) => r.name)).toContain('年商1億以上');
  });

  test('シナリオ: tag_added のトリガータグが保存され、読み戻せる', () => {
    // trigger_tag_id が落ちると「シナリオはあるのに永久に発火しない」になる。
    // 発火しない不具合は気づきにくいので、往復をここで固定する。
    db.prepare(
      `INSERT INTO tags (id, name, created_at) VALUES ('t1','年商1億以上',datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO scenarios (id, name, trigger_type, trigger_tag_id, is_active, created_at, updated_at)
       VALUES ('s1','商談ステップ','tag_added','t1',1,datetime('now'),datetime('now'))`,
    ).run();

    const row = db
      .prepare(`SELECT trigger_type, trigger_tag_id FROM scenarios WHERE id='s1'`)
      .get() as { trigger_type: string; trigger_tag_id: string | null };
    expect(row.trigger_type).toBe('tag_added');
    expect(row.trigger_tag_id, 'trigger_tag_id が null だと永久に発火しない').toBe('t1');
  });

  test('フォーム: 作成したフォームは UI の一覧で見える', () => {
    db.prepare(
      `INSERT INTO forms (id, name, fields, is_active, created_at, updated_at)
       VALUES ('f1','事業ヒアリング','[]',1,datetime('now'),datetime('now'))`,
    ).run();
    const rows = db.prepare(`SELECT id, name FROM forms`).all() as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toContain('事業ヒアリング');
  });

  test('ウェビナー: video_prefix 未設定でも一覧には出る（動画待ちの状態が見える）', () => {
    // 「作ったのに管理画面に出てこない」と誤解されないこと。
    db.prepare(
      `INSERT INTO webinars (id, title, slug, status, created_at, updated_at)
       VALUES ('w1','セミナー','sem','draft',datetime('now'),datetime('now'))`,
    ).run();
    const rows = db.prepare(`SELECT id, title, video_prefix FROM webinars`).all() as Array<{
      title: string;
      video_prefix: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].video_prefix).toBeNull();
  });
});
