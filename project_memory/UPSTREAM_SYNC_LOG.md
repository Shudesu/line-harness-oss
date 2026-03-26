# Upstream Sync Log

upstream (Shudesu/line-harness-oss) の動向確認記録。
毎日1回以上 `project_memory/scripts/check-upstream.sh` を実行して記録すること。

---

## 2026-03-25 (初回記録)

upstream 直近10コミット:
```
66f1389 sync: delivery_type tracking, push-only stats
84a4ca9 chore: add sync script + clean remaining secrets
44b94c3 chore: clean root directory again
19d2acd sync: cross-account trigger, CTA simplify, keyword fix, form fixes
0d8a4b7 Merge pull request #45 from sogadaiki/feat/token-auto-refresh
2f006c4 Merge pull request #44 from sogadaiki/fix/sync-schema-with-migrations
3a61710 docs: move LINE demo link to top with blockquote highlight
79cec2c feat: auto-refresh LINE channel access tokens before expiry
6b9778f fix: sync schema.sql with migrations 003-008
f8f1ca5 chore: move more files out of root
```

開発方向性: マルチアカウント対応・配信統計・リファラートラッキングに注力中。
バグ修正PR (#46: score_threshold) を提出済み。maintainer からレビュー予告あり。
