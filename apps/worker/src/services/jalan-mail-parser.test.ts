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

  it('parses low remaining capacity created mail as created, not updated', () => {
    const rawText = `
アオニサイファームブルーベリー観光農園  予約担当者様

予約が確定しました。
ご確認をお願いいたします。

予約内容の確認はこちら
https://acb.jalan.net/gw/kanri/slogin.html?state=4YUBarOyaXFuT2rM+AiJOw==

※今回予約が入ったプランの予約枠は、以下となりました。
【残3人】
↓↓↓
残数0になると即時予約の受付ができなくなります。
当該日時において追加の受け入れが可能な場合は、受付制限数をご変更ください。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▲ 予約内容
予約番号：31M8Y7YR6

利用日時：2026/06/14(日) 11:00～12:00
プラン名：☆2026年☆【ブルーベリー食べ放題・1パックお土産付】茨城県つくば市♪最大23種の中から食べ比べ！ワンちゃん連れOK！ファミリー・女性・カップルに◎！
人数：4名  (大人(中学生～):1名、小学生:1名、幼児(4歳～):1名、3歳以下:1名)
支払方法：現地払い
合計料金(税込)：4,400円
ポイント利用額：200ポイント

クーポン利用額：0円
※クーポン利用最低金額：0円
（クーポン利用無し）
■カスタマへの請求額■  4,200円

体験者氏名：前田  麻衣(マエダ　マイ)様
メールアドレス：maimaimai9101@gmail.com
電話番号：08041162912
当日緊急連絡先：08041162912
`;

    const parsed = parseJalanMail(rawText);
    expect(parsed.eventType).toBe('created');
    expect(parsed.externalId).toBe('31M8Y7YR6');
    expect(parsed.reservationDate).toBe('2026-06-14');
    expect(parsed.startTime).toBe('11:00');
    expect(parsed.endTime).toBe('12:00');
    expect(parsed.adultCount).toBe(1);
    expect(parsed.childCount).toBe(1);
    expect(parsed.infantCount).toBe(1);
    expect(parsed.underThreeCount).toBe(1);
    expect(parsed.customerName).toBe('前田 麻衣');
    expect(parsed.totalAmount).toBe(4400);
    expect(parsed.pointAmount).toBe(200);
    expect(parsed.couponAmount).toBe(0);
    expect(parsed.customerChargeAmount).toBe(4200);
  });

  it('parses sold-out capacity warning created mail as created, not updated', () => {
    const rawText = `
アオニサイファームブルーベリー観光農園  予約担当者様

予約が確定しました。
ご確認をお願いいたします。

予約内容の確認はこちら
https://acb.jalan.net/gw/kanri/slogin.html?state=z0Ik21paqsLAulAGNdqKhw==

■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
※今回予約が入ったプランの予約枠は、以下となりました。
【残0人】
↓↓↓
残数0となったため即時予約の受付を停止しました。
当該日時において追加の受け入れが可能な場合は、受付制限数をご変更ください。
■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▲ 予約内容
予約番号：31D2J1S5N
利用日時：2026/06/13(土) 10:00～11:00

プラン名：☆2026年☆【ブルーベリー食べ放題・1パックお土産付】茨城県つくば市♪最大23種の中から食べ比べ！ワンちゃん連れOK！ファミリー・女性・カップルに◎！
人数：4名  (大人(中学生～):2名、小学生:1名、幼児(4歳～):1名、3歳以下:0名)
支払方法：現地払い
合計料金(税込)：6,600円
ポイント利用額：6,600ポイント

クーポン利用額：0円
※クーポン利用最低金額：0円
（クーポン利用無し）
■カスタマへの請求額■  0円

体験者氏名：佐藤  賢治(サトウ　ケンジ)様
メールアドレス：ks964219@yahoo.co.jp
電話番号：09057949751
当日緊急連絡先：09057949751
`;

    const parsed = parseJalanMail(rawText);
    expect(parsed.eventType).toBe('created');
    expect(parsed.externalId).toBe('31D2J1S5N');
    expect(parsed.reservationDate).toBe('2026-06-13');
    expect(parsed.startTime).toBe('10:00');
    expect(parsed.endTime).toBe('11:00');
    expect(parsed.adultCount).toBe(2);
    expect(parsed.childCount).toBe(1);
    expect(parsed.infantCount).toBe(1);
    expect(parsed.underThreeCount).toBe(0);
    expect(parsed.customerName).toBe('佐藤 賢治');
    expect(parsed.totalAmount).toBe(6600);
    expect(parsed.pointAmount).toBe(6600);
    expect(parsed.couponAmount).toBe(0);
    expect(parsed.customerChargeAmount).toBe(0);
  });
});
