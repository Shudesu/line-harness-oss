import { describe, expect, it } from 'vitest'
import {
  buildDirectFormUrl,
  buildFormUrl,
  normalizeFormFields,
  parseFormOptions,
  slugFieldName,
} from './form-manager-utils'

describe('form-manager-utils', () => {
  describe('buildFormUrl', () => {
    it('builds a relative form URL when LIFF URL is empty', () => {
      expect(buildFormUrl('', 'form_1')).toBe('/?page=form&id=form_1')
    })

    it('appends form query to a plain LIFF URL', () => {
      expect(buildFormUrl('https://liff.line.me/abc', 'form_1')).toBe(
        'https://liff.line.me/abc?page=form&id=form_1',
      )
    })

    it('appends form query with ampersand when LIFF URL already has query params', () => {
      expect(buildFormUrl('https://example.com/?liffId=abc', 'form 1')).toBe(
        'https://example.com/?liffId=abc&page=form&id=form%201',
      )
    })
  })

  describe('buildDirectFormUrl', () => {
    it('builds a relative direct URL when Worker URL is empty', () => {
      expect(buildDirectFormUrl('', 'form_1')).toBe('/form/form_1')
    })

    it('builds a direct Worker form URL and trims trailing slash', () => {
      expect(buildDirectFormUrl('https://worker.example.com/', 'form 1')).toBe(
        'https://worker.example.com/form/form%201',
      )
    })
  })

  describe('normalizeFormFields', () => {
    it('returns array fields as-is', () => {
      const fields = [{ name: 'name', label: '名前', type: 'text' }]
      expect(normalizeFormFields(fields)).toEqual(fields)
    })

    it('parses JSON string fields', () => {
      expect(normalizeFormFields('[{"name":"email","label":"メール","type":"email"}]')).toEqual([
        { name: 'email', label: 'メール', type: 'email' },
      ])
    })

    it('returns empty array for invalid JSON', () => {
      expect(normalizeFormFields('{invalid')).toEqual([])
    })
  })

  describe('parseFormOptions', () => {
    it('splits options by newline and comma, trimming blanks', () => {
      expect(parseFormOptions('A\nB, C\n\n')).toEqual(['A', 'B', 'C'])
    })
  })

  describe('slugFieldName', () => {
    it('normalizes a field name and falls back when blank', () => {
      expect(slugFieldName('Phone Number', 'field_1')).toBe('phone_number')
      expect(slugFieldName('  ', 'field_1')).toBe('field_1')
    })
  })
})
