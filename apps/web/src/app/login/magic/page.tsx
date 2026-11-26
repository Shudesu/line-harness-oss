'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, setCsrfToken } from '@/lib/api';
export default function MagicLoginPage() {
  const router = useRouter(),
    started = useRef(false);
  const [message, setMessage] = useState('ログインを確認しています…');
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get('t');
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setMessage('ログイン用リンクがありません。');
      return;
    }
    fetchApi<{ csrfToken: string }>('/api/auth/magic-link/consume', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then((data) => {
        setCsrfToken(data.csrfToken);
        router.replace('/');
      })
      .catch(() =>
        setMessage(
          'リンクが期限切れか、すでに使用されています。新しいリンクを発行してください。',
        ),
      );
  }, [router]);
  return (
    <main className="p-8">
      <p>{message}</p>
      <a href="/login">ログイン画面へ戻る</a>
    </main>
  );
}
