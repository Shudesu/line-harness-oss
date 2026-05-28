export function getApp(): HTMLElement {
  return document.getElementById('app')!;
}

export function escapeHtml(value: unknown): string {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}
