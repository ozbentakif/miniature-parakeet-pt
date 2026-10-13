import { describe, expect, it } from 'vitest'
import { parseCsv, parseRecords, toNumber } from './csv'

describe('parseRecords', () => {
  it('splits simple rows', () => {
    expect(parseRecords('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('handles quotes, escaped quotes and commas inside quotes', () => {
    expect(parseRecords('name,note\n"Smith, J","said ""hi"""')).toEqual([
      ['name', 'note'],
      ['Smith, J', 'said "hi"'],
    ])
  })

  it('handles newlines inside quotes, CRLF line endings and a BOM', () => {
    expect(parseRecords('﻿a,b\r\n"line1\nline2",x\r\n')).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'x'],
    ])
  })

  it('skips blank lines and keeps empty fields', () => {
    expect(parseRecords('a,b\n\n1,\n')).toEqual([['a', 'b'], ['1', '']])
  })
})

describe('parseCsv', () => {
  it('maps rows to trimmed headers and fills missing cells with empty strings', () => {
    const t = parseCsv(' id , value \n1,10\n2\n')
    expect(t.headers).toEqual(['id', 'value'])
    expect(t.rows).toEqual([{ id: '1', value: '10' }, { id: '2', value: '' }])
  })

  it('returns an empty table for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] })
  })
})

describe('toNumber', () => {
  it.each([
    ['1,234.5', 1234.5],
    ['$12', 12],
    ['15%', 15],
    ['-3', -3],
    ['0', 0],
  ])('parses %s', (input, expected) => {
    expect(toNumber(input)).toBe(expected)
  })

  it.each(['', ' ', '-', 'n/a', undefined])('returns null for %s', (input) => {
    expect(toNumber(input)).toBeNull()
  })
})
