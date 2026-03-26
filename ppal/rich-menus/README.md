# PPAL リッチメニュー

このディレクトリにはPPAL固有のリッチメニュー設定を格納します。

## 登録スクリプト

| スクリプト | 説明 |
|-----------|------|
| `../scripts/register-ppal-rich-menus.sh` | リッチメニュー登録（v1） |
| `../scripts/register-ppal-rich-menus-v2.sh` | リッチメニュー登録（v2） |

## 実行方法

```bash
cd ppal/scripts
bash register-ppal-rich-menus-v2.sh
```

## メニュー構成

- **Guest メニュー**: 未購入ユーザー向け
- **Member メニュー**: 購入済みユーザー向け（`sts:購入済み` タグ付与時に自動切替）

詳細は `../README.md` を参照してください。
