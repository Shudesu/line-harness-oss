'use client'

import { useState } from 'react'
import Link from 'next/link'

type Section = {
  id: string
  title: string
  icon: string
  content: React.ReactNode
}

function StepBox({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 mb-6">
      <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: '#06C755' }}>
        {step}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-bold text-gray-900 mb-2">{title}</h4>
        <div className="text-sm text-gray-600 leading-relaxed space-y-2">{children}</div>
      </div>
    </div>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 my-3">
      <span className="font-bold">POINT: </span>{children}
    </div>
  )
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800 my-3">
      <span className="font-bold">注意: </span>{children}
    </div>
  )
}

function ManualImg({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="my-3 border border-gray-200 rounded-lg overflow-hidden">
      <img src={src} alt={alt} className="w-full h-auto" loading="lazy" />
      <p className="text-xs text-gray-400 text-center py-1 bg-gray-50">{alt}</p>
    </div>
  )
}

const sections: Section[] = [
  // ==========================================
  // SECTION 0: はじめに
  // ==========================================
  {
    id: 'intro',
    title: 'LINE配信管理とは？',
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    content: (
      <div className="space-y-4">
        <p>
          LINE配信管理は、LINE公式アカウントを<strong>もっと便利に運用するための管理ツール</strong>です。
        </p>
        <p>
          LINE公式アカウント単体ではできない、以下のようなことが実現できます:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>ステップ配信</strong> — 友だち追加後、自動で順番にメッセージを送る</li>
          <li><strong>タグ管理</strong> — 友だちにタグを付けて、属性ごとに配信を分ける</li>
          <li><strong>AI自動返信</strong> — AIが自動でメッセージに返信（人間が返信しているように遅延あり）</li>
          <li><strong>個別チャット</strong> — 管理画面から友だちと直接やり取り</li>
          <li><strong>一斉配信</strong> — 全員・またはタグで絞り込んで一斉送信</li>
          <li><strong>フォーム</strong> — LINEの中でアンケートや申し込みフォームを表示</li>
          <li><strong>流入経路分析</strong> — どこから友だち追加されたかを追跡</li>
          <li><strong>複数アカウント管理</strong> — 複数のLINE公式アカウントを1つの画面で管理</li>
        </ul>
        <Tip>LINEの「Lステップ」「エルメ」といったサービスと同じような機能を、自分のサーバーで無料で使えます。</Tip>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">必要なもの</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>LINE公式アカウント（無料で作成可能）</li>
          <li>LINE Developersアカウント（無料）</li>
          <li>このLINE配信管理の管理画面へのログイン情報</li>
        </ul>
      </div>
    ),
  },

  // ==========================================
  // SECTION 1: 初期設定
  // ==========================================
  {
    id: 'setup',
    title: '初期設定（はじめての方はここから）',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    content: (
      <div>
        <h3 className="text-base font-bold text-gray-900 mb-4">Step A: LINE公式アカウントを作成する</h3>
        <p className="text-sm text-gray-500 mb-4">既に持っている方はStep Bに進んでください。</p>

        <StepBox step={1} title="LINE Official Account Managerにアクセス">
          <p>
            <a href="https://manager.line.biz/" target="_blank" rel="noopener noreferrer" className="text-green-600 underline font-medium">
              https://manager.line.biz/
            </a>
            {' '}を開いて、LINEアカウントでログインします。
          </p>
        </StepBox>

        <StepBox step={2} title="「アカウントを作成」をクリック">
          <p>アカウント名、業種を入力して作成します。後から変更できるので、仮の名前でもOKです。</p>
        </StepBox>

        <StepBox step={3} title="作成完了">
          <p>これでLINE公式アカウントができました。次はLINE Developersの設定をします。</p>
        </StepBox>

        <div className="border-t border-gray-200 my-8" />

        <h3 className="text-base font-bold text-gray-900 mb-4">Step B: LINE Developersでチャネルを作成する</h3>
        <p className="text-sm text-gray-500 mb-4">LINE配信管理がLINEと通信するための「接続情報」を取得します。</p>

        <StepBox step={1} title="LINE Developers Consoleにログイン">
          <p>
            <a href="https://developers.line.biz/console/" target="_blank" rel="noopener noreferrer" className="text-green-600 underline font-medium">
              https://developers.line.biz/console/
            </a>
            {' '}を開きます。初回はプロバイダーの作成が必要です（名前を入力するだけ）。
          </p>
          <ManualImg src="/manual/05-console-home.png" alt="LINE Developers Console ホーム画面" />
        </StepBox>

        <StepBox step={2} title="Messaging APIチャネルを作成">
          <p>プロバイダーを選択 →「新規チャネル作成」→「Messaging API」を選びます。</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><strong>チャネル名</strong>: LINE公式アカウントと同じ名前でOK</li>
            <li><strong>チャネル説明</strong>: 何でもOK（「LINE配信管理」など）</li>
            <li><strong>大業種・小業種</strong>: 該当するものを選択</li>
          </ul>
          <Warning>既にLINE公式アカウントが存在する場合は「LINE Official Account Managerで設定 → Messaging API」から有効化する方法もあります。</Warning>
          <ManualImg src="/manual/08-messaging-api-tab.png" alt="Messaging API設定タブ" />
        </StepBox>

        <StepBox step={3} title="Channel IDをメモする">
          <p>チャネルの「基本設定」タブに表示される<strong>「チャネルID」</strong>（数字の並び）をメモします。</p>
          <ManualImg src="/manual/06-channel-basic.png" alt="チャネル基本設定 - チャネルIDの場所" />
        </StepBox>

        <StepBox step={4} title="Channel Secretをメモする">
          <p>同じ「基本設定」タブの下の方にある<strong>「チャネルシークレット」</strong>をメモします。</p>
          <ManualImg src="/manual/07-channel-secret.png" alt="チャネル基本設定 - チャネルシークレットの場所" />
        </StepBox>

        <StepBox step={5} title="Channel Access Tokenを発行する">
          <p>「Messaging API設定」タブ →  一番下の<strong>「チャネルアクセストークン（長期）」</strong>の「発行」ボタンを押します。</p>
          <p>表示された長い文字列をメモします。</p>
          <ManualImg src="/manual/10-channel-token.png" alt="Messaging API設定 - チャネルアクセストークン（長期）" />
          <Warning>このトークンは他の人に見せないでください。LINEアカウントを操作できる鍵になります。</Warning>
        </StepBox>

        <div className="border-t border-gray-200 my-8" />

        <h3 className="text-base font-bold text-gray-900 mb-4">Step C: LINE配信管理にアカウントを登録する</h3>

        <StepBox step={1} title="「LINEアカウント管理」ページを開く">
          <p>
            サイドバーの「設定」→「
            <Link href="/accounts" className="text-green-600 underline font-medium">LINEアカウント</Link>
            」をクリックします。
          </p>
          <ManualImg src="/manual/03-accounts.png" alt="LINEアカウント管理画面" />
        </StepBox>

        <StepBox step={2} title="4つの情報を入力して「登録」">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>アカウント名</strong>: 自分がわかる名前（例：「メインアカウント」）</li>
            <li><strong>Channel ID</strong>: Step B-3でメモしたもの</li>
            <li><strong>Channel Access Token</strong>: Step B-5で発行したもの</li>
            <li><strong>Channel Secret</strong>: Step B-4でメモしたもの</li>
          </ul>
          <ManualImg src="/manual/04-add-account.png" alt="アカウント追加フォーム" />
        </StepBox>

        <StepBox step={3} title="Webhook URLを設定する">
          <p>LINE Developers Console →「Messaging API設定」タブで：</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li><strong>Webhook URL</strong> に以下を入力:</li>
          </ul>
          <code className="block bg-gray-100 rounded px-3 py-2 text-xs mt-2 break-all select-all">
            https://line-harness.buyers-cloud.workers.dev/webhook
          </code>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li>「Webhookの利用」を<strong>オン</strong>にする</li>
            <li>「検証」ボタンを押して「成功」と表示されればOK</li>
          </ul>
          <ManualImg src="/manual/09-webhook-url.png" alt="Webhook URL設定画面" />
        </StepBox>

        <StepBox step={4} title="応答設定を変更する">
          <p>LINE Official Account Manager → 設定 → 応答設定:</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li><strong>応答メッセージ</strong>: オフ</li>
            <li><strong>あいさつメッセージ</strong>: オフ（LINE配信管理のシナリオ配信で代替するため）</li>
            <li><strong>Webhook</strong>: オン</li>
          </ul>
          <ManualImg src="/manual/10-channel-token.png" alt="応答設定画面（応答メッセージ・あいさつメッセージをオフに）" />
          <Tip>応答メッセージをオフにしないと、LINE側の自動返信とLINE配信管理の返信が二重になります。</Tip>
        </StepBox>

        <div className="bg-green-50 border border-green-300 rounded-lg p-4 mt-6">
          <p className="text-sm font-bold text-green-800 mb-1">初期設定完了！</p>
          <p className="text-sm text-green-700">
            これで友だちが追加されると、LINE配信管理に自動で反映されるようになります。
            ダッシュボードに戻って、友だちを追加してみましょう。
          </p>
        </div>
      </div>
    ),
  },

  // ==========================================
  // SECTION 2: ダッシュボード
  // ==========================================
  {
    id: 'dashboard',
    title: 'ダッシュボード',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    content: (
      <div className="space-y-4">
        <p>ログイン後に最初に表示される画面です。</p>
        <h4 className="font-bold text-gray-900">アカウント切り替え</h4>
        <p>画面上部にLINE公式アカウントのカードが並びます。クリックすると、そのアカウントの統計に切り替わります。</p>
        <h4 className="font-bold text-gray-900">統計カード</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>友だち数</strong> — 現在フォロー中の友だちの数</li>
          <li><strong>アクティブシナリオ数</strong> — 有効になっているシナリオ配信の数</li>
          <li><strong>配信数</strong> — 一斉配信の合計回数</li>
          <li><strong>テンプレート数</strong> — 保存済みのメッセージテンプレート数</li>
          <li><strong>アクティブルール数</strong> — 動いているオートメーションルールの数</li>
          <li><strong>スコアリングルール数</strong> — 友だちのスコアリング設定の数</li>
        </ul>
        <p>各カードをクリックすると、その機能の詳細ページに移動します。</p>
      </div>
    ),
  },

  // ==========================================
  // SECTION 3: 友だち管理
  // ==========================================
  {
    id: 'friends',
    title: '友だち管理',
    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    content: (
      <div className="space-y-4">
        <p>LINE公式アカウントの友だち（フォロワー）を一覧・管理する画面です。</p>

        <h4 className="font-bold text-gray-900">できること</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>友だち一覧</strong> — 名前・アイコン・追加日時が表示されます</li>
          <li><strong>タグ付け</strong> — 友だちに自由なタグを付けて分類（例：「VIP」「問い合わせ済み」）</li>
          <li><strong>検索・絞り込み</strong> — 名前やタグで検索できます</li>
          <li><strong>詳細表示</strong> — 友だちをクリックすると、やり取り履歴やスコアなどが見られます</li>
        </ul>

        <h4 className="font-bold text-gray-900 mt-4">タグの使い方</h4>
        <StepBox step={1} title="タグを作成する">
          <p>友だち管理画面の「タグ管理」ボタンからタグを新規作成します。色も選べます。</p>
        </StepBox>
        <StepBox step={2} title="友だちにタグを付ける">
          <p>友だちの詳細画面 or 一覧のチェックボックスから、タグを追加できます。</p>
        </StepBox>
        <StepBox step={3} title="タグで絞り込む">
          <p>一斉配信やシナリオで「タグが〇〇の人だけに送る」ことができます。</p>
        </StepBox>

        <Tip>友だちはLINEで追加されると自動で反映されます。手動で追加する必要はありません。</Tip>
      </div>
    ),
  },

  // ==========================================
  // SECTION 4: 個別チャット
  // ==========================================
  {
    id: 'chats',
    title: '個別チャット',
    icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    content: (
      <div className="space-y-4">
        <p>友だちと1対1でメッセージのやり取りができる画面です。LINEの管理画面の「チャット」と同じ感覚で使えます。</p>

        <h4 className="font-bold text-gray-900">できること</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li>友だちからの受信メッセージを確認</li>
          <li>テキストメッセージを送信</li>
          <li>画像の送信</li>
          <li>過去のやり取り履歴を確認</li>
        </ul>

        <Tip>AI自動返信が有効な場合、AIが返信する前に手動で返信すると、AIのキュー内の返信は自動キャンセルされます。</Tip>
      </div>
    ),
  },

  // ==========================================
  // SECTION 5: シナリオ配信
  // ==========================================
  {
    id: 'scenarios',
    title: 'シナリオ配信（ステップ配信）',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
    content: (
      <div className="space-y-4">
        <p>
          友だち追加後に、<strong>決められた順番で自動的にメッセージを送る</strong>機能です。
          「Lステップ」のステップ配信と同じ仕組みです。
        </p>

        <h4 className="font-bold text-gray-900">例：こんな使い方</h4>
        <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-2">
          <p><strong>Day 0</strong>（友だち追加直後）: 「友だち追加ありがとうございます！」</p>
          <p><strong>Day 1</strong>（1日後）: 「サービスの使い方ガイドをお送りします」</p>
          <p><strong>Day 3</strong>（3日後）: 「よくある質問をまとめました」</p>
          <p><strong>Day 7</strong>（7日後）: 「初回限定クーポンをプレゼント！」</p>
        </div>

        <h4 className="font-bold text-gray-900 mt-4">設定方法</h4>
        <StepBox step={1} title="シナリオを作成">
          <p>
            <Link href="/scenarios" className="text-green-600 underline">シナリオ配信</Link>
            ページで「新規シナリオ」をクリック。名前を付けて作成します。
          </p>
        </StepBox>
        <StepBox step={2} title="ステップを追加">
          <p>「ステップ追加」で、何日後に何を送るかを設定します。テキスト、画像、Flexメッセージが使えます。</p>
        </StepBox>
        <StepBox step={3} title="シナリオを有効化">
          <p>設定が終わったらスイッチをオンにします。以降の新しい友だちに自動で配信されます。</p>
        </StepBox>

        <Warning>シナリオを有効化する前に追加された友だちには配信されません。既存の友だちに送りたい場合は一斉配信を使ってください。</Warning>
      </div>
    ),
  },

  // ==========================================
  // SECTION 6: 一斉配信
  // ==========================================
  {
    id: 'broadcasts',
    title: '一斉配信',
    icon: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z',
    content: (
      <div className="space-y-4">
        <p>全員、またはタグで絞り込んだ友だちに<strong>メッセージを一斉送信</strong>する機能です。</p>

        <h4 className="font-bold text-gray-900">送信方法</h4>
        <StepBox step={1} title="配信を作成">
          <p>「新規配信」ボタンをクリック。</p>
        </StepBox>
        <StepBox step={2} title="対象を選択">
          <p>「全員」か「タグで絞り込み」を選びます。複数タグを選ぶとAND条件になります。</p>
        </StepBox>
        <StepBox step={3} title="メッセージを入力">
          <p>テキスト、画像、Flexメッセージが使えます。テンプレートから選ぶこともできます。</p>
        </StepBox>
        <StepBox step={4} title="送信 or 予約">
          <p>「今すぐ送信」か「日時指定送信」を選べます。</p>
        </StepBox>

        <Warning>LINEの無料プランはメッセージ配信数に月間上限（200通）があります。配信前に残りの配信可能数を確認してください。</Warning>
      </div>
    ),
  },

  // ==========================================
  // SECTION 7: テンプレート
  // ==========================================
  {
    id: 'templates',
    title: 'テンプレート',
    icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z',
    content: (
      <div className="space-y-4">
        <p>よく使うメッセージを<strong>テンプレートとして保存</strong>しておく機能です。</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>一斉配信やシナリオ配信で「テンプレートから挿入」が使える</li>
          <li>個別チャットでもテンプレートをワンクリックで送信可能</li>
          <li>テキスト・画像・Flex（カードUI）が保存できる</li>
        </ul>
        <Tip>よく送る定型文（営業時間のご案内、クーポン情報など）はテンプレートに登録しておくと効率的です。</Tip>
      </div>
    ),
  },

  // ==========================================
  // SECTION 8: リマインダ
  // ==========================================
  {
    id: 'reminders',
    title: 'リマインダ',
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    content: (
      <div className="space-y-4">
        <p>友だちに<strong>特定のタイミングでリマインドメッセージ</strong>を送る機能です。</p>
        <p>予約日やイベント日の前日にお知らせを送る、といった使い方ができます。</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>「○日前」「当日」「○日後」のように複数ステップ設定可能</li>
          <li>友だち個別にリマインダを割り当て</li>
        </ul>
      </div>
    ),
  },

  // ==========================================
  // SECTION 9: オートメーション
  // ==========================================
  {
    id: 'automations',
    title: 'オートメーション',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    content: (
      <div className="space-y-4">
        <p><strong>「〇〇が起きたら△△する」</strong>という自動処理ルールを設定する機能です。</p>

        <h4 className="font-bold text-gray-900">設定例</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li>友だち追加されたら →「新規友だち」タグを自動付与</li>
          <li>特定のキーワードを受信したら → タグを変更</li>
          <li>フォーム送信されたら → スタッフに通知</li>
        </ul>

        <h4 className="font-bold text-gray-900 mt-4">トリガーの種類</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>友だち追加</strong></li>
          <li><strong>メッセージ受信</strong>（キーワード一致）</li>
          <li><strong>タグ追加・削除</strong></li>
          <li><strong>フォーム送信</strong></li>
        </ul>

        <h4 className="font-bold text-gray-900 mt-4">アクションの種類</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>タグ追加・削除</strong></li>
          <li><strong>メッセージ送信</strong></li>
          <li><strong>シナリオ開始・停止</strong></li>
          <li><strong>Webhook送信</strong>（外部サービス連携）</li>
        </ul>
      </div>
    ),
  },

  // ==========================================
  // SECTION 10: AI自動返信
  // ==========================================
  {
    id: 'ai-reply',
    title: 'AI自動返信',
    icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z',
    content: (
      <div className="space-y-4">
        <p>
          友だちからメッセージが来たとき、<strong>AIが自動で返信を生成</strong>する機能です。
          すぐに返信せず、10〜30分のランダムな遅延を入れることで人間が返信しているように見せます。
        </p>

        <h4 className="font-bold text-gray-900">設定方法</h4>
        <StepBox step={1} title="AI自動返信ページを開く">
          <p>
            サイドバーの「設定」→「
            <Link href="/ai-reply" className="text-green-600 underline">AI自動返信</Link>
            」をクリック。
          </p>
        </StepBox>
        <StepBox step={2} title="有効化スイッチをオン">
          <p>トグルスイッチをオンにすると、AI自動返信が動き始めます。</p>
        </StepBox>
        <StepBox step={3} title="システムプロンプトを設定">
          <p>AIにどう返信してほしいかを指示します。</p>
          <div className="bg-gray-50 rounded p-3 mt-2 text-xs">
            <p className="font-medium mb-1">例:</p>
            <p>「あなたはエステサロンのスタッフです。お客様に丁寧に対応してください。予約の問い合わせには営業時間（10:00〜19:00）を案内してください。」</p>
          </div>
        </StepBox>
        <StepBox step={4} title="テストする">
          <p>ページ下部の「テスト」欄にメッセージを入力して、AIの返信を確認できます。実際には送信されません。</p>
        </StepBox>

        <h4 className="font-bold text-gray-900 mt-4">設定項目の説明</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>AIモデル</strong> — Haiku（高速・安い）/ Sonnet（バランス）/ Opus（高精度）。普段はHaikuで十分です</li>
          <li><strong>最小/最大遅延</strong> — 返信までの待ち時間。デフォルトは10〜30分</li>
          <li><strong>会話コンテキスト件数</strong> — AIに渡す直近の会話数。多いほど文脈を理解しますがコストが上がります</li>
          <li><strong>最大トークン数</strong> — AI返信の最大文字数の目安</li>
        </ul>

        <h4 className="font-bold text-gray-900 mt-4">送信キュー</h4>
        <p>ページ下部に「送信待ち」の返信一覧が表示されます。送信前なら「キャンセル」ボタンで取り消せます。</p>

        <Tip>キーワード自動応答にマッチしたメッセージにはAIは返信しません。キーワード応答が優先されます。</Tip>
        <Warning>AI自動返信にはAnthropic APIの利用料がかかります（Haikuモデルなら1返信あたり約0.1円程度）。</Warning>
      </div>
    ),
  },

  // ==========================================
  // SECTION 11: 流入経路
  // ==========================================
  {
    id: 'affiliates',
    title: '流入経路（アフィリエイト）',
    icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
    content: (
      <div className="space-y-4">
        <p><strong>どこから友だち追加されたかを追跡</strong>する機能です。</p>
        <p>SNS、ブログ、チラシなど、複数の集客経路があるときに、どこからの流入が多いかを分析できます。</p>

        <h4 className="font-bold text-gray-900">使い方</h4>
        <StepBox step={1} title="流入経路を作成">
          <p>名前を付けて作成（例：「Instagram広告」「店舗チラシ」）。</p>
        </StepBox>
        <StepBox step={2} title="専用URLを取得">
          <p>作成すると専用のURLが発行されます。このURLを各集客チャネルに貼り付けます。</p>
        </StepBox>
        <StepBox step={3} title="流入数を確認">
          <p>友だちがそのURL経由で追加されると、流入経路ごとに人数がカウントされます。</p>
        </StepBox>
      </div>
    ),
  },

  // ==========================================
  // SECTION 12: スコアリング
  // ==========================================
  {
    id: 'scoring',
    title: 'スコアリング',
    icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z',
    content: (
      <div className="space-y-4">
        <p>友だちの行動に基づいて<strong>ポイント（スコア）を自動的に加算</strong>する機能です。</p>
        <p>スコアが高い友だち = 関心が高い顧客、として優先対応やセグメント配信に活用できます。</p>

        <h4 className="font-bold text-gray-900">スコア加算の例</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li>メッセージを送信 → +5点</li>
          <li>URLをクリック → +10点</li>
          <li>フォームに回答 → +20点</li>
          <li>友だち追加 → +1点</li>
        </ul>
      </div>
    ),
  },

  // ==========================================
  // SECTION 13: フォーム回答
  // ==========================================
  {
    id: 'forms',
    title: 'フォーム回答',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    content: (
      <div className="space-y-4">
        <p>LINEの中で<strong>アンケートや申し込みフォーム</strong>を表示して回答を収集できます。</p>
        <p>回答データはフォーム回答ページで一覧・CSVダウンロードが可能です。</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>テキスト入力、ラジオボタン、チェックボックス、ドロップダウンに対応</li>
          <li>回答内容は友だちの詳細画面からも確認可能</li>
          <li>フォーム送信をトリガーにオートメーションも設定可能</li>
        </ul>
      </div>
    ),
  },

  // ==========================================
  // SECTION 14: スタッフ管理
  // ==========================================
  {
    id: 'staff',
    title: 'スタッフ管理',
    icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
    content: (
      <div className="space-y-4">
        <p>管理画面にログインできる<strong>スタッフアカウント</strong>を管理します。</p>

        <h4 className="font-bold text-gray-900">権限レベル</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>オーナー</strong> — 全機能にアクセス可能。アカウント設定やスタッフ管理ができる</li>
          <li><strong>管理者</strong> — ほぼ全機能にアクセス可能。スタッフ管理以外</li>
          <li><strong>スタッフ</strong> — チャットや友だち管理など、日常業務のみ</li>
        </ul>

        <StepBox step={1} title="スタッフを追加">
          <p>「新規スタッフ」から名前と権限を設定。APIキーが自動発行されます。</p>
        </StepBox>
        <StepBox step={2} title="APIキーを共有">
          <p>発行されたAPIキーをスタッフに伝えます。ログイン画面でこのキーを入力してもらいます。</p>
        </StepBox>

        <Warning>APIキーはパスワードと同じです。漏洩しないよう安全に管理してください。</Warning>
      </div>
    ),
  },

  // ==========================================
  // SECTION 15: LINEアカウント管理
  // ==========================================
  {
    id: 'accounts',
    title: 'LINEアカウント管理',
    icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
    content: (
      <div className="space-y-4">
        <p>LINE公式アカウントの接続情報を管理する画面です。</p>
        <p>複数のLINE公式アカウントを登録して、1つの管理画面で切り替えて運用できます。</p>

        <h4 className="font-bold text-gray-900">登録に必要な情報</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>アカウント名</strong> — 管理しやすい名前（自由に設定）</li>
          <li><strong>Channel ID</strong> — LINE Developers Consoleの基本設定にある数字</li>
          <li><strong>Channel Access Token</strong> — Messaging API設定で発行する長い文字列</li>
          <li><strong>Channel Secret</strong> — 基本設定にある英数字の文字列</li>
        </ul>

        <p className="mt-2">これらの取得方法は「
          <button className="text-green-600 underline font-medium" onClick={() => {
            document.getElementById('section-setup')?.scrollIntoView({ behavior: 'smooth' })
          }}>初期設定</button>
          」セクションを参照してください。
        </p>
      </div>
    ),
  },

  // ==========================================
  // SECTION 16: Webhook
  // ==========================================
  {
    id: 'webhooks',
    title: 'Webhook連携',
    icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    content: (
      <div className="space-y-4">
        <p>LINE配信管理で起きたイベントを<strong>外部のシステムに通知</strong>する機能です。</p>
        <p>Webhook URLを登録すると、友だち追加やメッセージ受信時に、そのURLにJSONデータがPOSTされます。</p>

        <h4 className="font-bold text-gray-900">使用例</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li>Googleスプレッドシートに友だち情報を自動記録（Zapier/n8n経由）</li>
          <li>Slackにメッセージ受信を通知</li>
          <li>自社CRMに顧客データを同期</li>
        </ul>
      </div>
    ),
  },

  // ==========================================
  // SECTION 17: BAN検知
  // ==========================================
  {
    id: 'health',
    title: 'BAN検知',
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    content: (
      <div className="space-y-4">
        <p>LINE公式アカウントの<strong>健康状態を監視</strong>する画面です。</p>
        <p>5分ごとにLINE APIの応答を確認し、異常（BAN・制限）が発生した場合にアラートを表示します。</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>APIレスポンスコードの履歴</li>
          <li>エラー率の推移</li>
          <li>ステータス変化時の通知</li>
        </ul>
        <Tip>大量配信後にエラー率が上がった場合は、配信頻度を下げることを検討してください。</Tip>
      </div>
    ),
  },

  // ==========================================
  // SECTION 18: 通知
  // ==========================================
  {
    id: 'notifications',
    title: '通知設定',
    icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
    content: (
      <div className="space-y-4">
        <p>特定のイベントが発生したときに<strong>通知を受け取る</strong>設定です。</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>新しい友だちが追加されたとき</li>
          <li>メッセージを受信したとき</li>
          <li>フォームが送信されたとき</li>
          <li>アカウントのエラーが検知されたとき</li>
        </ul>
      </div>
    ),
  },

  // ==========================================
  // SECTION 19: FAQ
  // ==========================================
  {
    id: 'faq',
    title: 'よくある質問',
    icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    content: (
      <div className="space-y-6">
        <div>
          <h4 className="font-bold text-gray-900 mb-2">Q: 友だちが管理画面に反映されません</h4>
          <p className="text-sm text-gray-600">
            A: Webhook URLが正しく設定されているか確認してください。LINE Developers Console → Messaging API設定 → Webhook URL に
            <code className="bg-gray-100 px-1 rounded text-xs mx-1">https://line-harness.buyers-cloud.workers.dev/webhook</code>
            が入っていて、「Webhookの利用」がオンになっていることを確認します。
          </p>
        </div>
        <div>
          <h4 className="font-bold text-gray-900 mb-2">Q: メッセージが送信されません</h4>
          <p className="text-sm text-gray-600">
            A: Channel Access Tokenが正しいか確認してください。トークンの有効期限が切れている場合は、LINE Developers Consoleで再発行してください。
          </p>
        </div>
        <div>
          <h4 className="font-bold text-gray-900 mb-2">Q: AI自動返信が動きません</h4>
          <p className="text-sm text-gray-600">
            A: AI自動返信ページでスイッチがオンになっていることを確認してください。また、キーワード自動応答にマッチした場合はAIは返信しません。
          </p>
        </div>
        <div>
          <h4 className="font-bold text-gray-900 mb-2">Q: 複数のLINEアカウントを管理できますか？</h4>
          <p className="text-sm text-gray-600">
            A: はい。「LINEアカウント管理」ページから複数登録できます。ダッシュボードのアカウントカードで切り替えます。
          </p>
        </div>
        <div>
          <h4 className="font-bold text-gray-900 mb-2">Q: 料金はかかりますか？</h4>
          <p className="text-sm text-gray-600">
            A: LINE配信管理自体は無料です。ただし以下の費用がかかる場合があります:
          </p>
          <ul className="list-disc pl-5 text-sm text-gray-600 mt-1 space-y-1">
            <li>LINEメッセージ配信: 無料プラン月200通まで。超える場合は有料プランが必要</li>
            <li>AI自動返信: Anthropic APIの従量課金（Haikuで1返信あたり約0.1円）</li>
          </ul>
        </div>
        <div>
          <h4 className="font-bold text-gray-900 mb-2">Q: 応答メッセージとAI自動返信が二重になります</h4>
          <p className="text-sm text-gray-600">
            A: LINE Official Account Manager → 設定 → 応答設定 で「応答メッセージ」をオフにしてください。
          </p>
        </div>
      </div>
    ),
  },
]

