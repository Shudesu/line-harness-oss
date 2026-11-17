import { expect, test } from 'vitest'
import { extensionFrameUrl } from './admin-extensions'

const extension = { id:'reports',label:'Reports',url:'https://extensions.example/reports/?view=list',minRole:'staff' as const }
test('appends only a bounded relative path and selected account context',()=>{
  expect(extensionFrameUrl(extension,'daily/list.html','synthetic-account','https://admin.example'))
    .toBe('https://extensions.example/reports/daily/list.html?view=list&lh_account=synthetic-account')
  expect(extensionFrameUrl(extension,null,null,'https://admin.example'))
    .toBe('https://extensions.example/reports/?view=list')
})
test('rejects absolute URLs, traversal, encoded variants and query injection',()=>{
  for(const path of ['//evil.example','https://evil.example','../secret','a/../b','a/./b','/root','%2e%2e/secret',
    '%252e%252e/secret','a%2fb','a\\b','a?token=value','a#fragment','a\nsecret','..'])
    expect(extensionFrameUrl(extension,path,'synthetic-account','https://admin.example')).toBeNull()
})
test('rejects same-origin, credential-bearing and non-HTTPS frames',()=>{
  for(const url of ['https://admin.example/extension/','javascript:alert(1)','http://extensions.example/',
    'https://user:secret@extensions.example/','https://extensions.example/#token'])
    expect(extensionFrameUrl({...extension,url},null,null,'https://admin.example')).toBeNull()
})
