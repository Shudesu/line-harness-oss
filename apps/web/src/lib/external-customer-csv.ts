export type ExternalCustomerCsvPayload = {
  source: string
  externalId: string | null
  name: string | null
  phone: string | null
  email: string | null
  metadata: Record<string, string>
}

export function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    const next = line[i + 1]
    if (char === '"' && quoted && next === '"') {
      current += '"'
      i += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells
}

export function parseExternalCustomerCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]).map((header) => header.trim())
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? ''
    })
    return row
  })
}

function valueFromRow(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = row[key]?.trim()
    if (value) return value
  }
  return ''
}

export function normalizeExternalCustomerCsvRow(row: Record<string, string>): ExternalCustomerCsvPayload {
  return {
    source: valueFromRow(row, ['source', 'ソース', '媒体', 'システム']) || 'csv',
    externalId: valueFromRow(row, ['externalId', 'external_id', 'id', '顧客ID', '会員ID']) || null,
    name: valueFromRow(row, ['name', '氏名', '名前', '顧客名']) || null,
    phone: valueFromRow(row, ['phone', 'tel', '電話', '電話番号']) || null,
    email: valueFromRow(row, ['email', 'mail', 'メール', 'メールアドレス']) || null,
    metadata: row,
  }
}
