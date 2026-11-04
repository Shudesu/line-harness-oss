import { describe, expect, test } from 'vitest';
import { parseAdminExtensions, visibleAdminExtensions } from './admin-extensions.js';

const item = { id: 'reports', label: 'レポート', url: 'https://extensions.example/reports/' };
describe('admin extension configuration', () => {
  test('empty and malformed settings are inert', () => {
    for (const raw of [undefined, '', '{', '{}', 'null', '[]', 'x'.repeat(16385), JSON.stringify(Array(33).fill(item))])
      expect(parseAdminExtensions(raw)).toEqual([]);
  });
  test('keeps valid entries, drops duplicates and rejects unsafe metadata', () => {
    const diagnostics: Array<{ index: number; reason: string }> = [];
    const entries = [item, item, null, {...item,id:'other',url:'javascript:alert(1)'},
      {...item,id:'other',url:'http://extensions.example/'}, {...item,id:'other',url:'https://name:secret@extensions.example/'},
      {...item,id:'other',url:'https://extensions.example/#secret'}, {...item,id:'other',minRole:'root'},
      {...item,id:'other',label:'x'.repeat(21)}, {...item,id:'other',label:'bad\nlabel'},
      {...item,id:'valid-two',minRole:'admin'}];
    const result = parseAdminExtensions(JSON.stringify(entries), (index,reason) => diagnostics.push({index,reason}));
    expect(result.map(entry => entry.id)).toEqual(['reports','valid-two']);
    expect(result[0].minRole).toBe('staff');
    expect(JSON.stringify(diagnostics)).not.toMatch(/https|secret|label/);
  });
  test('configuration limit counts UTF-8 bytes, including multibyte labels', () => {
    const reasons: string[] = [];
    expect(parseAdminExtensions(JSON.stringify([{...item,label:'あ'.repeat(6000)}]),
      (_index,reason) => reasons.push(reason))).toEqual([]);
    expect(reasons).toEqual(['configuration_too_large']);
  });
  test('filters each authenticated role and core origins', () => {
    const entries = parseAdminExtensions(JSON.stringify([item,{...item,id:'admin-only',minRole:'admin'},
      {...item,id:'owner-only',minRole:'owner'},{...item,id:'same-host',url:'https://admin.example/embedded/'}]));
    expect(visibleAdminExtensions(entries,'staff',['https://admin.example']).map(e=>e.id)).toEqual(['reports']);
    expect(visibleAdminExtensions(entries,'admin',['https://admin.example']).map(e=>e.id)).toEqual(['reports','admin-only']);
    expect(visibleAdminExtensions(entries,'owner',['https://admin.example']).map(e=>e.id)).toEqual(['reports','admin-only','owner-only']);
  });
});
