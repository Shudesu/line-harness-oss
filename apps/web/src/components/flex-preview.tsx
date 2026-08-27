'use client'

import { memo, useMemo } from 'react'

/**
 * Flex Message visual preview — renders LINE Flex JSON as a styled card.
 * Supports bubble (single) and carousel (multiple bubbles).
 * Covers: text, button, separator, image, box, icon, spacer, span.
 */

interface FlexNode {
  type: string
  text?: string
  contents?: FlexNode[]
  action?: { type: string; label?: string; text?: string; uri?: string }
  // Style
  size?: string
  weight?: string
  color?: string
  wrap?: boolean
  margin?: string
  flex?: number
  align?: string
  gravity?: string
  layout?: string
  spacing?: string
  backgroundColor?: string
  cornerRadius?: string
  paddingAll?: string
  paddingTop?: string
  paddingBottom?: string
  paddingStart?: string
  paddingEnd?: string
  style?: string
  height?: string
  width?: string
  url?: string
  aspectRatio?: string
  aspectMode?: string
  offsetTop?: string
  offsetBottom?: string
  offsetStart?: string
  offsetEnd?: string
  position?: string
  borderWidth?: string
  borderColor?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

const sizeMap: Record<string, string> = {
  xxs: '10px', xs: '12px', sm: '13px', md: '14px', lg: '16px', xl: '18px', xxl: '22px',
  '3xl': '26px', '4xl': '30px', '5xl': '36px',
}

const marginMap: Record<string, string> = {
  none: '0', xs: '2px', sm: '4px', md: '8px', lg: '12px', xl: '16px', xxl: '20px',
}

const spacingMap = marginMap

function getSize(s?: string) { return s ? sizeMap[s] || s : undefined }
function getMargin(m?: string) { return m ? marginMap[m] || m : undefined }
function getSpacing(s?: string) { return s ? spacingMap[s] || s : undefined }

function FlexText({ node }: { node: FlexNode }) {
  const style: React.CSSProperties = {
    fontSize: getSize(node.size) || '14px',
    fontWeight: node.weight === 'bold' ? 700 : 400,
    color: node.color || '#111',
    margin: 0,
    lineHeight: 1.4,
    ...(node.wrap === false ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : { wordBreak: 'break-word' }),
    ...(node.align === 'center' ? { textAlign: 'center' } : node.align === 'end' ? { textAlign: 'right' } : {}),
  }
  return <p style={style}>{node.text || ''}</p>
}

function FlexButton({ node }: { node: FlexNode }) {
  const isPrimary = node.style === 'primary'
  const isLink = node.style === 'link'
  const btnColor = node.color || (isPrimary ? '#06C755' : undefined)
  const style: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '10px 16px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 600,
    textAlign: 'center',
    cursor: 'default',
    border: isPrimary || isLink ? 'none' : '1px solid #ccc',
    backgroundColor: isPrimary ? btnColor : 'transparent',
    color: isPrimary ? '#fff' : isLink ? (btnColor || '#06C755') : '#333',
  }
  return <div style={style}>{node.action?.label || 'Button'}</div>
}

function FlexSeparator({ node }: { node: FlexNode }) {
  // margin は FlexNodeRenderer のラッパーが一括適用するので、ここで重ねて
  // 付けると二重マージンになる (Codex Review 指摘)。
  return (
    <hr style={{
      border: 'none',
      borderTop: `1px solid ${node.color || '#e0e0e0'}`,
      margin: 0,
    }} />
  )
}

function FlexImage({ node }: { node: FlexNode }) {
  if (!node.url) return null
  const style: React.CSSProperties = {
    width: node.size === 'full' ? '100%' : (getSize(node.size) || '100%'),
    maxWidth: '100%',
    borderRadius: node.cornerRadius || '0',
    objectFit: (node.aspectMode === 'cover' ? 'cover' : 'contain') as React.CSSProperties['objectFit'],
    ...(node.aspectRatio ? { aspectRatio: node.aspectRatio.replace(':', '/') } : {}),
  }
  return <img src={node.url} alt="" style={style} />
}

function FlexIcon({ node }: { node: FlexNode }) {
  if (!node.url) return null
  const s = getSize(node.size) || '16px'
  return <img src={node.url} alt="" style={{ width: s, height: s, objectFit: 'contain' }} />
}

function FlexSpacer({ node }: { node: FlexNode }) {
  const h = node.size === 'xs' ? '4px' : node.size === 'sm' ? '8px' : node.size === 'md' ? '16px' : node.size === 'lg' ? '24px' : node.size === 'xl' ? '32px' : '16px'
  return <div style={{ height: h }} />
}

