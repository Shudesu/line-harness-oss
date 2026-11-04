import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { academicYearJst, advanceGrade, maintainInternGrades, syncAnswerTags } from './intern-grade.js';

// vite が node:sqlite を読めないため require で読む
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = InstanceType<typeof DatabaseSync>;

function fakeD1(sqlite: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { args = a; return stmt; },
      async first<T>() { return (sqlite.prepare(sql).get(...(args as never[])) as T) ?? null; },
      async all<T>() { return { results: sqlite.prepare(sql).all(...(args as never[])) as T[] }; },
      async run() { const r = sqlite.prepare(sql).run(...(args as never[])); return { meta: { changes: Number(r.changes) } }; },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

const ACCOUNT = 'acct-intern';
let sqlite: DatabaseSync;
let db: D1Database;

function addFriend(id: string, meta: Record<string, unknown>, account = ACCOUNT) {
  sqlite.prepare('INSERT INTO friends (id, line_account_id, metadata, updated_at) VALUES (?, ?, ?, ?)').run(id, account, JSON.stringify(meta), '');
}
function addTag(friendId: string, name: string) {
  sqlite.prepare('INSERT OR IGNORE INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)').run('t-' + name, name, '', '');
  const tagId = (sqlite.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: string }).id;
  sqlite.prepare('INSERT INTO friend_tags (friend_id, tag_id, assigned_at) VALUES (?, ?, ?)').run(friendId, tagId, '');
}
const tagsOf = (friendId: string) =>
  (sqlite.prepare('SELECT t.name FROM friend_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.friend_id = ? ORDER BY t.name').all(friendId) as { name: string }[]).map((r) => r.name);
const metaOf = (id: string) => JSON.parse((sqlite.prepare('SELECT metadata FROM friends WHERE id = ?').get(id) as { metadata: string }).metadata);

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT, metadata TEXT, updated_at TEXT);
    CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT UNIQUE, color TEXT, created_at TEXT);
    CREATE TABLE friend_tags (friend_id TEXT, tag_id TEXT, assigned_at TEXT, PRIMARY KEY (friend_id, tag_id));
  `);
  db = fakeD1(sqlite);
});

// 日本時間の日時
const jst = (s: string) => new Date(`${s}+09:00`);

describe('年度と学年の進め方', () => {
  it('年度は4月始まり・日本時間で数える', () => {
    expect(academicYearJst(jst('2027-03-31T23:59:00'))).toBe(2026);
    expect(academicYearJst(jst('2027-04-01T00:00:00'))).toBe(2027);
  });

  it('最後の学年で止め、その他・知らない値はそのまま', () => {
    expect(advanceGrade('学部1年', 1)).toBe('学部2年');
    expect(advanceGrade('学部3年', 2)).toBe('学部4年');
    expect(advanceGrade('学部4年', 1)).toBe('学部4年');
    expect(advanceGrade('修士1年', 3)).toBe('修士2年');
    expect(advanceGrade('博士2年', 1)).toBe('博士3年');
    expect(advanceGrade('その他', 1)).toBe('その他');
    expect(advanceGrade('学部2年', 0)).toBe('学部2年');
  });
});

describe('定期実行', () => {
  it('4月を過ぎたら1つ進め、学年の印も付け替える。同じ年度に何度動いても二重に進まない', async () => {
    addFriend('f1', { survey_step: 'done', grade: '学部3年', grade_academic_year: 2026, graduation_year: '2028' });
    addTag('f1', 'ズ_学年_学部3年');
    addTag('f1', 'ズ_卒業年_2028');
    addTag('f1', 'ズ_状態_アンケート回答済み');

    expect(await maintainInternGrades(db, ACCOUNT, jst('2027-03-31T12:00:00'))).toEqual({ advanced: 0, retagged: 0 });
    expect(metaOf('f1').grade).toBe('学部3年');

    expect((await maintainInternGrades(db, ACCOUNT, jst('2027-04-01T03:00:00'))).advanced).toBe(1);
    expect(metaOf('f1')).toMatchObject({ grade: '学部4年', grade_academic_year: 2027, graduation_year: '2028' });
    expect(tagsOf('f1')).toEqual(['ズ_卒業年_2028', 'ズ_学年_学部4年', 'ズ_状態_アンケート回答済み']);

    expect(await maintainInternGrades(db, ACCOUNT, jst('2027-04-01T09:00:00'))).toEqual({ advanced: 0, retagged: 0 });
    expect(metaOf('f1').grade).toBe('学部4年');
  });

  it('止まっていた年があっても、年度の差の分だけ追いつく', async () => {
    addFriend('f1', { survey_step: 'done', grade: '学部1年', grade_academic_year: 2026 });
    await maintainInternGrades(db, ACCOUNT, jst('2028-05-01T00:00:00'));
    expect(metaOf('f1')).toMatchObject({ grade: '学部3年', grade_academic_year: 2028 });
  });

  it('年度を添えていない古い答えは、答え終えた日の年度から数える', async () => {
    addFriend('f1', { survey_step: 'done', grade: '学部2年', survey_completed_at: '2026-11-03T10:00:00.000+09:00' });
    await maintainInternGrades(db, ACCOUNT, jst('2026-11-04T12:00:00'));
    expect(metaOf('f1')).toMatchObject({ grade: '学部2年', grade_academic_year: 2026 });
    await maintainInternGrades(db, ACCOUNT, jst('2027-04-02T12:00:00'));
    expect(metaOf('f1').grade).toBe('学部3年');
  });

  it('答え直して残った古い卒業年の印を外し、足りない印を付ける', async () => {
    addFriend('f1', { survey_step: 'done', grade: '学部2年', grade_academic_year: 2026, graduation_year: '2029' });
    addTag('f1', 'ズ_卒業年_2027');
    addTag('f1', 'ズ_卒業年_2029');
    addTag('f1', '手で付けた印');
    expect((await maintainInternGrades(db, ACCOUNT, jst('2026-11-04T12:00:00'))).retagged).toBe(1);
    expect(tagsOf('f1')).toEqual(['ズ_卒業年_2029', 'ズ_学年_学部2年', '手で付けた印']);
  });

  it('答え終えていない人・ほかのアカウントの人は触らない', async () => {
    addFriend('f1', { survey_step: 'graduation_year', grade: '学部1年', grade_academic_year: 2026 });
    addFriend('f2', { survey_step: 'done', grade: '学部1年', grade_academic_year: 2026 }, 'other');
    addTag('f2', 'ズ_卒業年_2027');
    expect(await maintainInternGrades(db, ACCOUNT, jst('2027-04-02T00:00:00'))).toEqual({ advanced: 0, retagged: 0 });
    expect(metaOf('f1').grade).toBe('学部1年');
    expect(metaOf('f2').grade).toBe('学部1年');
    expect(tagsOf('f2')).toEqual(['ズ_卒業年_2027']);
  });

  it('アカウントが決まっていなければ何もしない', async () => {
    expect(await maintainInternGrades(db, undefined)).toEqual({ advanced: 0, retagged: 0 });
  });
});

describe('答え終えたときの印', () => {
  it('今の答えの学年・卒業年だけにする', async () => {
    addFriend('f1', {});
    addTag('f1', 'ズ_卒業年_2027');
    addTag('f1', 'ズ_学年_学部1年');
    await syncAnswerTags(db, 'f1', { grade: '学部3年', graduation_year: '2028' });
    expect(tagsOf('f1')).toEqual(['ズ_卒業年_2028', 'ズ_学年_学部3年']);
  });
});
