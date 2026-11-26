'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getApiBase } from '@/lib/api-base'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'

export default function LoginPage() {
  const [passkeyEnabled,setPasskeyEnabled]=useState(false)
  const [magicEnabled,setMagicEnabled]=useState(false)
  const [email,setEmail]=useState('')
  const [notice,setNotice]=useState('')
  const [keyMode,setKeyMode]=useState('allow')
  const [accessLogin, setAccessLogin] = useState<string | null>(null)
  useEffect(() => {
    const base = getApiBase(); if (!base) return
    let cancelled = false
    fetch(`${base}/api/auth/methods`).then(r=>r.ok?r.json():null).then(data=>{if(!cancelled){setPasskeyEnabled(!!data?.passkey?.enabled&&typeof window.PublicKeyCredential!=='undefined');setMagicEnabled(!!data?.magicLink?.enabled);if(data?.access?.enabled)setAccessLogin(`${base}/auth/access/login`);if(data?.apiKeyMode)setKeyMode(data.apiKeyMode)}}).catch(()=>{})
    return ()=>{cancelled=true}
  }, [])
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const apiUrl = getApiBase()
      if (!apiUrl) {
        setError('NEXT_PUBLIC_API_URL is not set in build env')
        setLoading(false)
        return
      }
      // Exchange the API key for an HttpOnly session cookie. The key is never
      // stored in localStorage (removes the XSS-exposed credential).
      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      })

      if (res.ok) {
        localStorage.removeItem('lh_api_key')
        try {
          const loginData = await res.json()
          if (loginData.success && loginData.data) {
            localStorage.setItem('lh_staff_name', loginData.data.name)
            localStorage.setItem('lh_staff_role', loginData.data.role)
          }
          // Cache the CSRF token for mutating requests (double-submit).
          if (loginData.csrfToken) {
            localStorage.setItem('lh_csrf', loginData.csrfToken)
          }
        } catch {
          // Profile / CSRF caching is best-effort.
        }
        router.push('/')
      } else if (res.status === 401) {
        setError('APIキーが正しくありません')
      } else {
        // Surface topology / configuration errors (e.g. cross-site cookie guard).
        let message = 'ログインに失敗しました'
        try {
          const data = await res.json()
          if (data?.error) message = data.error
        } catch {
          // keep default message
        }
        setError(message)
      }
    } catch {
      setError('接続に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const loginWithPasskey=async()=>{setLoading(true);setError('');try{
    const {startAuthentication}=await import('@simplewebauthn/browser')
    const {fetchApi,setCsrfToken}=await import('@/lib/api')
    const result=await fetchApi<{data:{options:Parameters<typeof startAuthentication>[0]['optionsJSON'];challengeId:string}}>('/api/auth/passkeys/login/options',{method:'POST',body:'{}'})
    const response=await startAuthentication({optionsJSON:result.data.options})
    const verified=await fetchApi<{csrfToken:string}>('/api/auth/passkeys/login/verify',{method:'POST',body:JSON.stringify({challengeId:result.data.challengeId,response})})
    setCsrfToken(verified.csrfToken);router.push('/')
  }catch(e){setError(e instanceof Error?e.message:'パスキーログインに失敗しました')}finally{setLoading(false)}}
  const requestMagic=async()=>{setLoading(true);setError('');try{
    const {fetchApi}=await import('@/lib/api');const result=await fetchApi<{message:string}>('/api/auth/magic-link',{method:'POST',body:JSON.stringify({email})});setNotice(result.message)
  }catch(e){setError(e instanceof Error?e.message:'リクエストに失敗しました')}finally{setLoading(false)}}

  return (
    <div className="min-h-screen flex items-center justify-center bg-kumo-brand p-4">
      <LayerCard className="w-full max-w-sm p-8 shadow-xl">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-kumo-brand text-kumo-inverse font-bold text-lg mx-auto mb-3">
            H
          </div>
          <h1 className="text-xl font-bold text-gray-900">L Harness</h1>
          <p className="text-sm text-gray-500 mt-1">管理画面にログイン</p>
        </div>

        {passkeyEnabled&&<Button className="w-full mb-4" disabled={loading} onClick={()=>void loginWithPasskey()}>パスキーでログイン</Button>}
        {magicEnabled&&<div className="mb-4 space-y-2"><Input type="email" aria-label="メールアドレス" value={email} onChange={e=>setEmail(e.target.value)} placeholder="メールアドレス"/><Button disabled={loading||!email} onClick={()=>void requestMagic()}>ログイン用リンクを送る</Button>{notice&&<p>{notice}</p>}</div>}
        {accessLogin && <a className="block border rounded p-3 mb-4 text-center" href={accessLogin}>Cloudflare Access でログイン</a>}
        {keyMode==='break-glass' && <Banner variant="alert" title="緊急復旧用ログイン">オーナーの現在のAPIキーのみ利用でき、セッションは最大1時間です。</Banner>}
        {keyMode==='disabled' && <Banner variant="secondary" title="APIキーでのログインは無効です">設定された本人認証からログインしてください。外部連携のAPIキーは引き続き利用できます。</Banner>}
        {keyMode!=='disabled' && <form onSubmit={handleLogin}>
          <div className="mb-4">
            <Input
              label="API Key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="APIキーを入力"
              autoFocus
            />
          </div>

          {error && <Banner className="mb-4" size="sm" variant="error" title="ログインできませんでした" description={error} />}

          <Button
            type="submit"
            variant="primary"
            loading={loading}
            disabled={loading || !apiKey}
            className="w-full"
          >
            ログイン
          </Button>
        </form>}
      </LayerCard>
    </div>
  )
}
