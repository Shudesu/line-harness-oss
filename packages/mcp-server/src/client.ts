import { getApiConfig } from "./config.js";
import { LineHarness } from "@line-harness/sdk";

let clientInstance: LineHarness | null = null;

export function getClient(): LineHarness {
  if (clientInstance) return clientInstance;

  const { apiUrl, apiKey } = getApiConfig();
  const accountId = process.env.LINE_HARNESS_ACCOUNT_ID;

  clientInstance = new LineHarness({
    apiUrl,
    apiKey,
    lineAccountId: accountId,
  });

  return clientInstance;
}
