import { HarnessPreviewDashboard } from '@/components/ui/harness-preview'

export default function UiPreviewPage() {
  return (
    <HarnessPreviewDashboard
      product="LINE"
      brandColor="#06c755"
      description="LINE公式アカウントの運用状況をひと目で確認できます。"
      navItems={['ダッシュボード', '友だち', 'メッセージ', '自動応答', 'シナリオ', '分析', '設定']}
      metrics={[
        { title: '友だち', value: 2842, subtitle: '前月比 +12.4%', accentColor: '#06c755', icon: '友' },
        { title: '配信済み', value: 12840, subtitle: '今月の合計', accentColor: '#2563eb', icon: '配' },
        { title: 'チャット', value: 186, subtitle: '未対応 12件', accentColor: '#7c3aed', icon: '話' },
        { title: 'コンバージョン', value: 94, subtitle: 'CV率 3.3%', accentColor: '#ea580c', icon: 'CV' },
      ]}
    />
  )
}
