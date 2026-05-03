export function escapeHtml(value: string | null | undefined): string {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

export function inputValue(id: string): string {
  const element = document.getElementById(id);
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return element.value.trim();
  }
  return '';
}

export function numberValue(id: string): number | undefined {
  const value = inputValue(id);
  if (value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function nullableNumberValue(id: string): number | null {
  return numberValue(id) ?? null;
}

export function checkedValue(id: string): boolean | undefined {
  const element = document.getElementById(id);
  return element instanceof HTMLInputElement ? element.checked : undefined;
}
