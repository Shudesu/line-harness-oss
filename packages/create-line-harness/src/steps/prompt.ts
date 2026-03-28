import * as p from "@clack/prompts";

interface LineCredentials {
  lineChannelId: string;
  lineChannelAccessToken: string;
  lineChannelSecret: string;
  lineLoginChannelId: string;
}

export async function promptLineCredentials(): Promise<LineCredentials> {
  p.log.step(
    "LINE Developers Console でチャネル情報を確認してください\nhttps://developers.line.biz/console/",
  );

  p.log.info(
    [
      "必要なチャネル（2つ）:",
      "  1. Messaging API チャネル — Botのメッセージ送受信用",
      "  2. LINE Login チャネル   — ユーザー認証・LIFF用",
      "",
      "まだ作っていなければ、上のURLから作成してください。",
    ].join("\n"),
  );

  // --- Messaging API ---
  p.log.message(
    [
      "── Messaging API ──",
      "場所: LINE Official Account Manager → 設定 → Messaging API",
      "  https://manager.line.biz/ → アカウント選択 → 設定 → Messaging API",
    ].join("\n"),
  );

  const lineChannelId = await p.text({
    message: "Channel ID（数字）",
    placeholder: "同じページに表示されている Channel ID",
    validate(value) {
      if (!value || !/^\d+$/.test(value.trim())) {
        return "Channel ID は数字で入力してください";
      }
    },
  });
  if (p.isCancel(lineChannelId)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  const lineChannelAccessToken = await p.text({
    message: "チャネルアクセストークン（長期）",
    placeholder: "Messaging API設定 → チャネルアクセストークン → 発行",
    validate(value) {
      if (!value || value.trim().length < 10) {
        return "チャネルアクセストークンを入力してください";
      }
    },
  });
  if (p.isCancel(lineChannelAccessToken)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  const lineChannelSecret = await p.text({
    message: "チャネルシークレット",
    placeholder: "チャネル基本設定 → チャネルシークレット",
    validate(value) {
      if (!value || value.trim().length < 10) {
        return "チャネルシークレットを入力してください";
      }
    },
  });
  if (p.isCancel(lineChannelSecret)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  // --- LINE Login ---
  p.log.message(
    [
      "── LINE Login チャネル ──",
      "場所: LINE Developers Console → プロバイダー → LINE Login チャネル",
      "  https://developers.line.biz/console/",
      "  ※ Messaging API とは別のチャネルです",
    ].join("\n"),
  );

  const lineLoginChannelId = await p.text({
    message: "チャネル ID（数字）",
    placeholder: "チャネル基本設定 → チャネルID（例: 2009554425）",
    validate(value) {
      if (!value || !/^\d+$/.test(value.trim())) {
        return "チャネル ID は数字で入力してください";
      }
    },
  });
  if (p.isCancel(lineLoginChannelId)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  return {
    lineChannelId: (lineChannelId as string).trim(),
    lineChannelAccessToken: (lineChannelAccessToken as string).trim(),
    lineChannelSecret: (lineChannelSecret as string).trim(),
    lineLoginChannelId: (lineLoginChannelId as string).trim(),
  };
}
