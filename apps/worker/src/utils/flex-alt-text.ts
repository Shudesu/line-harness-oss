/** Recursively find the first text element in a Flex Message for altText */
export function extractFlexAltText(obj: unknown, depth = 0): string {
  if (depth > 10 || !obj || typeof obj !== 'object') return 'お知らせ';
  const node = obj as Record<string, unknown>;
  if (node.type === 'text' && typeof node.text === 'string') {
    return node.text.slice(0, 100);
  }
  if (Array.isArray(node.contents)) {
    for (const child of node.contents) {
      const found = extractFlexAltTextInner(child, depth + 1);
      if (found) return found;
    }
  }
  for (const key of ['header', 'body', 'footer']) {
    if (node[key]) {
      const found = extractFlexAltTextInner(node[key], depth + 1);
      if (found) return found;
    }
  }
  return 'お知らせ';
}

function extractFlexAltTextInner(obj: unknown, depth: number): string | null {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;
  const node = obj as Record<string, unknown>;
  if (node.type === 'text' && typeof node.text === 'string') {
    return node.text.slice(0, 100);
  }
  if (Array.isArray(node.contents)) {
    for (const child of node.contents) {
      const found = extractFlexAltTextInner(child, depth + 1);
      if (found) return found;
    }
  }
  for (const key of ['header', 'body', 'footer']) {
    if (node[key]) {
      const found = extractFlexAltTextInner(node[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}
