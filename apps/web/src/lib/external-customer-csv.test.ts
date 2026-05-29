import { describe, expect, it } from 'vitest'
import {
  normalizeExternalCustomerCsvRow,
  parseCsvLine,
  parseExternalCustomerCsv,
} from './external-customer-csv'

describe('external customer CSV helpers', () => {
  it('parses quoted csv cells', () => {
    expect(parseCsvLine('"山田, 太郎",090-1111-2222,"memo ""quoted"""')).toEqual([
      '山田, 太郎',
      '090-1111-2222',
      'memo "quoted"',
    ])
  })

  it('parses rows with Japanese headers', () => {
    const rows = parseExternalCustomerCsv(
      '顧客ID,氏名,電話番号,メールアドレス\ncust_1,山田 太郎,090-1111-2222,test@example.com\n',
    )

    expect(rows).toHaveLength(1)
    expect(normalizeExternalCustomerCsvRow(rows[0])).toMatchObject({
      source: 'csv',
      externalId: 'cust_1',
      name: '山田 太郎',
      phone: '090-1111-2222',
      email: 'test@example.com',
    })
  })

  it('uses source and externalId when provided', () => {
    const row = normalizeExternalCustomerCsvRow({
      source: 'reserve_system',
      externalId: 'abc',
      name: '佐藤 花子',
      phone: '',
      email: '',
    })

    expect(row.source).toBe('reserve_system')
    expect(row.externalId).toBe('abc')
    expect(row.name).toBe('佐藤 花子')
  })
})
