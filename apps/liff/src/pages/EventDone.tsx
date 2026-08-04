import { Link, useSearchParams } from 'react-router-dom';

export default function EventDone() {
  const [search] = useSearchParams();
  const status = search.get('status') ?? '';

  const isPending = status === 'requested';
  const title = isPending ? '受付しました' : '予約が確定しました';
  const desc = isPending
    ? '運営の承認をお待ちください。承認されると LINE でお知らせします。'
    : '予約が確定しました。LINE で詳細をお送りしました。';

  return (
    <div className="p-8 text-center">
      <div className="text-5xl mb-4">{isPending ? '⏳' : '✅'}</div>
      <h1 className="text-xl font-bold mb-2">{title}</h1>
      <p className="text-sm text-gray-600 mb-6">{desc}</p>
      <Link
        to="/events/me"
        className="inline-block px-6 py-3 bg-blue-600 text-white rounded font-medium"
      >
        予約履歴を見る
      </Link>
    </div>
  );
}
