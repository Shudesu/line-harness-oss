import * as p from "@clack/prompts";

interface LineCredentials {
  lineChannelId: string;
  lineChannelAccessToken: string;
  lineChannelSecret: string;
  lineLoginChannelId: string;
}

export async function promptLineCredentials(): Promise<LineCredentials> {
  // ═══ Step 2: Messaging API チャネル設定 ═══
  p.log.step("═══ Step 2. Messaging API チャネル設定 ═══");

  // Step 2-1: Channel ID
  p.log.message(
    [
      "■ Step 2-1. Channel ID 取得",
      "",
      "https://manager.line.biz/ にアクセス",
      "→ アカウント選択",
      "→ 右上の歯車アイコンの設定",
      "→ サイドメニュー「Messaging API」",
      "→ プロバイダーを作成",
      "→ Channel ID",
    ].join("\n"),
  );

  const lineChannelId = await p.text({
    message: "Channel ID（数字）",
    placeholder: "上の手順で取得した Channel ID",
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

  // Step 2-2: Channel Secret
  p.log.message(
    [
      "■ Step 2-2. Channel Secret 取得",
      "※ Step 2-1 で Channel ID を取得した際、Channel Secret も同じページに表示されています",
    ].join("\n"),
  );

  const lineChannelSecret = await p.text({
    message: "チャネルシークレット（英数字）",
    placeholder: "同じページに表示されている Channel Secret",
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

  // Step 2-3: Channel Access Token
  p.log.message(
    [
      "■ Step 2-3. チャネルアクセストークン取得",
      "",
      "https://developers.line.biz/console/ にアクセス",
      "→ Step 2 で設定したプロバイダーを選択",
      "→ Messaging API チャネル",
      "→ 「Messaging API設定」タブ",
      "→ チャネルアクセストークンを発行",
    ].join("\n"),
  );

  const lineChannelAccessToken = await p.text({
    message: "チャネルアクセストークン（長期）",
    placeholder: "上の手順で発行したトークン",
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

  // ═══ Step 3: LINE Login チャネル設定 ═══
  p.log.step("═══ Step 3. LINE Login チャネル設定 ═══");

  // Step 3-1: LINE Login Channel ID
  p.log.message(
    [
      "■ Step 3-1. チャネル ID 取得",
      "",
      "https://developers.line.biz/console/ にアクセス",
      "→ Step 2 で設定したプロバイダーを選択",
      "→ 新規チャネル作成",
      "→ LINE ログイン",
      "→ 基本情報設定",
      "→ チャネル ID",
    ].join("\n"),
  );

  const lineLoginChannelId = await p.text({
    message: "チャネル ID（数字）",
    placeholder: "LINE Login チャネルの ID（Messaging API とは別）",
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
