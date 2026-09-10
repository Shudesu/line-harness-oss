/**
 * exact/contains のキーワードマッチ述語。webhook のテキスト/postback 経路と
 * unanswered-inbox の「構造化メッセ除外」判定とテキスト自動化で共有する。
 * 未知の match_type はマッチなし扱い (誤マッチで inbox から隠すより安全側)。
 */
export function keywordMatches(
  rule: { keyword: string; match_type: string },
  text: string,
  opts: { normalizeText?: boolean } = {},
): boolean {
  // Unknown/regex match types stay unsupported; never reinterpret them as contains.
  if (rule.match_type !== 'exact' && rule.match_type !== 'contains') return false;
  const incoming = opts.normalizeText ? text.normalize('NFKC').trim() : text;
  const keyword = opts.normalizeText ? rule.keyword.normalize('NFKC').trim() : rule.keyword;
  // A whitespace-only rule must not become an accidental match-all after trim.
  if (opts.normalizeText && !keyword) return false;
  return rule.match_type === 'exact' ? incoming === keyword : incoming.includes(keyword);
}