function boxAlignItems(node: FlexNode): React.CSSProperties['alignItems'] {
  // baseline レイアウトは常に baseline 揃え (align/gravity より優先)。
  // それ以外は従来の優先順位: align (center/end) > gravity > flex-start。
  if (node.layout === 'baseline') return 'baseline'
  if (node.align === 'center') return 'center'
  if (node.align === 'end') return 'flex-end'
  if (node.gravity === 'center') return 'center'
  if (node.gravity === 'bottom') return 'flex-end'
  return 'flex-start'
}

function FlexBox({ node }: { node: FlexNode }) {
  const isHorizontal = node.layout === 'horizontal' || node.layout === 'baseline'
  const gap = getSpacing(node.spacing) || '0'

  const style: React.CSSProperties = {
    display: 'flex',
    flexDirection: isHorizontal ? 'row' : 'column',
    gap,
    backgroundColor: node.backgroundColor || 'transparent',
    borderRadius: node.cornerRadius || '0',
    ...(node.paddingAll ? { padding: node.paddingAll } : {}),
    ...(node.paddingTop ? { paddingTop: node.paddingTop } : {}),
    ...(node.paddingBottom ? { paddingBottom: node.paddingBottom } : {}),
    ...(node.paddingStart ? { paddingLeft: node.paddingStart } : {}),
    ...(node.paddingEnd ? { paddingRight: node.paddingEnd } : {}),
    ...(node.width ? { width: node.width } : {}),
    ...(node.height ? { height: node.height } : {}),
    ...(isHorizontal ? { alignItems: boxAlignItems(node) } : {}),
    ...(!isHorizontal && node.align === 'center' ? { alignItems: 'center' } : {}),
    ...(!isHorizontal && node.align === 'end' ? { alignItems: 'flex-end' } : {}),
    ...(node.justifyContent ? { justifyContent: node.justifyContent === 'center' ? 'center' : node.justifyContent === 'flex-end' ? 'flex-end' : node.justifyContent === 'space-between' ? 'space-between' : node.justifyContent === 'space-around' ? 'space-around' : 'flex-start' } : {}),
    ...(node.borderWidth ? { border: `${node.borderWidth} solid ${node.borderColor || '#e0e0e0'}` } : {}),
    ...(node.position === 'absolute' ? { position: 'absolute', top: node.offsetTop, bottom: node.offsetBottom, left: node.offsetStart, right: node.offsetEnd } : {}),
  }

  return (
    <div style={style}>
      {(node.contents || []).map((child, i) => (
        <FlexNodeRenderer key={i} node={child} parentLayout={node.layout || 'vertical'} />
      ))}
    </div>
  )
}

function FlexNodeRenderer({ node, parentLayout }: { node: FlexNode; parentLayout?: string }) {
  if (!node || !node.type) return null

  // このラッパー div が親 box の実際の flex item になるので、flex 比率は
  // ここに載せる (子の <p> 等に載せても幅配分に効かない)。
  // flex 比率と minWidth:0 は「横並びの幅配分」のためのものなので、親が
  // horizontal/baseline のときだけ適用する — vertical box で flex-basis 0% を
  // 付けると高さ配分に化けるし、icon/image のラッパーの minWidth を 0 に
  // すると行が溢れた際に画像の固有幅より小さく潰れてはみ出す。
  const inRow = parentLayout === 'horizontal' || parentLayout === 'baseline'
  const keepsIntrinsicWidth = node.type === 'icon' || node.type === 'image' || node.type === 'spacer'
  const wrapperStyle: React.CSSProperties = {
    ...(node.margin ? { marginTop: getMargin(node.margin) } : {}),
    // LINE 仕様: flex=0 はコンテンツ幅 (伸びない・縮みは許す)、flex>=1 は比率で幅配分
    ...(inRow && node.flex !== undefined
      ? { flex: node.flex === 0 ? '0 1 auto' : `${node.flex} 1 0%` }
      : {}),
    ...(inRow && !keepsIntrinsicWidth ? { minWidth: 0 } : {}),
  }

  return (
    <div style={wrapperStyle}>
      {node.type === 'text' && <FlexText node={node} />}
      {node.type === 'button' && <FlexButton node={node} />}
      {node.type === 'separator' && <FlexSeparator node={node} />}
      {node.type === 'image' && <FlexImage node={node} />}
      {node.type === 'icon' && <FlexIcon node={node} />}
      {node.type === 'box' && <FlexBox node={node} />}
      {node.type === 'spacer' && <FlexSpacer node={node} />}
      {node.type === 'span' && <span style={{ fontSize: getSize(node.size), color: node.color, fontWeight: node.weight === 'bold' ? 700 : undefined }}>{node.text}</span>}
    </div>
  )
}

