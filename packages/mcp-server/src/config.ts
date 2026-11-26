export function getApiConfig() {
  const apiUrl = process.env.LINE_HARNESS_API_URL?.trim();
  const apiKey = process.env.LINE_HARNESS_API_KEY?.trim();
  if (!apiUrl || !apiKey) throw new Error("LINE_HARNESS_API_URL and LINE_HARNESS_API_KEY required");
  let url: URL;
  try { url = new URL(apiUrl); } catch { throw new Error("LINE_HARNESS_API_URL must be an HTTP(S) URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("LINE_HARNESS_API_URL must be an HTTP(S) URL without credentials, query or fragment");
  }
  return { apiUrl: apiUrl.replace(/\/$/, ""), apiKey };
}
