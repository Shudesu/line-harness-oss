'use client'

import { useEffect, useState } from 'react'
import { getApiBase } from '../../lib/api-base'
import { incomingImageUrl, fetchIncomingImage } from '../../lib/incoming-image'

/** Incoming images are fetched with the session cookie, then displayed as a
 * short-lived object URL. API keys never enter image URLs or markup. */
export default function MessageImage({ src, alt = '', className }: { src?: string; alt?: string; className?: string }) {
  const [loaded, setLoaded] = useState<{ source: string; url: string } | null>(null)
  let privateUrl: string | null = null
  let invalid = false
  try {
    if (src) privateUrl = incomingImageUrl(src, getApiBase() || '')
  } catch { invalid = true }

  useEffect(() => {
    if (!src || !privateUrl || invalid) return
    const controller = new AbortController()
    let objectUrl: string | undefined
    setLoaded(null)
    void fetchIncomingImage(privateUrl, controller.signal).then((blob) => {
      if (controller.signal.aborted) return
      objectUrl = URL.createObjectURL(blob)
      setLoaded({ source: src, url: objectUrl })
    }).catch(() => { /* Keep the label fallback when authorization expires. */ })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src, privateUrl, invalid])

  const displayUrl = privateUrl ? (loaded && loaded.source === src ? loaded.url : undefined) : src
  if (invalid || !displayUrl) return <span>🖼 画像</span>
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={displayUrl} alt={alt} loading="lazy" className={className} />
}
