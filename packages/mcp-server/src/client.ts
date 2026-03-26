import { LineHarness } from "@line-harness/sdk";

let clientInstance: LineHarness | null = null;

export function getClient(): LineHarness {
  if (clientInstance) return clientInstance;

  const apiUrl = process.env.LINE_HARNESS_API_URL;
  const apiKey = process.env.LINE_HARNESS_API_KEY;
  const accountId = process.env.LINE_HARNESS_ACCOUNT_ID;

  if (!apiUrl) {
    throw new Error("LINE_HARNESS_API_URL environment variable is required");
  }
  if (!apiKey) {
    throw new Error("LINE_HARNESS_API_KEY environment variable is required");
  }

  clientInstance = new LineHarness({
    apiUrl,
    apiKey,
    lineAccountId: accountId,
  });

  return clientInstance;
}
