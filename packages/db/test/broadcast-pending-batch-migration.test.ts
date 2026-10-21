import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
const migration=readFileSync(new URL('../migrations/NNN_broadcast_pending_batch.sql',import.meta.url),'utf8');
describe('pending broadcast batch migration',()=>{
 it('adds nullable private plan fields without reconstructing or changing past receipts',()=>{
  const db=new Database(':memory:');
  try {
   db.exec("CREATE TABLE broadcasts(id TEXT PRIMARY KEY,status TEXT,total_count INTEGER,success_count INTEGER,last_error TEXT); INSERT INTO broadcasts VALUES('legacy','sending',1001,500,'Original unknown receipt')");
   const before=db.prepare('SELECT * FROM broadcasts').get();db.exec(migration);
   const after=db.prepare('SELECT id,status,total_count,success_count,last_error FROM broadcasts').get();expect(after).toEqual(before);
   expect(db.prepare('SELECT pending_batch_id,pending_batch FROM broadcasts').get()).toEqual({pending_batch_id:null,pending_batch:null});
  }finally{db.close();}
 });
});
