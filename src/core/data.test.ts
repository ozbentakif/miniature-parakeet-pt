import { describe, expect, it } from 'vitest'
import { loadDataset } from './data'
import { addDays, dateRange, daysBetween, formatDay, isIsoDate } from './dates'

const HEADER = 'date,campaign_id,platform,spend,clicks,leads,qualified_leads'

describe('dates', () => {
  it('validates and shifts ISO dates across month ends', () => {
    expect(isIsoDate('2026-07-31')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('14/07/2026')).toBe(false)
    expect(addDays('2026-07-30', 2)).toBe('2026-08-01')
    expect(daysBetween('2026-07-30', '2026-08-01')).toBe(2)
    expect(dateRange('2026-07-30', '2026-08-01')).toEqual(['2026-07-30', '2026-07-31', '2026-08-01'])
    expect(formatDay('2026-08-01')).toBe('1 Aug')
  })
})

describe('loadDataset', () => {
  it('builds campaigns and treats today as two days after the last date', () => {
    const csv = [HEADER, '2026-07-01,A,Meta,100,50,5,3', '2026-07-02,A,meta,110,55,6,2', '2026-07-02,B,TikTok,"$1,200.50","1,000",40,20'].join('\n')
    const { dataset, rejected } = loadDataset(csv, 'x.csv')
    expect(rejected).toEqual([])
    expect(dataset!.campaigns.map((c) => [c.id, c.platform, c.rows.length, c.startedBeforeFile])).toEqual([
      ['A', 'Meta', 2, true],
      ['B', 'TikTok', 1, false],
    ])
    expect(dataset!.rows[2].spend).toBe(1200.5)
    expect(dataset!.today).toBe('2026-07-04')
  })

  it('rejects impossible rows with a reason and keeps the rest', () => {
    const csv = [
      HEADER,
      '2026-07-01,A,Meta,100,50,5,3',
      '2026-07-01,A,Meta,100,50,5,3',
      '2026-07-02,A,Meta,100,50,5,6',
      '2026-07-03,A,Meta,100,4,5,3',
      '2026-07-04,A,Meta,-1,50,5,3',
      '2026-07-05,A,Bing,100,50,5,3',
      '2026-07-06,A,Google,100,50,5,3',
      '07/07/2026,A,Meta,100,50,5,3',
      '2026-07-08,A,Meta,100,50,2.5,1',
    ].join('\n')
    const { dataset, rejected } = loadDataset(csv, 'x.csv')
    expect(dataset!.rows).toHaveLength(1)
    expect(rejected.map((r) => [r.line, r.reason.split(':')[0].split(' (')[0]])).toEqual([
      [3, 'Duplicate row'],
      [4, 'More qualified leads'],
      [5, 'More leads'],
      [6, 'Negative values are impossible.'],
      [7, 'Platform "Bing" is not Meta, Google or TikTok.'],
      [8, 'Campaign is on Meta in earlier rows, not Google.'],
      [9, 'Date "07/07/2026" is not a valid YYYY-MM-DD date.'],
      [10, 'Clicks and leads must be whole numbers.'],
    ])
  })

  it('refuses a file without the required columns', () => {
    const result = loadDataset('date,campaign_id,spend\n2026-07-01,A,1', 'x.csv')
    expect(result.dataset).toBeNull()
    expect(result.error).toBe('Missing columns: platform, clicks, leads, qualified_leads.')
  })
})
