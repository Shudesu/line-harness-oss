-- Phase 2-D Codex 指摘 P1 修正: stripe_price_id を一意化
--
-- 同じ price_id を複数の商品レコードに登録すると、webhook 経由の購入後アクション解決で
-- どの product に当たるかが不定になる。データ整合性のため UNIQUE 化する。
--
-- 既に重複が入ってる可能性に備えて、CREATE UNIQUE INDEX のみで対応 (失敗したら手動修正)。

CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_products_price_id
  ON stripe_products (stripe_price_id);

-- Phase 2-D Codex 指摘 P1 修正: stripe_purchases の冪等性
-- webhook 再送時に同じ event_id で重複作成しないよう unique
CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_purchases_event_id
  ON stripe_purchases (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;
