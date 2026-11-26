#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const templates = { 'tag-rules': 'examples/plugins/tag-rules', integration: 'packages/plugin-template' }

function inside(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

export function createPlugin(destination, template = 'tag-rules') {
  if (!Object.hasOwn(templates, template)) throw new Error('テンプレートは tag-rules / integration から選んでください。')
  if (!destination) throw new Error('作成先を指定してください: pnpm plugin:create ../my-plugin')
  const target = resolve(destination)
  const name = basename(target)
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(name)) throw new Error('フォルダ名は英小文字から始まる英小文字・数字・ハイフンの40文字以内にしてください。')
  if (existsSync(target)) throw new Error('作成先がすでに存在します。上書きせず停止しました。')
  // 親を先に解決して、symlink経由でも本体内に作らない。親フォルダは既存を要求。
  const parent = realpathSync(dirname(target))
  const actualTarget = resolve(parent, name)
  if (inside(realpathSync(repoRoot), actualTarget)) throw new Error('本体の更新から守るため、本体リポジトリの外を指定してください（例: ../my-plugin）。')
  mkdirSync(actualTarget)
  try {
    cpSync(resolve(repoRoot, templates[template]), actualTarget, {
      recursive: true,
      filter: source => !['node_modules', 'dist', 'dist-mcp', '.git', '.wrangler', 'worker-configuration.d.ts'].includes(basename(source)) && !basename(source).startsWith('.dev.vars') && !basename(source).startsWith('.env'),
    })
    const pkgPath = resolve(actualTarget, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    pkg.name = `line-harness-plugin-${name}`
    pkg.dependencies['@line-harness/sdk'] = '0.24.0'
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    cpSync(resolve(repoRoot, 'LICENSE'), resolve(actualTarget, 'LICENSE'))
    const readmePath = resolve(actualTarget, 'README.md')
    const readme = readFileSync(readmePath, 'utf8').replaceAll('../../examples/plugins/tag-rules/README.md', 'https://github.com/Shudesu/line-harness-oss/tree/main/examples/plugins/tag-rules')
    writeFileSync(readmePath, readme)
    if (template === 'integration') {
      const tsPath = resolve(actualTarget, 'tsconfig.json')
      const ts = JSON.parse(readFileSync(tsPath, 'utf8'))
      delete ts.extends
      ts.compilerOptions = { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, skipLibCheck: true, ...ts.compilerOptions }
      writeFileSync(tsPath, JSON.stringify(ts, null, 2) + '\n')
    }
    const configPath = resolve(actualTarget, template === 'tag-rules' ? 'wrangler.jsonc' : 'wrangler.toml')
    const config = readFileSync(configPath, 'utf8').replace(/line-harness-plugin-(?:tag-rules|myservice)/g, `line-harness-plugin-${name}`)
    writeFileSync(configPath, config)
    writeFileSync(resolve(actualTarget, '.gitignore'), 'node_modules/\ndist/\ndist-mcp/\n.wrangler/\n.dev.vars*\n.env*\n*.tsbuildinfo\nworker-configuration.d.ts\n')
    return actualTarget
  } catch (error) {
    rmSync(actualTarget, { recursive: true, force: true })
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [destination, template, ...extra] = process.argv.slice(2)
    if (extra.length) throw new Error('Usage: pnpm plugin:create <作成先> [tag-rules|integration]')
    const target = createPlugin(destination, template)
    console.log(`作成しました: ${target}\n本体とは別のGitリポジトリで管理してください。\n移動して npm install を実行し、README.md の設定・検証手順に進んでください。`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
