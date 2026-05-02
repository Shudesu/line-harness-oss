---
chapter: 2
title: セットアップ
tier: free
status: placeholder
---

# 第2章 セットアップ

> 【tier: 無料】`npx create-line-harness` から LIFF 設定、Mac Mini での複アカ運用までを一気通貫で立ち上げる。

## 章の目的

- `npx create-line-harness` でゼロから自分の LINE Harness を稼働させられる
- LIFF / LINE Login / Messaging API の役割の違いを区別して設定できる
- 1 台の Mac Mini で複数アカウントを安全に運用するためのディレクトリ構成と環境変数分離を理解する

## 想定読者

- 自分の LINE 公式アカウントをこれから動かす個人事業主・運用担当
- 複数のクライアント LINE を 1 台のマシンから運用したい代行・JV 事業者

## 目次

- 2.1 必要なアカウント・トークンの棚卸し
- 2.2 `npx create-line-harness` ワンコマンド起動
- 2.3 Cloudflare Workers / D1 / Pages の紐付け
- 2.4 LIFF と LINE Login の設定（QR は LIFF URL を使う）
- 2.5 Mac Mini で複アカウント運用するときのディレクトリ・環境変数分離

## 前提

- 第 1 章を読み終えている
- LINE Developers コンソールにアクセスできる
- Cloudflare アカウント（OAuth 連携済み）を持っている

## 次の章

第 3 章では、立ち上がった LINE Harness で「友だち管理 / 配信 / 自動応答 / リッチメニュー」の 4 つの基本機能を回します。

---
*このファイルはプレースホルダーです。本文は別セッションで執筆します。*
