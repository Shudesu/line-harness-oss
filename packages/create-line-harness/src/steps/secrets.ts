import * as p from "@clack/prompts";
import { wrangler } from "../lib/wrangler.js";

interface SecretsOptions {
  workerName: string;
  lineChannelAccessToken: string;
  lineChannelSecret: string;
  lineLoginChannelId: string;
  liffId: string;
  apiKey: string;
}

export async function setSecrets(options: SecretsOptions): Promise<void> {
  const s = p.spinner();
  s.start("シークレット設定中...");

  const secrets: Record<string, string> = {
    LINE_CHANNEL_ACCESS_TOKEN: options.lineChannelAccessToken,
    LINE_CHANNEL_SECRET: options.lineChannelSecret,
    LINE_LOGIN_CHANNEL_ID: options.lineLoginChannelId,
    LIFF_URL: `https://liff.line.me/${options.liffId}`,
    API_KEY: options.apiKey,
  };

  for (const [name, value] of Object.entries(secrets)) {
    await wrangler(["secret", "put", name, "--name", options.workerName], {
      input: value,
    });
  }

  s.stop("シークレット設定完了");
}