/**
 * header/body/footer ブロックを描画する。ブロック自体も box なので、
 * layout / spacing / gravity を効かせるため FlexBox に委譲する。
 * デフォルト padding (16px) と背景色は外側で持ち、FlexBox 側では
 * 二重適用しないよう打ち消す。
 */
function FlexBlock({ block, grow }: { block: FlexNode; grow?: boolean }) {
  return (
    <div style={{
      backgroundColor: block.backgroundColor || 'transparent',
      padding: block.paddingAll || '16px',
      // body に grow を指定: carousel でバブル高さが揃ったとき、余りを body が
      // 吸収して footer (CTA ボタン) が下端に揃う — LINE 本体と同じ見え方
      ...(grow ? { flex: '1 0 auto' } : {}),
    }}>
      <FlexBox node={{ ...block, paddingAll: '0', backgroundColor: 'transparent' }} />
    </div>
  )
}

function FlexBubble({ bubble, maxWidth, fixedWidth }: { bubble: FlexNode; maxWidth?: number; fixedWidth?: boolean }) {
  // bubble.size が本来の幅。maxWidth は「上限」であり幅の指定ではない —
  // fixedWidth (carousel) でも size 由来の幅を超えないよう clamp するだけで、
  // size より広げる用途には使わない (templates 等の呼び出し元は cap を期待している)。
  const sizeW = bubble.size === 'giga' ? 340 : bubble.size === 'mega' ? 300 : bubble.size === 'kilo' ? 260 : bubble.size === 'micro' ? 160 : bubble.size === 'nano' ? 120 : 300
  const w = maxWidth ? Math.min(sizeW, maxWidth) : sizeW

  return (
    <div style={{
      // carousel 内 (fixedWidth) は幅を固定して flex-shrink を殺す。
      // shrink を許すと兄弟バブルと親幅を分け合って 1 バブル 90px 程度まで潰れ、
      // テキストが1文字ずつ縦に折り返される。はみ出す分は親の overflowX で
      // 横スクロールさせるのが LINE 本体と同じ挙動。
      // 単発 bubble は従来どおり「上限 w・親が狭ければ縮む」で横スクロールを防ぐ。
      ...(fixedWidth
        ? { width: w, flex: '0 0 auto' }
        : { width: '100%', maxWidth: w }),
      backgroundColor: '#fff',
      borderRadius: '12px',
      overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      fontSize: '14px',
      position: 'relative',
      // 縦 flex にして body を grow させる (carousel 等高時の footer 下端揃え)
      display: 'flex',
      flexDirection: 'column',
    }}>
      {bubble.hero && <FlexNodeRenderer node={bubble.hero} />}
      {bubble.header && <FlexBlock block={bubble.header as FlexNode} />}
      {bubble.body && <FlexBlock block={bubble.body as FlexNode} grow />}
      {bubble.footer && <FlexBlock block={bubble.footer as FlexNode} />}
    </div>
  )
}

function FlexPreview({ content, maxWidth }: { content: string; maxWidth?: number }) {
  // チャット画面ではコンポーザーと同一コンポーネント内で描画されるため、
  // キー入力ごとに再レンダーされる。parse をメモ化し、export も memo で包んで
  // content が変わらない限り再描画を丸ごとスキップする。
  const parsed = useMemo(() => {
    try {
      return JSON.parse(content)
    } catch {
      return null
    }
  }, [content])

  if (parsed === null) {
    // 吹き出しなしで描画されることがあるので、背景を自前で持つ (青地に赤文字を防ぐ)
    return <p className="text-xs text-red-600 bg-white rounded-lg px-3 py-2">Flex JSON パースエラー</p>
  }

  if (parsed.type === 'carousel' && Array.isArray(parsed.contents)) {
    // alignItems はデフォルト (stretch) のまま — バブルの高さが揃い、
    // footer が下端に並ぶ LINE 本体と同じ見た目になる
    return (
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', padding: '4px 0', maxWidth: '100%' }}>
        {parsed.contents.map((bubble: FlexNode, i: number) => (
          <FlexBubble key={i} bubble={bubble} maxWidth={maxWidth} fixedWidth />
        ))}
      </div>
    )
  }

  if (parsed.type === 'bubble') {
    return <FlexBubble bubble={parsed} maxWidth={maxWidth} />
  }

  // Unknown type — fallback to text extraction
  return <pre className="text-xs bg-gray-50 rounded p-2 max-h-40 overflow-auto">{JSON.stringify(parsed, null, 2)}</pre>
}

export default memo(FlexPreview)
