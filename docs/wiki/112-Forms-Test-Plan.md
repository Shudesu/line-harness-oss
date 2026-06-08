# 112. Forms Test Plan

## 目的

フォーム機能は「フォーム作成」「LIFF公開URL」「画像表示」「回答保存」「回答集計」がつながって初めて価値が出る。`console-v2` と `/form-submissions` で別実装になると壊れやすいため、フォーム管理UIは `/form-submissions` の実装を再利用する。

## 関数テスト

対象: `apps/web/src/lib/form-manager-utils.ts`

- `buildFormUrl`
  - LIFF URLが空なら `/?page=form&id=...` を返す。
  - 通常のLIFF URLなら `?page=form&id=...` を付ける。
  - 既存クエリがあるURLなら `&page=form&id=...` を付ける。
  - `formId` は URL encode する。
- `normalizeFormFields`
  - 配列はそのまま返す。
  - JSON文字列は配列へ復元する。
  - 不正JSONは空配列にする。
- `parseFormOptions`
  - 改行・カンマ区切りを選択肢配列にする。
  - 空白と空行は除外する。
- `slugFieldName`
  - 識別名を安全な `snake_case` 風に寄せる。
  - 空文字なら fallback を使う。

## API/DBテスト

対象: Worker `/api/forms` と D1

- `POST /api/forms`
  - name必須。
  - text/email/tel/textarea/select/radio/checkbox/date/image を保存できる。
  - `type=image` は表示専用として保存できる。
- `PUT /api/forms/:id`
  - フィールド編集、受付停止、説明文更新ができる。
  - 未指定フィールドを勝手に `null` にしない。
- `POST /api/forms/:id/submit`
  - required の入力フィールドが空なら 400。
  - checkbox/radio の required を正しく検証する。
  - `type=image` は required チェック対象外。
  - `type=image` は回答データに含まれない。
  - 回答後に `form_submissions` と `forms.submit_count` が更新される。

## UIテスト

対象: `/form-submissions` と `console-v2` フォームタブ

- `/form-submissions` でフォームを作成できる。
- 画像をR2へアップロードし、プレビューに表示できる。
- 作成後に公開URLをコピーできる。
- 回答集計タブで回答が表示される。
- `console-v2` のフォームタブでも同じフォーム管理画面が表示される。

## 運用確認

- LIFF URLは実装上 `?page=form&id={FORM_ID}` を使う。
- LINE Developers のLIFF Endpoint URLにクエリがある場合も、管理画面のURL生成で壊れない。
- 画像URLはR2の `/images/:key` 公開URLを使う。
