'use client'

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
    ...(node.flex !== undefined ? { flex: node.flex } : {}),
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
  return (
    <hr style={{
      border: 'none',
      borderTop: `1px solid ${node.color || '#e0e0e0'}`,
      marginTop: getMargin(node.margin) || '0',
      marginBottom: '0',
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
    ...(node.flex !== undefined ? { flex: node.flex } : {}),
    ...(isHorizontal ? { alignItems: node.gravity === 'center' ? 'center' : node.gravity === 'bottom' ? 'flex-end' : 'flex-start' } : {}),
    ...(node.align === 'center' ? { alignItems: 'center' } : node.align === 'end' ? { alignItems: 'flex-end' } : {}),
    ...(node.justifyContent ? { justifyContent: node.justifyContent === 'center' ? 'center' : node.justifyContent === 'flex-end' ? 'flex-end' : node.justifyContent === 'space-between' ? 'space-between' : node.justifyContent === 'space-around' ? 'space-around' : 'flex-start' } : {}),
    ...(node.borderWidth ? { border: `${node.borderWidth} solid ${node.borderColor || '#e0e0e0'}` } : {}),
    ...(node.position === 'absolute' ? { position: 'absolute', top: node.offsetTop, bottom: node.offsetBottom, left: node.offsetStart, right: node.offsetEnd } : {}),
  }

  return (
    <div style={style}>
      {(node.contents || []).map((child, i) => (
        <FlexNodeRenderer key={i} node={child} />
      ))}
    </div>
  )
}

function FlexNodeRenderer({ node }: { node: FlexNode }) {
  if (!node || !node.type) return null

  const marginStyle: React.CSSProperties = node.margin ? { marginTop: getMargin(node.margin) } : {}

  return (
    <div style={marginStyle}>
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

function FlexBubble({ bubble, maxWidth }: { bubble: FlexNode; maxWidth?: number }) {
  const w = maxWidth || (bubble.size === 'giga' ? 340 : bubble.size === 'mega' ? 300 : bubble.size === 'kilo' ? 260 : 300)

  return (
    <div style={{
      width: w,
      backgroundColor: '#fff',
      borderRadius: '12px',
      overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      fontSize: '14px',
      position: 'relative',
    }}>
      {bubble.hero && <FlexNodeRenderer node={bubble.hero} />}
      {bubble.header && (
        <div style={{
          backgroundColor: (bubble.header as FlexNode).backgroundColor || 'transparent',
          padding: (bubble.header as FlexNode).paddingAll || '16px',
        }}>
          {((bubble.header as FlexNode).contents || []).map((child: FlexNode, i: number) => (
            <FlexNodeRenderer key={i} node={child} />
          ))}
        </div>
      )}
      {bubble.body && (
        <div style={{
          backgroundColor: (bubble.body as FlexNode).backgroundColor || 'transparent',
          padding: (bubble.body as FlexNode).paddingAll || '16px',
        }}>
          {((bubble.body as FlexNode).contents || []).map((child: FlexNode, i: number) => (
            <FlexNodeRenderer key={i} node={child} />
          ))}
        </div>
      )}
      {bubble.footer && (
        <div style={{
          backgroundColor: (bubble.footer as FlexNode).backgroundColor || 'transparent',
          padding: (bubble.footer as FlexNode).paddingAll || '16px',
        }}>
          {((bubble.footer as FlexNode).contents || []).map((child: FlexNode, i: number) => (
            <FlexNodeRenderer key={i} node={child} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function FlexPreview({ content, maxWidth }: { content: string; maxWidth?: number }) {
  try {
    const parsed = JSON.parse(content)

    if (parsed.type === 'carousel' && Array.isArray(parsed.contents)) {
      return (
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', padding: '4px 0' }}>
          {parsed.contents.map((bubble: FlexNode, i: number) => (
            <FlexBubble key={i} bubble={bubble} maxWidth={maxWidth} />
          ))}
        </div>
      )
    }

    if (parsed.type === 'bubble') {
      return <FlexBubble bubble={parsed} maxWidth={maxWidth} />
    }

    // Unknown type — fallback to text extraction
    return <pre className="text-xs bg-gray-50 rounded p-2 max-h-40 overflow-auto">{JSON.stringify(parsed, null, 2)}</pre>
  } catch {
    return <p className="text-xs text-red-500">Flex JSON パースエラー</p>
  }
}
