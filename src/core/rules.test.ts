import { describe, expect, it } from 'vitest'
import { detectFlags } from './flags'
import { campaignView, costPerLead, roas } from './metrics'
import { evaluateRule, STARTER_RULES, validateRule, type Rule } from './rules'
import { makeDataset } from './test-helpers'

const [LEAD_DROP, STOP_LOSS] = STARTER_RULES
const OK = { paused: false, unreviewedFlags: [] }

describe('metrics', () => {
  it('uses only complete qualification days for ROAS', () => {
    // On 11 Jul, qualification is complete up to 8 Jul. The last 2 days are not in yet, so values there must be ignored.
    const ds = makeDataset([{ id: 'A', length: 10, days: { 8: { qualified: 25 }, 9: { qualified: 25 } } }])
    const view = campaignView(ds.campaigns[0], '2026-07-11', '2026-07-01')
    expect(view.platform.days).toBe(10)
    expect(view.complete.days).toBe(8)
    expect(roas(view.complete)).toBeCloseTo((55 * 15 * 8) / view.complete.spend)
    expect(costPerLead(view.platform)).toBeCloseTo(view.platform.spend / 250)
  })
})

describe('lead drop-off', () => {
  const drop = { 13: { spend: 600, clicks: 480, leads: 2 } }

  it('acts automatically when leads collapse but clicks do not', () => {
    const ds = makeDataset([{ id: 'A', days: drop }])
    const e = evaluateRule(LEAD_DROP, ds.campaigns[0], '2026-07-15', OK)
    expect(e.status).toBe('triggered')
    expect(e.automation).toBe('auto')
    expect(e.observed.map((o) => o.baseline)).toEqual([25, 500])
  })

  it('stays quiet when clicks fell too (traffic dropped, not tracking)', () => {
    const ds = makeDataset([{ id: 'A', days: { 13: { spend: 600, clicks: 200, leads: 2 } } }])
    expect(evaluateRule(LEAD_DROP, ds.campaigns[0], '2026-07-15', OK).status).toBe('clear')
  })

  it('stays quiet below the $300 minimum spend', () => {
    const ds = makeDataset([{ id: 'A', base: { spend: 150 }, days: { 13: { spend: 150, clicks: 480, leads: 0 } } }])
    expect(evaluateRule(LEAD_DROP, ds.campaigns[0], '2026-07-15', OK).status).toBe('clear')
  })

  it('only alerts on TikTok, which is read-only', () => {
    const ds = makeDataset([{ id: 'T', platform: 'TikTok', days: drop }])
    const e = evaluateRule(LEAD_DROP, ds.campaigns[0], '2026-07-15', OK)
    expect([e.status, e.automation]).toEqual(['triggered', 'alert'])
    expect(e.limitNote).toMatch(/read-only/)
  })

  it('is blocked for campaigns with under 14 days of history', () => {
    const ds = makeDataset([
      { id: 'OLD', length: 30 },
      { id: 'NEW', startOffset: 5, length: 25, days: { 10: { spend: 600, clicks: 480, leads: 2 } } },
    ])
    const e = evaluateRule(LEAD_DROP, ds.campaigns.find((c) => c.id === 'NEW')!, '2026-07-17', OK)
    expect([e.status, e.automation]).toEqual(['blocked', 'warning'])
    expect(e.limitNote).toMatch(/Only 11 days of history/)
  })

  it('is blocked by unreviewed flagged data, and skips paused or excluded campaigns', () => {
    const ds = makeDataset([{ id: 'A', days: drop }])
    const flag = { key: 'k', campaignId: 'A', date: '2026-07-14', kind: 'frozen' as const, message: '' }
    expect(evaluateRule(LEAD_DROP, ds.campaigns[0], '2026-07-15', { paused: false, unreviewedFlags: [flag] }).status).toBe('blocked')
    expect(evaluateRule(LEAD_DROP, ds.campaigns[0], '2026-07-15', { paused: true, unreviewedFlags: [] }).status).toBe('paused')
    expect(evaluateRule({ ...LEAD_DROP, exceptions: ['A'] }, ds.campaigns[0], '2026-07-15', OK).status).toBe('excluded')
  })
})

describe('quality stop-loss', () => {
  // 10 qualified a day on ~$500 is ROAS 110%; 5 a day is 55%.
  const losing = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i, { qualified: i >= 10 ? 5 : 10 }]))

  it('asks for approval once 14 fully qualified days are below break-even, without looking ahead', () => {
    const ds = makeDataset([{ id: 'A', days: losing }])
    // On 27 Jul the window is 11 to 24 Jul: all losing days.
    const e = evaluateRule(STOP_LOSS, ds.campaigns[0], '2026-07-27', OK)
    expect([e.status, e.automation, e.from, e.to]).toEqual(['triggered', 'approval', '2026-07-11', '2026-07-24'])
    // On 20 Jul the window (4 to 17 Jul) mixes 7 good and 7 losing days: ROAS about 83%, so it triggers too.
    expect(evaluateRule(STOP_LOSS, ds.campaigns[0], '2026-07-20', OK).status).toBe('triggered')
    // On 16 Jul the window would start on 30 Jun, before the data: not enough complete days yet.
    expect(evaluateRule(STOP_LOSS, ds.campaigns[0], '2026-07-16', OK).status).toBe('no-data')
  })

  it('ignores days whose qualification is still incomplete', () => {
    // Terrible results only on 29 and 30 Jul, which are not complete on 31 Jul.
    const ds = makeDataset([{ id: 'A', days: { 28: { qualified: 0 }, 29: { qualified: 0 } } }])
    expect(evaluateRule(STOP_LOSS, ds.campaigns[0], '2026-07-31', OK).status).toBe('clear')
  })
})

describe('validateRule', () => {
  it('accepts the starter rules', () => {
    for (const r of STARTER_RULES) expect(validateRule(r)).toEqual([])
  })

  it('enforces the company minimum and complete days for qualification metrics', () => {
    const bad: Rule = { ...LEAD_DROP, minSpend: 100, conditions: [{ metric: 'roas', comparison: 'below', value: 1, relative: false }] }
    expect(validateRule(bad)).toEqual([
      'Minimum spend must be at least $300 (company limit).',
      'ROAS needs complete qualification results, so it can only use fully qualified days.',
    ])
  })
})

describe('detectFlags', () => {
  it('flags frozen data, gaps and platform-wide drops', () => {
    const drop = { 20: { leads: 1 } }
    const ds = makeDataset([
      { id: 'F', days: { 5: { spend: 700 }, 6: { spend: 700 } } },
      { id: 'G', length: 10 },
      { id: 'P1', platform: 'Google', days: drop },
      { id: 'P2', platform: 'Google', days: drop },
      { id: 'P3', platform: 'Google', days: drop },
      { id: 'P4', platform: 'Google' },
    ])
    // Remove a middle day of G to create a gap.
    const g = ds.campaigns.find((c) => c.id === 'G')!
    g.rows.splice(4, 1)
    g.byDate.delete('2026-07-05')
    const flags = detectFlags(ds).map((f) => `${f.kind} ${f.campaignId} ${f.date}`)
    expect(flags).toEqual([
      'gap G 2026-07-05',
      'frozen F 2026-07-07',
      'platform-drop P1 2026-07-21',
      'platform-drop P2 2026-07-21',
      'platform-drop P3 2026-07-21',
    ])
  })
})
