import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Kumo の Dialog は枠（角丸・線・影）だけを描き、中の余白を持たない。
// className で余白を付けないと、題名・本文・ボタンが枠に接する。中を見出し・本文・
// フッターに区切り、区切りごとに余白を持たせるときは p-0 を明示する。
//
// 幅は `w-full max-w-[calc(100vw-2rem)] sm:w-96`（sm:w-* は size で変わる）。
// className に max-w-* を渡すと tailwind-merge が max-w-[calc(100vw-2rem)] を消し、
// スマホで画面の左右に接する。PC は sm:w-* のままで max-w-* は効かないので、
// 幅を変えるときは size（sm / base / lg / xl）を使う。
const SRC = fileURLToPath(new URL('../..', import.meta.url))

const popups = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((path) => path.endsWith('.tsx'))
  .flatMap((path) => {
    const source = readFileSync(join(SRC, path), 'utf8')
    return [...source.matchAll(/<Dialog(?=[\s>])([^>]*)>/g)].map((match) => ({
      at: `${path}:${source.slice(0, match.index).split('\n').length}`,
      attrs: match[1],
    }))
  })

describe('Kumo Dialog layout contract', () => {
  it('finds the dialog popups', () => {
    expect(popups.length).toBeGreaterThan(30)
  })

  it('gives every dialog popup explicit padding', () => {
    const unpadded = popups.filter(({ attrs }) => !/className="[^"]*(?<![\w-])p-\d/.test(attrs))
    expect(unpadded.map(({ at }) => at)).toEqual([])
  })

  it('keeps the viewport gutter on small screens', () => {
    const overridden = popups.filter(({ attrs }) => /(?<![\w-])max-w-/.test(attrs))
    expect(overridden.map(({ at }) => at)).toEqual([])
  })
})
