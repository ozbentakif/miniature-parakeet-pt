import { describe, expect, it } from 'vitest'
import { auditToCsv } from './audit'
import { backtest } from './backtest'
import { detectFlags } from './flags'
import { STARTER_RULES } from './rules'
import { emptyState, impact, isPaused, simReducer, type SimContext, type SimState } from './simulation'
import { makeDataset } from './test-helpers'

const [LEAD_DROP, STOP_LOSS] = STARTER_RULES

// A: tracking fault on 13 and 14 Jul. B: loses money from the start. T: TikTok with the same fault as A.
const fault = { 12: { spend: 600, clicks: 480, leads: 2 }, 13: { spend: 600, clicks: 480, leads: 1 } }
const losing = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i, { qualified: 5 }]))
const ds = makeDataset([{ id: 'A', days: fault }, { id: 'B', days: losing }, { id: 'T', platform: 'TikTok', days: fault }])
const ctx: SimContext = { dataset: ds, rules: STARTER_RULES, flags: detectFlags(ds) }

function replayTo(clock: string, from: SimState = simReducer(emptyState(''), { type: 'start', ctx, mode: 'replay', rejected: [], time: '09:00' })): SimState {
  let s = from
  while (s.clock < clock) s = simReducer(s, { type: 'step', ctx })
  return s
}

describe('backtest', () => {
  it('pauses a tracking fault only while it lasts and counts the loss avoided', () => {
    const r = backtest(LEAD_DROP, ds, ctx.flags)
    const a = r.hits.find((h) => h.campaignId === 'A')!
    // Fault seen on the 14 Jul sync (13 Jul data); 14 Jul was still faulty, 15 Jul was not.
    expect([a.clock, a.pausedFrom, a.pausedTo, a.pausedDays]).toEqual(['2026-07-14', '2026-07-14', '2026-07-14', 1])
    // 14 Jul: $600 spent for 1 lead, which qualified.
    expect(a.saved).toBeCloseTo(600 - 55)
    expect(r.hits.find((h) => h.campaignId === 'T')!.automation).toBe('alert')
  })

  it('pauses a loss-making campaign until the end and lists campaigns it missed', () => {
    const r = backtest(STOP_LOSS, ds, ctx.flags)
    expect(r.hits.map((h) => [h.campaignId, h.clock])).toEqual([['B', '2026-07-17']])
    expect(r.hits[0].pausedTo).toBe('2026-07-30')
    expect(r.lossAvoided).toBeGreaterThan(0)
    expect(r.missed).toEqual([])
  })
})

describe('simulation', () => {
  it('starts live on today with one sync', () => {
    const s = simReducer(emptyState(''), { type: 'start', ctx, mode: 'live', rejected: [], time: '09:00' })
    expect(s.clock).toBe('2026-08-01')
    expect(s.events.map((e) => e.type)).toEqual(['data-loaded', 'sync', 'approval-requested'])
  })

  it('pauses automatically, asks for approval, and acts once per episode', () => {
    const s = replayTo('2026-07-20')
    expect(isPaused(s, 'A')).toBe(true)
    expect(isPaused(s, 'T')).toBe(false)
    const kinds = s.queue.map((q) => `${q.kind} ${q.campaignId} ${q.clock}`)
    expect(kinds).toEqual(['auto-paused A 2026-07-14', 'alert T 2026-07-14', 'approval B 2026-07-17'])
  })

  it('records approve, decline, undo and manual actions in the audit log', () => {
    let s = replayTo('2026-07-17')
    const approval = s.queue.find((q) => q.kind === 'approval')!
    const auto = s.queue.find((q) => q.kind === 'auto-paused')!
    s = simReducer(s, { type: 'decline', itemId: approval.id, reason: 'Client promotion running', time: '09:10' })
    expect(isPaused(s, 'B')).toBe(false)
    s = simReducer(s, { type: 'undo', itemId: auto.id, time: '09:11' })
    expect(isPaused(s, 'A')).toBe(false)
    s = simReducer(s, { type: 'pause', campaignId: 'B', reason: 'Low lead quality', time: '09:12' })
    expect(isPaused(s, 'B')).toBe(true)

    const last = s.events.slice(-3).map((e) => [e.at, e.actor, e.type, e.campaignId])
    expect(last).toEqual([
      ['2026-07-17T09:10', 'You', 'declined', 'B'],
      ['2026-07-17T09:11', 'You', 'resumed', 'A'],
      ['2026-07-17T09:12', 'You', 'paused', 'B'],
    ])
    expect(auditToCsv(s.events).split('\n')[0]).toBe('time,actor,event,campaign,rule,message,based_on')
  })

  it('measures the loss avoided by pauses so far', () => {
    let s = replayTo('2026-07-17')
    const approval = s.queue.find((q) => q.kind === 'approval')!
    s = simReducer(s, { type: 'approve', itemId: approval.id, time: '09:00' })
    s = replayTo('2026-07-20', s)
    const result = impact(s, ds)
    // B paused for 17 to 19 Jul: about $500 spend and 5 qualified ($275) a day.
    expect(result.byCampaign.B).toBeCloseTo(3 * 500 + 1 - 3 * 275, 0)
  })
})
