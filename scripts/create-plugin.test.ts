import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
// @ts-expect-error Node-only CLI is intentionally plain JS, also usable without a TS runtime.
import { createPlugin } from '../examples/plugins/create-plugin.mjs'

const roots: string[] = []
const temp = () => { const root = mkdtempSync(resolve(tmpdir(), 'harness-plugin-test-')); roots.push(root); return root }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('independent plugin creation', () => {
  it('creates a standalone package with a published SDK and its own Worker name', () => {
    const target = createPlugin(resolve(temp(), 'my-plugin'))
    const pkg = JSON.parse(readFileSync(resolve(target, 'package.json'), 'utf8'))
    expect(pkg.dependencies['@line-harness/sdk']).toBe('0.24.0')
    expect(pkg.name).toBe('line-harness-plugin-my-plugin')
    expect(readFileSync(resolve(target, 'wrangler.jsonc'), 'utf8')).toContain('line-harness-plugin-my-plugin')
    expect(readFileSync(resolve(target, 'tsconfig.json'), 'utf8')).not.toContain('extends')
    expect(existsSync(resolve(target, 'src/rules.ts'))).toBe(true)
    expect(readFileSync(resolve(target, '.gitignore'), 'utf8')).toContain('.dev.vars*')
  })

  it('removes workspace and parent-tsconfig dependencies from the integration template', () => {
    const target = createPlugin(resolve(temp(), 'my-integration'), 'integration')
    expect(readFileSync(resolve(target, 'package.json'), 'utf8')).not.toContain('workspace:')
    expect(readFileSync(resolve(target, 'tsconfig.json'), 'utf8')).not.toContain('extends')
    expect(readFileSync(resolve(target, 'wrangler.toml'), 'utf8')).toContain('crons = []')
  })

  it('refuses overwrites and paths inside the main checkout, including symlink parents', () => {
    const root = temp()
    const target = createPlugin(resolve(root, 'my-plugin'))
    expect(() => createPlugin(target)).toThrow('存在')
    expect(() => createPlugin(resolve('my-plugin'))).toThrow('本体リポジトリの外')
    symlinkSync(process.cwd(), resolve(root, 'checkout'), 'dir')
    expect(() => createPlugin(resolve(root, 'checkout/my-plugin'))).toThrow('本体リポジトリの外')
  })

  it('rejects invalid template and Worker names before creating files', () => {
    const target = resolve(temp(), 'bad_name')
    expect(() => createPlugin(target)).toThrow('フォルダ名')
    expect(existsSync(target)).toBe(false)
    expect(() => createPlugin(resolve(temp(), 'valid'), '../../anything')).toThrow('テンプレート')
  })
})
