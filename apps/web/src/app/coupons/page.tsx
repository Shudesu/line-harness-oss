'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'

interface Coupon {
  id: string
  name: string
  description: string | null
  code: string
  discount_type: 'fixed' | 'percentage'
  discount_value: number
  max_claims: number | null
  expires_at: string | null
  is_active: number
  line_account_id: string | null
  created_at: string
  updated_at: string
  claim_count: number
  redeem_count: number
}

interface CouponClaim {
  id: string
  coupon_id: string
  friend_id: string
  friend_name?: string
  claimed_at: string
  redeemed_at: string | null
}

function generateCode(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export default function CouponsPage() {
  const { selectedAccount } = useAccount()
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Form state
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formCode, setFormCode] = useState('')
  const [formDiscountType, setFormDiscountType] = useState<'fixed' | 'percentage'>('fixed')
  const [formDiscountValue, setFormDiscountValue] = useState(0)
  const [formMaxClaims, setFormMaxClaims] = useState<string>('')
  const [formExpiresAt, setFormExpiresAt] = useState('')

  // Claims viewer
  const [viewingClaims, setViewingClaims] = useState<string | null>(null)
  const [claims, setClaims] = useState<CouponClaim[]>([])
  const [loadingClaims, setLoadingClaims] = useState(false)

  const accountQuery = selectedAccount?.id ? `lineAccountId=${selectedAccount.id}` : ''

  const loadCoupons = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: Coupon[] }>(`/api/coupons?${accountQuery}`)
      setCoupons(res.data || [])
    } catch (err) {
      console.error('Failed to load coupons:', err)
    } finally {
      setLoading(false)
    }
  }, [accountQuery])

  useEffect(() => { loadCoupons() }, [loadCoupons])

  const resetForm = () => {
    setFormName('')
    setFormDescription('')
    setFormCode('')
    setFormDiscountType('fixed')
    setFormDiscountValue(0)
    setFormMaxClaims('')
    setFormExpiresAt('')
    setEditingId(null)
    setShowForm(false)
  }

  const startCreate = () => {
    resetForm()
    setFormCode(generateCode())
    setShowForm(true)
  }

  const startEdit = (coupon: Coupon) => {
    setEditingId(coupon.id)
    setFormName(coupon.name)
    setFormDescription(coupon.description || '')
    setFormCode(coupon.code)
    setFormDiscountType(coupon.discount_type)
    setFormDiscountValue(coupon.discount_value)
    setFormMaxClaims(coupon.max_claims?.toString() || '')
    setFormExpiresAt(coupon.expires_at || '')
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!formName.trim() || !formCode.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: formName,
        description: formDescription || undefined,
        code: formCode,
        discountType: formDiscountType,
        discountValue: formDiscountValue,
        maxClaims: formMaxClaims ? parseInt(formMaxClaims) : undefined,
        expiresAt: formExpiresAt || undefined,
        lineAccountId: selectedAccount?.id || undefined,
      }
      if (editingId) {
        await fetchApi(`/api/coupons/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
      } else {
        await fetchApi('/api/coupons', { method: 'POST', body: JSON.stringify(payload) })
      }
      resetForm()
      loadCoupons()
    } catch (err) {
      console.error('Failed to save coupon:', err)
      alert('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このクーポンを削除しますか？取得済みのクレーム情報も削除されます。')) return
    try {
      await fetchApi(`/api/coupons/${id}`, { method: 'DELETE' })
      loadCoupons()
    } catch (err) {
      console.error('Failed to delete coupon:', err)
    }
  }

  const handleToggleActive = async (coupon: Coupon) => {
    try {
      await fetchApi(`/api/coupons/${coupon.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !coupon.is_active }),
      })
      loadCoupons()
    } catch (err) {
      console.error('Failed to toggle coupon:', err)
    }
  }

  const loadClaims = async (couponId: string) => {
    setViewingClaims(couponId)
    setLoadingClaims(true)
    try {
      const res = await fetchApi<{ success: boolean; data: CouponClaim[] }>(`/api/coupons/${couponId}/claims`)
      setClaims(res.data || [])
    } catch (err) {
      console.error('Failed to load claims:', err)
    } finally {
      setLoadingClaims(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Header title="クーポン管理" description="割引クーポンの作成・配布・利用状況を管理" />

      <div className="flex-1 overflow-y-auto p-6">
        {/* Create / Edit form */}
        {showForm && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              {editingId ? 'クーポンを編集' : '新規クーポン作成'}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">クーポン名</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="例: 初回10%OFFクーポン"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  クーポンコード
                  <button
                    type="button"
                    onClick={() => setFormCode(generateCode())}
                    className="ml-2 text-xs text-green-600 hover:text-green-700"
                  >
                    自動生成
                  </button>
                </label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="SAVE10"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">割引タイプ</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={formDiscountType}
                  onChange={(e) => setFormDiscountType(e.target.value as 'fixed' | 'percentage')}
                >
                  <option value="fixed">固定額（円）</option>
                  <option value="percentage">割引率（%）</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  割引値 {formDiscountType === 'fixed' ? '（円）' : '（%）'}
                </label>
                <input
                  type="number"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={formDiscountValue}
                  onChange={(e) => setFormDiscountValue(Number(e.target.value))}
                  min={0}
                  max={formDiscountType === 'percentage' ? 100 : undefined}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">上限枚数（空欄=無制限）</label>
                <input
                  type="number"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="無制限"
                  value={formMaxClaims}
                  onChange={(e) => setFormMaxClaims(e.target.value)}
                  min={1}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">有効期限（空欄=無期限）</label>
                <input
                  type="datetime-local"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={formExpiresAt}
                  onChange={(e) => setFormExpiresAt(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">説明（任意）</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="クーポンの説明"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-4">
              <button
                onClick={handleSave}
                disabled={saving || !formName.trim() || !formCode.trim()}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? '保存中...' : editingId ? '更新' : '作成'}
              </button>
              <button
                onClick={resetForm}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}

        {/* Action bar */}
        {!showForm && (
          <div className="flex justify-end mb-4">
            <button
              onClick={startCreate}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
            >
              + 新規クーポン
            </button>
          </div>
        )}

        {/* Coupon list */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">読み込み中...</div>
        ) : coupons.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg mb-2">クーポンがありません</p>
            <p className="text-sm">割引クーポンを作成して友だちに配布しましょう</p>
          </div>
        ) : (
          <div className="space-y-3">
            {coupons.map((coupon) => {
              const isExpired = coupon.expires_at && new Date(coupon.expires_at) < new Date()
              const isViewingClaims = viewingClaims === coupon.id

              return (
                <div key={coupon.id} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-base font-bold text-gray-900">{coupon.name}</h3>
                        {!coupon.is_active && (
                          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">無効</span>
                        )}
                        {isExpired && (
                          <span className="px-2 py-0.5 text-xs bg-red-100 text-red-600 rounded">期限切れ</span>
                        )}
                      </div>
                      {coupon.description && (
                        <p className="text-sm text-gray-500">{coupon.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-sm">
                        <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-700">{coupon.code}</span>
                        <span className="text-green-600 font-medium">
                          {coupon.discount_type === 'fixed'
                            ? `¥${coupon.discount_value.toLocaleString()} OFF`
                            : `${coupon.discount_value}% OFF`}
                        </span>
                        {coupon.max_claims && (
                          <span className="text-gray-500">上限: {coupon.max_claims}枚</span>
                        )}
                        {coupon.expires_at && (
                          <span className="text-gray-500">
                            期限: {new Date(coupon.expires_at).toLocaleDateString('ja-JP')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                        <span>取得: {coupon.claim_count}件</span>
                        <span>使用: {coupon.redeem_count}件</span>
                        <span>作成: {new Date(coupon.created_at).toLocaleDateString('ja-JP')}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={() => isViewingClaims ? setViewingClaims(null) : loadClaims(coupon.id)}
                        className="px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
                      >
                        {isViewingClaims ? '閉じる' : '取得者'}
                      </button>
                      <button
                        onClick={() => handleToggleActive(coupon)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                          coupon.is_active
                            ? 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100'
                            : 'bg-green-50 text-green-600 hover:bg-green-100'
                        }`}
                      >
                        {coupon.is_active ? '無効化' : '有効化'}
                      </button>
                      <button
                        onClick={() => startEdit(coupon)}
                        className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => handleDelete(coupon.id)}
                        className="px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 rounded-lg"
                      >
                        削除
                      </button>
                    </div>
                  </div>

                  {/* Claims list */}
                  {isViewingClaims && (
                    <div className="mt-4 border-t border-gray-100 pt-3">
                      {loadingClaims ? (
                        <p className="text-sm text-gray-400">読み込み中...</p>
                      ) : claims.length === 0 ? (
                        <p className="text-sm text-gray-400">まだ取得者がいません</p>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-gray-500 mb-2">取得者一覧（{claims.length}件）</p>
                          {claims.map((claim) => (
                            <div key={claim.id} className="flex items-center justify-between text-sm py-1">
                              <span className="text-gray-700">{claim.friend_name || claim.friend_id}</span>
                              <div className="flex items-center gap-3 text-xs text-gray-400">
                                <span>取得: {new Date(claim.claimed_at).toLocaleString('ja-JP')}</span>
                                {claim.redeemed_at ? (
                                  <span className="text-green-600">使用済 {new Date(claim.redeemed_at).toLocaleString('ja-JP')}</span>
                                ) : (
                                  <span className="text-yellow-500">未使用</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
