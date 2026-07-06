#!/usr/bin/env node
/**
 * 配信自動生成パイプライン（飲食店プラグイン用）
 *
 *   キャンペーン概要ひとつから
 *     1. Claude (claude -p) が配信文面・コピー・画像プロンプトを生成
 *     2. Codex image_gen がリッチメッセージ用バナー画像・クーポン画像を生成
 *     3. （--coupon 時）プラグインAPIで共通クーポン CP-XXXXXX を発行
 *     4. LINE Harness に画像アップロード → テキスト配信 + Flexリッチ配信を作成
 *   までを一気通貫で行う。
 *
 * 使い方:
 *   node tools/campaign.mjs --brief "雨の日限定10%オフ。雨の日に来店したら全品10%引き" \
 *     [--coupon] [--discount "10%OFF"] [--expires 2026-07-31] \
 *     [--target all|tag:<tagId>] [--send draft|now] [--skip-images] [--model sonnet]
 *
 * 既定は draft（Harness管理画面で内容確認後に送信）。--send now で
 * テキスト→リッチの順に即時送信する。
 *
 * 必要な環境変数（パッケージ直下の .env でも可）:
 *   LINE_HARNESS_API_URL / LINE_HARNESS_API_KEY
 *   RESTAURANT_PLUGIN_URL / RESTAURANT_PLUGIN_API_KEY   ← --coupon 時のみ
 *   STORE_NAME / LIFF_ID                                 ← 未設定なら wrangler.toml から補完
 *
 * 前提: claude CLI / Codex CLI（ログイン済み・image_gen 用）/ macOS sips
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(__dirname, '..')

// ---------------------------------------------------------------- args/env

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback
}
const flag = (name) => process.argv.includes(name)

const brief = arg('--brief')
if (!brief) {
  console.error('usage: node tools/campaign.mjs --brief "<キャンペーン概要>" [--coupon] [--expires YYYY-MM-DD] [--target all|tag:<id>] [--send draft|now] [--skip-images]')
  process.exit(1)
}
const withCoupon = flag('--coupon')
const discount = arg('--discount', '')
const expires = arg('--expires', '')
const target = arg('--target', 'all')
const sendMode = arg('--send', 'draft')
const skipImages = flag('--skip-images')
const bannerUrlOverride = arg('--banner-url') // 既存画像URLを使い回す（生成スキップ）
const couponUrlOverride = arg('--coupon-image-url')
const model = arg('--model', 'sonnet')
const outDir = arg('--out', path.join(__dirname, 'out', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)))

// .env（パッケージ直下）を補完読み込み
const envFile = path.join(PKG_ROOT, '.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

// wrangler.toml の [vars] から STORE_NAME / LIFF_ID / LINE_HARNESS_API_URL を補完
function varFromWranglerToml(key) {
  try {
    const toml = fs.readFileSync(path.join(PKG_ROOT, 'wrangler.toml'), 'utf8')
    const m = toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))
    return m ? m[1] : null
  } catch {
    return null
  }
}

const HARNESS_URL = (process.env.LINE_HARNESS_API_URL || varFromWranglerToml('LINE_HARNESS_API_URL') || '').replace(/\/$/, '')
const HARNESS_KEY = process.env.LINE_HARNESS_API_KEY || ''
const STORE_NAME = process.env.STORE_NAME || varFromWranglerToml('STORE_NAME') || 'お店'
const LIFF_ID = process.env.LIFF_ID || varFromWranglerToml('LIFF_ID') || ''
const PLUGIN_URL = (process.env.RESTAURANT_PLUGIN_URL || '').replace(/\/$/, '')
const PLUGIN_KEY = process.env.RESTAURANT_PLUGIN_API_KEY || ''

if (!HARNESS_URL || !HARNESS_KEY) {
  console.error('LINE_HARNESS_API_URL / LINE_HARNESS_API_KEY を設定してください（.env 可）')
  process.exit(1)
}
if (withCoupon && (!PLUGIN_URL || !PLUGIN_KEY)) {
  console.error('--coupon には RESTAURANT_PLUGIN_URL / RESTAURANT_PLUGIN_API_KEY が必要です')
  process.exit(1)
}
if (!['draft', 'now'].includes(sendMode)) {
  console.error('--send は draft か now')
  process.exit(1)
}
let targetType = 'all'
let targetTagId
if (target.startsWith('tag:')) {
  targetType = 'tag'
  targetTagId = target.slice(4)
} else if (target !== 'all') {
  console.error('--target は all か tag:<tagId>')
  process.exit(1)
}

fs.mkdirSync(outDir, { recursive: true })
const log = (msg) => console.error(`[campaign] ${msg}`)

// ---------------------------------------------------------------- helpers

async function harness(pathName, init = {}) {
  const res = await fetch(`${HARNESS_URL}${pathName}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${HARNESS_KEY}`, ...(init.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.success === false) throw new Error(`Harness ${pathName}: ${body.error || res.status}`)
  return body.data
}

async function pluginApi(pathName, init = {}) {
  const res = await fetch(`${PLUGIN_URL}/api/admin${pathName}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PLUGIN_KEY}`, ...(init.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.success === false) throw new Error(`Plugin ${pathName}: ${body.error || res.status}`)
  return body.data
}

// ---------------------------------------------------------------- 1. コピー生成 (Claude)

function generateCopy() {
  log(`コピー生成中 (claude -p, model=${model}) …`)
  const prompt = `あなたは飲食店のLINE公式アカウント配信のコピーライターです。
店舗名: ${STORE_NAME}
キャンペーン概要: ${brief}
${withCoupon ? `クーポン: あり（割引表記: ${discount || '概要から適切に決める'}、有効期限: ${expires || '未定'}）` : 'クーポン: なし'}

以下のキーを持つJSONオブジェクトだけを出力してください。コードフェンスや説明文は一切禁止。
{
  "title": "社内管理用の短いキャンペーン名（20字以内）",
  "textMessage": "1通目のテキスト配信文。絵文字を適度に使い、改行を含む180字以内。押し付けがましくなく、来店したくなる文面",
  "headline": "リッチメッセージの見出し（15字以内・体言止め可）",
  "sub": "サブコピー（30字以内）",
  "cta": "ボタン文言（10字以内、例: 会員証を見る）",
  "discountText": "割引の短い表記（例: 10%OFF。クーポンなしなら空文字）",
  "bannerImagePrompt": "バナー用の写真の英語プロンプト。料理・シズル感中心の正方形構図。スタイルや照明も指定",
  "couponImagePrompt": "クーポン背景用の写真の英語プロンプト。横長構図で余白のある落ち着いた雰囲気",
  "altText": "リッチメッセージの代替テキスト（30字以内）"
}`
  const raw = execFileSync('claude', ['-p', prompt, '--model', model], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 180_000,
  })
  const jsonText = raw.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1')
  const copy = JSON.parse(jsonText)
  for (const key of ['title', 'textMessage', 'headline', 'cta', 'bannerImagePrompt', 'altText']) {
    if (!copy[key]) throw new Error(`コピー生成の欠落キー: ${key}`)
  }
  fs.writeFileSync(path.join(outDir, 'copy.json'), JSON.stringify(copy, null, 2))
  return copy
}

// ---------------------------------------------------------------- 2. 画像生成 (Codex image_gen)

const NO_TEXT = ' Use your built-in image_gen tool; do NOT search for a CLI. Absolutely no text, letters, numbers or logos in the image.'

function generateImage(prompt, outPng, label) {
  log(`${label} 画像生成中 (Codex image_gen) …`)
  execFileSync('node', [path.join(__dirname, 'gen-image.mjs'), prompt + NO_TEXT, outPng, '--timeout', '420'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    timeout: 480_000,
  })
  if (!fs.existsSync(outPng)) throw new Error(`${label} 画像の生成に失敗しました`)
  // 1040px・JPEG化で軽量化（LINE推奨サイズ/アップロード上限対策）
  const jpg = outPng.replace(/\.png$/, '.jpg')
  execFileSync('sips', ['-Z', '1040', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', outPng, '--out', jpg], { stdio: 'ignore' })
  return jpg
}

async function uploadImage(filePath, filename) {
  const data = fs.readFileSync(filePath).toString('base64')
  const uploaded = await harness('/api/images', {
    method: 'POST',
    body: JSON.stringify({ data, mimeType: 'image/jpeg', filename }),
  })
  return uploaded.url
}

// ---------------------------------------------------------------- 3. Flex 組み立て

function buildFlex(copy, bannerUrl, coupon, couponUrl) {
  const liffUrl = LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : null
  const button = liffUrl
    ? {
        type: 'button',
        style: 'primary',
        color: '#b45309',
        action: { type: 'uri', label: copy.cta, uri: liffUrl },
      }
    : null

  const bannerBubble = {
    type: 'bubble',
    hero: {
      type: 'image',
      url: bannerUrl,
      size: 'full',
      aspectRatio: '1:1',
      aspectMode: 'cover',
      ...(liffUrl ? { action: { type: 'uri', uri: liffUrl } } : {}),
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'text', text: copy.headline, weight: 'bold', size: 'xl', wrap: true },
        ...(copy.sub ? [{ type: 'text', text: copy.sub, size: 'sm', color: '#78716c', wrap: true }] : []),
      ],
    },
    ...(button ? { footer: { type: 'box', layout: 'vertical', contents: [button] } } : {}),
  }

  if (!coupon) return bannerBubble

  const couponBubble = {
    type: 'bubble',
    ...(couponUrl
      ? { hero: { type: 'image', url: couponUrl, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' } }
      : {}),
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: 'COUPON', size: 'xs', color: '#b45309', weight: 'bold' },
        { type: 'text', text: coupon.name, weight: 'bold', size: 'lg', wrap: true },
        ...(coupon.discountText
          ? [{ type: 'text', text: coupon.discountText, weight: 'bold', size: '3xl', color: '#b45309' }]
          : []),
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#fff7ed',
          cornerRadius: 'md',
          paddingAll: 'md',
          contents: [
            { type: 'text', text: 'クーポンコード', size: 'xs', color: '#78716c', align: 'center' },
            { type: 'text', text: coupon.code, weight: 'bold', size: 'xxl', align: 'center', color: '#92400e' },
          ],
        },
        {
          type: 'text',
          text: `ご注文時にスタッフへこの画面をご提示ください${coupon.expiresAt ? `\n有効期限: ${coupon.expiresAt}` : ''}`,
          size: 'xs',
          color: '#78716c',
          wrap: true,
        },
      ],
    },
    ...(button ? { footer: { type: 'box', layout: 'vertical', contents: [button] } } : {}),
  }

  return { type: 'carousel', contents: [bannerBubble, couponBubble] }
}

// ---------------------------------------------------------------- main

async function main() {
  const copy = generateCopy()
  log(`コピー完成: ${copy.title}`)

  // 共通クーポン発行
  let coupon = null
  if (withCoupon) {
    log('共通クーポン発行中 …')
    coupon = await pluginApi('/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        name: copy.title,
        discountText: copy.discountText || discount || undefined,
        expiresAt: expires || undefined,
      }),
    })
    log(`クーポン発行: ${coupon.code}`)
    // クーポンコードをテキスト配信にも記載
    copy.textMessage += `\n\n🎟 クーポンコード: ${coupon.code}${coupon.expiresAt ? `（${coupon.expiresAt}まで）` : ''}\nご注文時にスタッフへご提示ください。`
  }

  // 画像生成 → アップロード（URL指定があれば生成スキップ）
  let bannerUrl = bannerUrlOverride
  let couponUrl = couponUrlOverride
  if (!skipImages && !bannerUrl) {
    const bannerJpg = generateImage(copy.bannerImagePrompt, path.join(outDir, 'banner.png'), 'バナー')
    bannerUrl = await uploadImage(bannerJpg, 'campaign-banner.jpg')
    log(`バナーアップロード: ${bannerUrl}`)
  }
  if (!skipImages && withCoupon && !couponUrl && copy.couponImagePrompt) {
    const couponJpg = generateImage(copy.couponImagePrompt, path.join(outDir, 'coupon.png'), 'クーポン')
    couponUrl = await uploadImage(couponJpg, 'campaign-coupon.jpg')
    log(`クーポン画像アップロード: ${couponUrl}`)
  }

  // 配信作成（1通目: テキスト → 2通目: リッチ）
  const targetFields = { targetType, ...(targetTagId ? { targetTagId } : {}) }
  const textBroadcast = await harness('/api/broadcasts', {
    method: 'POST',
    body: JSON.stringify({ title: `${copy.title}（テキスト）`, messageType: 'text', messageContent: copy.textMessage, ...targetFields }),
  })

  let richBroadcast = null
  if (bannerUrl) {
    const flex = buildFlex(copy, bannerUrl, coupon, couponUrl)
    fs.writeFileSync(path.join(outDir, 'flex.json'), JSON.stringify(flex, null, 2))
    richBroadcast = await harness('/api/broadcasts', {
      method: 'POST',
      body: JSON.stringify({
        title: `${copy.title}（リッチ）`,
        messageType: 'flex',
        messageContent: JSON.stringify(flex),
        altText: copy.altText,
        ...targetFields,
      }),
    })
  }

  if (sendMode === 'now') {
    log('送信中（テキスト → リッチの順）…')
    await harness(`/api/broadcasts/${textBroadcast.id}/send`, { method: 'POST' })
    if (richBroadcast) {
      await new Promise((r) => setTimeout(r, 3000))
      await harness(`/api/broadcasts/${richBroadcast.id}/send`, { method: 'POST' })
    }
  }

  const summary = {
    ok: true,
    mode: sendMode,
    title: copy.title,
    textBroadcastId: textBroadcast.id,
    richBroadcastId: richBroadcast?.id ?? null,
    coupon: coupon ? { code: coupon.code, expiresAt: coupon.expiresAt } : null,
    images: { banner: bannerUrl, coupon: couponUrl },
    outDir,
  }
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  if (sendMode === 'draft') {
    log('ドラフト作成のみ完了。Harness管理画面の「配信」で内容を確認して送信してください。')
  }
}

main().catch((e) => {
  console.error(`[campaign] 失敗: ${e.message}`)
  process.exit(1)
})