export default function ManualPage() {
  const [activeSection, setActiveSection] = useState('intro')
  const [guideMode, setGuideMode] = useState<'user' | 'admin'>('user')

  const currentSection = sections.find((s) => s.id === activeSection) || sections[0]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">操作マニュアル</h1>
        <p className="text-sm text-gray-500 mt-1">LINE配信管理の使い方ガイド</p>
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => setGuideMode('user')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              guideMode === 'user'
                ? 'text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            style={guideMode === 'user' ? { backgroundColor: '#06C755' } : undefined}
          >
            ユーザーガイド
          </button>
          <button
            onClick={() => setGuideMode('admin')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              guideMode === 'admin'
                ? 'text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            style={guideMode === 'admin' ? { backgroundColor: '#06C755' } : undefined}
          >
            管理者ガイド
          </button>
        </div>
      </div>

      {guideMode === 'admin' ? (
        <AdminGuide />
      ) : (
      <></>
      )}

      {guideMode === 'user' && (

      <div className="flex flex-col lg:flex-row gap-6">
        {/* 目次サイドバー */}
        <div className="lg:w-64 shrink-0">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden lg:sticky lg:top-4">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">目次</p>
            </div>
            <nav className="py-2 max-h-[60vh] overflow-y-auto">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors ${
                    activeSection === section.id
                      ? 'bg-green-50 text-green-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={section.icon} />
                  </svg>
                  <span className="truncate">{section.title}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* コンテンツ */}
        <div className="flex-1 min-w-0">
          <div id={`section-${currentSection.id}`} className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0" style={{ backgroundColor: '#06C755' }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={currentSection.icon} />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-900">{currentSection.title}</h2>
            </div>
            <div className="text-sm leading-relaxed text-gray-700">
              {currentSection.content}
            </div>
          </div>

          {/* ページ送り */}
          <div className="flex justify-between mt-4">
            {(() => {
              const idx = sections.findIndex((s) => s.id === activeSection)
              const prev = idx > 0 ? sections[idx - 1] : null
              const next = idx < sections.length - 1 ? sections[idx + 1] : null
              return (
                <>
                  {prev ? (
                    <button
                      onClick={() => { setActiveSection(prev.id); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                      className="text-sm text-gray-500 hover:text-green-600 flex items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      {prev.title}
                    </button>
                  ) : <div />}
                  {next ? (
                    <button
                      onClick={() => { setActiveSection(next.id); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                      className="text-sm text-gray-500 hover:text-green-600 flex items-center gap-1"
                    >
                      {next.title}
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ) : <div />}
                </>
              )
            })()}
          </div>
        </div>
      </div>
      )}
    </div>
  )
}

// =============================================================================
// 管理者ガイド
// =============================================================================

function CodeBlock({ children, title }: { children: string; title?: string }) {
  return (
    <div className="my-3">
      {title && <p className="text-xs font-medium text-gray-500 mb-1">{title}</p>}
      <pre className="bg-gray-900 text-green-400 rounded-lg p-4 text-xs overflow-x-auto whitespace-pre-wrap">
        {children}
      </pre>
    </div>
  )
}

function AdminSection({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 sm:p-8 mb-6">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0" style={{ backgroundColor: '#06C755' }}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      </div>
      <div className="text-sm leading-relaxed text-gray-700 space-y-4">{children}</div>
    </div>
  )
}

function AdminGuide() {
  return (
    <div className="space-y-6">
      {/* アーキテクチャ概要 */}
      <AdminSection title="システムアーキテクチャ" icon="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10">
        <p>
          本システム（内部名: <strong>LINE Harness</strong>）は、Cloudflare Workers + D1 + R2 をバックエンドに使用し、
          Next.js の静的エクスポートをフロントエンドとして Vercel にデプロイする構成です。
        </p>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">技術スタック</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left px-4 py-2 border border-gray-200 font-medium">レイヤー</th>
                <th className="text-left px-4 py-2 border border-gray-200 font-medium">技術</th>
                <th className="text-left px-4 py-2 border border-gray-200 font-medium">用途</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="px-4 py-2 border border-gray-200">バックエンド</td><td className="px-4 py-2 border border-gray-200">Cloudflare Workers (Hono)</td><td className="px-4 py-2 border border-gray-200">API / Webhook / Cron</td></tr>
              <tr><td className="px-4 py-2 border border-gray-200">データベース</td><td className="px-4 py-2 border border-gray-200">Cloudflare D1 (SQLite)</td><td className="px-4 py-2 border border-gray-200">友だち / 配信 / 設定等の永続化</td></tr>
              <tr><td className="px-4 py-2 border border-gray-200">ストレージ</td><td className="px-4 py-2 border border-gray-200">Cloudflare R2</td><td className="px-4 py-2 border border-gray-200">画像アップロード</td></tr>
              <tr><td className="px-4 py-2 border border-gray-200">フロントエンド</td><td className="px-4 py-2 border border-gray-200">Next.js (Static Export)</td><td className="px-4 py-2 border border-gray-200">管理画面 SPA</td></tr>
              <tr><td className="px-4 py-2 border border-gray-200">ホスティング</td><td className="px-4 py-2 border border-gray-200">Vercel</td><td className="px-4 py-2 border border-gray-200">静的ファイル配信</td></tr>
              <tr><td className="px-4 py-2 border border-gray-200">AI返信</td><td className="px-4 py-2 border border-gray-200">Claude API (Anthropic)</td><td className="px-4 py-2 border border-gray-200">自動返信メッセージ生成</td></tr>
            </tbody>
          </table>
        </div>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">リクエストフロー</h3>
        <CodeBlock>{`[ユーザー] → [Vercel (管理画面)] → [Cloudflare Worker (API)]
                                              ↕
                                        [D1 Database]
                                              ↕
                                         [R2 Storage]

[LINE友だち] → [LINE Platform] → [Worker /webhook] → [D1 + 自動応答/AI返信]
                                                    → [LINE API (push/reply)]`}</CodeBlock>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">Cronジョブ (5分ごと)</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>予約配信送信</strong> — scheduled_atが到来した配信を自動送信</li>
          <li><strong>シナリオ配信</strong> — 次ステップ送信時刻が到来したシナリオを処理</li>
          <li><strong>AI返信キュー処理</strong> — 送信時刻が到来したAI返信をLINE送信</li>
          <li><strong>リマインダ送信</strong> — 期日到来のリマインダを処理</li>
          <li><strong>BAN検知</strong> — LINEアカウントの健全性チェック</li>
        </ul>
      </AdminSection>

      {/* リポジトリ構成 */}
      <AdminSection title="リポジトリ構成" icon="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z">
        <CodeBlock>{`line-harness-oss/
├── apps/
│   ├── worker/              # Cloudflare Worker (バックエンドAPI)
│   │   ├── src/
│   │   │   ├── index.ts     # エントリポイント (Hono app, cron)
│   │   │   ├── routes/      # APIルート
│   │   │   │   ├── webhook.ts
│   │   │   │   ├── broadcasts.ts
│   │   │   │   ├── friends.ts
│   │   │   │   ├── scenarios.ts
│   │   │   │   ├── ai-reply.ts
│   │   │   │   └── ...
│   │   │   └── services/    # ビジネスロジック
│   │   │       ├── broadcast.ts
│   │   │       ├── ai-reply.ts
│   │   │       └── ...
│   │   └── wrangler.toml    # Cloudflare設定
│   └── web/                 # Next.js フロントエンド
│       ├── src/
│       │   ├── app/         # ページ (App Router)
│       │   ├── components/  # UIコンポーネント
│       │   ├── contexts/    # React Context (AccountProvider等)
│       │   └── lib/         # APIクライアント
│       └── .env.local       # 環境変数
├── packages/
│   ├── db/                  # D1クエリヘルパー + マイグレーション
│   │   ├── src/             # TypeScriptクエリ関数
│   │   └── migrations/      # SQLマイグレーション
│   ├── line-sdk/            # LINE Messaging API クライアント
│   └── shared/              # 共有型定義
└── package.json`}</CodeBlock>
      </AdminSection>

      {/* 環境構築 */}
      <AdminSection title="環境構築・初期デプロイ" icon="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z">
        <h3 className="text-base font-bold text-gray-900 mb-3">前提条件</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>Node.js 20+ / pnpm</li>
          <li>Cloudflare アカウント (Workers有料プラン推奨)</li>
          <li>Vercel アカウント</li>
          <li>LINE Developers アカウント + Messaging API チャネル</li>
          <li>Anthropic API キー (AI自動返信を使う場合)</li>
        </ul>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">1. リポジトリクローン & 依存関係インストール</h3>
        <CodeBlock>{`git clone https://github.com/your-org/line-harness-oss.git
cd line-harness-oss
pnpm install`}</CodeBlock>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">2. Cloudflare リソース作成</h3>
        <CodeBlock>{`# D1データベース作成
npx wrangler d1 create line-harness

# R2バケット作成
npx wrangler r2 bucket create line-harness-images

# wrangler.toml にD1のdatabase_idを設定`}</CodeBlock>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">3. D1マイグレーション実行</h3>
        <CodeBlock>{`# ローカル実行
npx wrangler d1 execute line-harness --local --file=packages/db/migrations/001_initial.sql
# ... 002〜013まで順番に実行

# リモート実行 (本番)
npx wrangler d1 execute line-harness --remote --file=packages/db/migrations/001_initial.sql
# ... 同様に全マイグレーション`}</CodeBlock>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">4. シークレット設定</h3>
        <CodeBlock>{`# LINE チャネル情報
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ID

# API認証キー (管理画面ログイン用、任意の文字列)
npx wrangler secret put API_KEY

# AI自動返信用 (オプション)
npx wrangler secret put ANTHROPIC_API_KEY`}</CodeBlock>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">5. Worker デプロイ</h3>
        <CodeBlock>{`cd apps/worker
pnpm build
npx wrangler deploy

# デプロイ後のURL例: https://line-harness.your-subdomain.workers.dev`}</CodeBlock>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">6. フロントエンド デプロイ</h3>
        <CodeBlock>{`# .env.local を設定
echo 'NEXT_PUBLIC_API_URL=https://line-harness.your-subdomain.workers.dev' > apps/web/.env.local
echo 'NEXT_PUBLIC_BRAND_NAME=あなたのサービス名' >> apps/web/.env.local

# ビルド
cd apps/web
pnpm build

# Vercelデプロイ
cd out
npx vercel --prod`}</CodeBlock>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">7. LINE Webhook設定</h3>
        <p>LINE Developers Console で以下を設定:</p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li><strong>Webhook URL</strong>: <code className="bg-gray-100 px-2 py-0.5 rounded text-xs">https://your-worker.workers.dev/webhook</code></li>
          <li><strong>Webhook利用</strong>: ON</li>
          <li><strong>応答メッセージ</strong>: OFF (システム側で制御)</li>
          <li><strong>あいさつメッセージ</strong>: OFF (シナリオ配信で代替)</li>
        </ul>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">8. LINEアカウント登録</h3>
        <p>管理画面の「LINEアカウント」から追加するか、bootstrap APIで初期登録:</p>
        <CodeBlock>{`curl -X POST https://your-worker.workers.dev/api/line-accounts/bootstrap \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json"`}</CodeBlock>
      </AdminSection>

      {/* API認証・セキュリティ */}
      <AdminSection title="API認証・セキュリティ" icon="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z">
        <h3 className="text-base font-bold text-gray-900 mb-3">認証方式</h3>
        <p>全APIエンドポイント（/webhook除く）は Bearer トークン認証です。</p>
        <CodeBlock>{`Authorization: Bearer YOUR_API_KEY`}</CodeBlock>
        <p>APIキーは <code className="bg-gray-100 px-2 py-0.5 rounded text-xs">wrangler secret put API_KEY</code> で設定した値です。</p>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">Webhookの署名検証</h3>
        <p>LINE Platformからのwebhookリクエストは、<code className="bg-gray-100 px-2 py-0.5 rounded text-xs">x-line-signature</code> ヘッダーで署名検証されます。Channel Secret を使ったHMAC-SHA256で検証し、改ざんを防止します。</p>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">マルチアカウント認証</h3>
        <p>複数のLINEアカウントを管理する場合、各アカウントの Channel Access Token は D1 の <code className="bg-gray-100 px-2 py-0.5 rounded text-xs">line_accounts</code> テーブルに保存されます。配信・送信時は、該当アカウントのトークンが自動的に使用されます。</p>
        <Warning>Channel Access Token は非常に重要な秘密情報です。DB上では平文保存されるため、D1データベースへのアクセス権限管理を厳重に行ってください。</Warning>
      </AdminSection>

      {/* 主要APIエンドポイント */}
      <AdminSection title="主要APIエンドポイント" icon="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left px-3 py-2 border border-gray-200 font-medium">メソッド</th>
                <th className="text-left px-3 py-2 border border-gray-200 font-medium">パス</th>
                <th className="text-left px-3 py-2 border border-gray-200 font-medium">説明</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono text-green-700">GET</td><td className="px-3 py-1.5 border border-gray-200 font-mono">/api/friends</td><td className="px-3 py-1.5 border border-gray-200">友だち一覧</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono text-green-700">GET</td><td className="px-3 py-1.5 border border-gray-200 font-mono">/api/friends/:id</td><td className="px-3 py-1.5 border border-gray-200">友だち詳細</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono text-blue-700">POST</td><td className="px-3 py-1.5 border border-gray-200 font-mono">/api/friends/:id/tags</td><td className="px-3 py-1.5 border border-gray-200">タグ付与</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono text-green-700">GET</td><td className="px-3 py-1.5 border border-gray-200 font-mono">/api/broadcasts</td><td className="px-3 py-1.5 border border-gray-200">配信一覧</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono text-blue-700">POST</td><td className="px-3 py-1.5 border border-gray-200 font-mono">/api/broadcasts</td><td className="px-3 py-1.5 border border-gray-200">配信作成</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono text-blue-700">POST</td><td className="px-3 py-1.5 border border-gray-200 font-mono">/api/broadcasts/:id/send</td><td className="px-3 py-1.5 border border-gray-200">即時送信</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono text-green-700">GET</td><td className="px-3 py-1.5 border border-gray-200 font-mono">/api/scenarios</td><td className="px-3 py-1.5 border border-gray-200">シナリオ一覧</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono text-blue-700">POST</td><td className="px-3 py-1.5 border border-gray-200 font-mono">/api/scenarios</td><td className="px-3 py-1.5 border border-gray-200">シナリオ作成</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono text-green-700">GET</td><td className="px-3 py-1.5 border border-gray-200 font-mono">/api/chats/:friendId</td><td className="px-3 py-1.5 border border-gray-200">チャット履歴</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono text-blue-700">POST</td><td className="px-3 py-1.5 border border-gray-200 font-mono">/api/chats/:friendId/send</td><td className="px-3 py-1.5 border border-gray-200">メッセージ送信</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono text-green-700">GET</td><td className="px-3 py-1.5 border border-gray-200 font-mono">/api/line-accounts</td><td className="px-3 py-1.5 border border-gray-200">LINEアカウント一覧</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono text-blue-700">POST</td><td className="px-3 py-1.5 border border-gray-200 font-mono">/api/line-accounts</td><td className="px-3 py-1.5 border border-gray-200">アカウント追加</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono text-green-700">GET</td><td className="px-3 py-1.5 border border-gray-200 font-mono">/api/ai-reply/config</td><td className="px-3 py-1.5 border border-gray-200">AI返信設定取得</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono text-orange-700">PUT</td><td className="px-3 py-1.5 border border-gray-200 font-mono">/api/ai-reply/config</td><td className="px-3 py-1.5 border border-gray-200">AI返信設定更新</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono text-blue-700">POST</td><td className="px-3 py-1.5 border border-gray-200 font-mono">/api/ai-reply/test</td><td className="px-3 py-1.5 border border-gray-200">AI返信テスト</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono text-green-700">GET</td><td className="px-3 py-1.5 border border-gray-200 font-mono">/api/health</td><td className="px-3 py-1.5 border border-gray-200">ヘルスチェック</td></tr>
            </tbody>
          </table>
        </div>
        <Tip>全エンドポイントは <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">?lineAccountId=xxx</code> クエリパラメータでアカウント別フィルタが可能です。</Tip>
      </AdminSection>

      {/* D1データベース */}
      <AdminSection title="D1データベーススキーマ" icon="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4">
        <h3 className="text-base font-bold text-gray-900 mb-3">主要テーブル</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left px-3 py-2 border border-gray-200 font-medium">テーブル</th>
                <th className="text-left px-3 py-2 border border-gray-200 font-medium">用途</th>
                <th className="text-left px-3 py-2 border border-gray-200 font-medium">主要カラム</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono">friends</td><td className="px-3 py-1.5 border border-gray-200">LINE友だち</td><td className="px-3 py-1.5 border border-gray-200">line_user_id, display_name, is_following, line_account_id</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono">tags</td><td className="px-3 py-1.5 border border-gray-200">タグ定義</td><td className="px-3 py-1.5 border border-gray-200">name</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono">friend_tags</td><td className="px-3 py-1.5 border border-gray-200">友だち×タグ</td><td className="px-3 py-1.5 border border-gray-200">friend_id, tag_id</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono">messages_log</td><td className="px-3 py-1.5 border border-gray-200">メッセージ履歴</td><td className="px-3 py-1.5 border border-gray-200">friend_id, direction, content, broadcast_id</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono">broadcasts</td><td className="px-3 py-1.5 border border-gray-200">一斉配信</td><td className="px-3 py-1.5 border border-gray-200">title, message_type, status, line_account_id</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono">scenarios</td><td className="px-3 py-1.5 border border-gray-200">シナリオ</td><td className="px-3 py-1.5 border border-gray-200">name, trigger_type, is_active</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono">scenario_steps</td><td className="px-3 py-1.5 border border-gray-200">シナリオステップ</td><td className="px-3 py-1.5 border border-gray-200">scenario_id, step_order, delay_minutes</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono">line_accounts</td><td className="px-3 py-1.5 border border-gray-200">LINEアカウント</td><td className="px-3 py-1.5 border border-gray-200">channel_id, channel_access_token, channel_secret</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono">keyword_rules</td><td className="px-3 py-1.5 border border-gray-200">キーワード自動応答</td><td className="px-3 py-1.5 border border-gray-200">keyword, match_type, reply_content</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono">ai_reply_config</td><td className="px-3 py-1.5 border border-gray-200">AI返信設定</td><td className="px-3 py-1.5 border border-gray-200">is_enabled, system_prompt, delay_min/max</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono">ai_reply_queue</td><td className="px-3 py-1.5 border border-gray-200">AI返信キュー</td><td className="px-3 py-1.5 border border-gray-200">friend_id, ai_response, scheduled_send_at, status</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono">scoring_rules</td><td className="px-3 py-1.5 border border-gray-200">スコアリングルール</td><td className="px-3 py-1.5 border border-gray-200">event_type, score_value</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200 font-mono">automations</td><td className="px-3 py-1.5 border border-gray-200">オートメーション</td><td className="px-3 py-1.5 border border-gray-200">trigger_type, conditions, actions</td></tr>
            </tbody>
          </table>
        </div>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">マイグレーション一覧</h3>
        <CodeBlock>{`packages/db/migrations/
├── 001_initial.sql          # friends, tags, messages_log 等
├── 002_broadcasts.sql       # broadcasts テーブル
├── 003_scenarios.sql        # scenarios, scenario_steps
├── 004_keyword_rules.sql    # キーワード自動応答
├── 005_scoring.sql          # スコアリング
├── 006_automations.sql      # オートメーション
├── 007_staff.sql            # スタッフ管理
├── 008_line_accounts.sql    # マルチアカウント
├── 009_users.sql            # UUID管理
├── 010_reminders.sql        # リマインダ
├── 011_notifications.sql    # 通知ルール
├── 012_conversions.sql      # CV計測
└── 013_ai_reply.sql         # AI自動返信`}</CodeBlock>
      </AdminSection>

      {/* Webhook処理フロー */}
      <AdminSection title="Webhook処理フロー" icon="M13 10V3L4 14h7v7l9-11h-7z">
        <p>友だちがLINEでメッセージを送信すると、以下のフローで処理されます:</p>
        <CodeBlock>{`1. LINE Platform → POST /webhook (署名検証)
2. イベント種別に応じた処理:
   ├─ follow      → 友だち登録 + welcomeシナリオ起動
   ├─ unfollow    → is_following=0 に更新
   ├─ message     → messages_log に記録
   │  ├─ キーワードルールにマッチ → 自動応答返信
   │  └─ マッチしない場合:
   │     ├─ AI自動返信が有効 → AI生成 → キューに投入
   │     └─ 無効 → 何もしない (管理画面のチャットで手動返信)
   ├─ postback    → フォーム回答/ボタンタップ処理
   └─ その他      → ログ記録のみ

3. スコアリングイベント発火
4. オートメーション条件チェック・実行
5. 200 OK を即返却 (重い処理は waitUntil で非同期)`}</CodeBlock>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">AI自動返信フロー</h3>
        <CodeBlock>{`1. メッセージ受信 (キーワードルール不一致)
2. ai_reply_config を確認 → is_enabled=0 ならスキップ
3. 同一友だちのpendingキューをキャンセル (連続メッセージ対策)
4. messages_log から直近N件の会話履歴取得
5. Claude API 呼び出し (system_prompt + 会話履歴)
6. ai_reply_queue に INSERT (scheduled_send_at = now + 10〜30分ランダム)
7. Cron (5分毎) が送信時刻到来分を処理:
   ├─ タイピング表示 → 数秒待機 → pushMessage
   ├─ messages_log に記録
   └─ status を 'sent' に更新`}</CodeBlock>
      </AdminSection>

      {/* ホワイトラベル・ブランディング */}
      <AdminSection title="ホワイトラベル設定" icon="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01">
        <p>管理画面のブランド名を自由に変更できます。</p>
        <CodeBlock title="apps/web/.env.local">{`NEXT_PUBLIC_BRAND_NAME=あなたのサービス名
NEXT_PUBLIC_API_URL=https://your-worker.workers.dev`}</CodeBlock>
        <p className="mt-3"><code className="bg-gray-100 px-2 py-0.5 rounded text-xs">NEXT_PUBLIC_BRAND_NAME</code> を設定すると、ログイン画面・サイドバー・マニュアル等の全箇所でサービス名が変更されます。</p>
        <Tip>ビルド時に環境変数が埋め込まれるため、変更後は <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">pnpm build</code> → <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">vercel --prod</code> で再デプロイが必要です。</Tip>
      </AdminSection>

      {/* トラブルシューティング */}
      <AdminSection title="トラブルシューティング" icon="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z">
        <h3 className="text-base font-bold text-gray-900 mb-3">よくある問題</h3>

        <div className="space-y-6">
          <div>
            <h4 className="text-sm font-bold text-gray-800 mb-2">管理画面にログインできない</h4>
            <ul className="list-disc pl-5 space-y-1">
              <li>APIキーが正しいか確認: <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">wrangler secret list</code></li>
              <li><code className="bg-gray-100 px-1 py-0.5 rounded text-xs">NEXT_PUBLIC_API_URL</code> がWorkerのURLと一致しているか確認</li>
              <li>Workerが正常にデプロイされているか: <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">curl https://your-worker/api/health</code></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-bold text-gray-800 mb-2">配信してもメッセージが届かない</h4>
            <ul className="list-disc pl-5 space-y-1">
              <li>LINEアカウントが管理画面に登録されているか確認</li>
              <li>Channel Access Token が有効か確認（LINE Developers Consoleで再発行可能）</li>
              <li>友だちが<code className="bg-gray-100 px-1 py-0.5 rounded text-xs">is_following=1</code>か確認</li>
              <li>Workerログ確認: <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">npx wrangler tail</code></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-bold text-gray-800 mb-2">Webhookが動作しない</h4>
            <ul className="list-disc pl-5 space-y-1">
              <li>LINE Developers ConsoleのWebhook URLが正しいか確認</li>
              <li>「Webhook利用」がONになっているか確認</li>
              <li>Channel Secret が正しく設定されているか</li>
              <li><code className="bg-gray-100 px-1 py-0.5 rounded text-xs">npx wrangler tail</code> でリアルタイムログを確認</li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-bold text-gray-800 mb-2">AI自動返信が動かない</h4>
            <ul className="list-disc pl-5 space-y-1">
              <li><code className="bg-gray-100 px-1 py-0.5 rounded text-xs">ANTHROPIC_API_KEY</code> が設定されているか確認</li>
              <li>管理画面のAI自動返信設定で「有効」になっているか確認</li>
              <li>Cronが動いているか: デプロイ後のtriggersに <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">schedule: */5 * * * *</code> があるか</li>
              <li>ai_reply_queueテーブルにpendingレコードがあるか確認</li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-bold text-gray-800 mb-2">ページが404になる (Vercel)</h4>
            <ul className="list-disc pl-5 space-y-1">
              <li><code className="bg-gray-100 px-1 py-0.5 rounded text-xs">out/vercel.json</code> に <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">{`{"cleanUrls": true}`}</code> があるか確認</li>
              <li>ビルドスクリプトが <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">next build && cp vercel.deploy.json out/vercel.json</code> になっているか</li>
            </ul>
          </div>
        </div>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">デバッグコマンド</h3>
        <CodeBlock>{`# Workerのリアルタイムログ
npx wrangler tail

# D1データベースに直接クエリ
npx wrangler d1 execute line-harness --remote --command "SELECT count(*) FROM friends"

# ヘルスチェック
curl -H "Authorization: Bearer YOUR_API_KEY" https://your-worker/api/health`}</CodeBlock>
      </AdminSection>

      {/* 運用・メンテナンス */}
      <AdminSection title="運用・メンテナンス" icon="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15">
        <h3 className="text-base font-bold text-gray-900 mb-3">デプロイ手順</h3>
        <CodeBlock>{`# Worker (バックエンド)
cd apps/worker && pnpm build && npx wrangler deploy

# フロントエンド
cd apps/web && pnpm build && cd out && npx vercel --prod --yes`}</CodeBlock>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">新しいマイグレーション適用</h3>
        <CodeBlock>{`npx wrangler d1 execute line-harness --remote --file=packages/db/migrations/NNN_xxx.sql`}</CodeBlock>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">バックアップ</h3>
        <p>D1はCloudflareが自動バックアップを管理します。手動エクスポートが必要な場合:</p>
        <CodeBlock>{`npx wrangler d1 export line-harness --remote --output=backup.sql`}</CodeBlock>

        <h3 className="text-base font-bold text-gray-900 mt-6 mb-3">LINE APIの制限</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left px-3 py-2 border border-gray-200 font-medium">項目</th>
                <th className="text-left px-3 py-2 border border-gray-200 font-medium">制限</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="px-3 py-1.5 border border-gray-200">無料メッセージ数</td><td className="px-3 py-1.5 border border-gray-200">月200通 (ライトプラン: 5,000通)</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200">multicast 1リクエスト</td><td className="px-3 py-1.5 border border-gray-200">最大500ユーザー</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200">pushMessage</td><td className="px-3 py-1.5 border border-gray-200">1リクエスト1ユーザー</td></tr>
              <tr><td className="px-3 py-1.5 border border-gray-200">Rate Limit</td><td className="px-3 py-1.5 border border-gray-200">100,000 req/min</td></tr>
            </tbody>
          </table>
        </div>
        <Warning>無料プランは月200通までです。一斉配信時はカウントに注意してください。ステルス機能（バッチ分割・遅延）はRate Limitとスパム検知を回避するための仕組みです。</Warning>
      </AdminSection>
    </div>
  )
}
