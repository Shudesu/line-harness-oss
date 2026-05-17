import { describe, expect, it } from 'vitest';
import { parseJalanMail } from './jalan-mail-parser.js';

describe('parseJalanMail', () => {
  it('parses Jalan created mail with nested people labels and price details', () => {
    const rawText = `
差出人: reservation@activityboard.jp
日時: 2026年5月16日 13:16:01 JST
件名: 【予約確定】じゃらんnet遊び・体験予約_予約確定通知

アオニサイファームブルーベリー観光農園  予約担当者様

予約が確定しました。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▲ 予約内容
予約番号：3009LQBDA
利用日時：2026/06/14(日) 12:00〜13:00
プラン名：☆2026年☆【ブルーベリー食べ放題・1パックお土産付】茨城県つくば市♪最大23種の中から食べ比べ！ワンちゃん連れOK！ファミリー・女性・カップルに◎！
人数：4名  (大人(中学生〜):2名、小学生:0名、幼児(4歳〜):1名、3歳以下:1名)
支払方法：現地払い
合計料金(税込)：5,100円
ポイント利用額：1,000ポイント
クーポン利用額：0円
■カスタマへの請求額■  4,100円

体験者氏名：澤幡  諭志(サワハタ　サトシ)様
メールアドレス：sawawa3104@gmail.com
電話番号：09071836190
当日緊急連絡先：09071836190
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    expect(parseJalanMail(rawText)).toEqual({
      eventType: 'created',
      externalId: '3009LQBDA',
      reservationDate: '2026-06-14',
      startTime: '12:00',
      endTime: '13:00',
      totalPeople: 4,
      adultCount: 2,
      childCount: 0,
      infantCount: 1,
      underThreeCount: 1,
      customerName: '澤幡 諭志',
      customerPhone: '09071836190',
      customerEmail: 'sawawa3104@gmail.com',
      planName: '☆2026年☆【ブルーベリー食べ放題・1パックお土産付】茨城県つくば市♪最大23種の中から食べ比べ！ワンちゃん連れOK！ファミリー・女性・カップルに◎！',
      totalAmount: 5100,
      pointAmount: 1000,
      couponAmount: 0,
      customerChargeAmount: 4100,
    });
  });

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
      underThreeCount: 0,
      customerName: '金 龍泰',
      customerPhone: '09092806551',
      customerEmail: 'zerotoall1998@gmail.com',
      planName: '☆2026年☆【ブルーベリー食べ放題・1パックお土産付】茨城県つくば市♪最大23種の中から食べ比べ！ワンちゃん連れOK！ファミリー・女性・カップルに◎！',
      totalAmount: 7400,
      pointAmount: 0,
      couponAmount: 0,
      customerChargeAmount: 7400,
    });
  });
});
