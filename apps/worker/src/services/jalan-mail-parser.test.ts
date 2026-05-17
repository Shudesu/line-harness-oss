import { describe, expect, it } from 'vitest';
import { parseJalanMail } from './jalan-mail-parser.js';

describe('parseJalanMail', () => {
  it('parses Jalan cancellation mail and marks it cancelled', () => {
    const rawText = `
From: <reservation_cancel@activityboard.jp>
Date: 2026年5月17日(日) 11:59
Subject: 【予約キャンセル】じゃらんnet遊び・体験予約_予約キャンセル通知
To: <aonisaiaoki@gmail.com>

アオニサイファームブルーベリー観光農園  予約担当者様

予約がキャンセルされました。
ご確認をお願いいたします。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▲ 予約内容
予約番号：30S0G7SJC
利用日時：2026/06/13(土) 09:00～10:00
プラン名：☆2026年☆【ブルーベリー食べ放題・1パックお土産付】茨城県つくば市♪最大23種の中から食べ比べ！ワンちゃん連れOK！ファミリー・女性・カップルに◎！
人数：4名  (大人(中学生～):2名、小学生:2名、幼児(4歳～):0名、3歳以下:0名)
支払方法：現地払い
合計料金(税込)：7,400円
ポイント利用額：0ポイント
クーポン利用額：0円
■カスタマへの請求額■  7,400円

体験者氏名：金  龍泰(キム　ヨンテ)様
メールアドレス：zerotoall1998@gmail.com
電話番号：09092806551
当日緊急連絡先：09092806551
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    expect(parseJalanMail(rawText)).toEqual({
      eventType: 'cancelled',
      externalId: '30S0G7SJC',
      reservationDate: '2026-06-13',
      startTime: '09:00',
      endTime: '10:00',
      totalPeople: 4,
      adultCount: 2,
      childCount: 2,
      infantCount: 0,
      customerName: '金 龍泰',
      customerPhone: '09092806551',
      customerEmail: 'zerotoall1998@gmail.com',
      planName: '☆2026年☆【ブルーベリー食べ放題・1パックお土産付】茨城県つくば市♪最大23種の中から食べ比べ！ワンちゃん連れOK！ファミリー・女性・カップルに◎！',
      totalAmount: 7400,
    });
  });
});
