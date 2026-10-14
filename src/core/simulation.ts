// The running system as a pure reducer: a simulated clock, the rules acting at each sync, the buyer's responses and the audit log.
// Platform writes (pauses and resumes) are simulated. Nothing leaves the browser.

import type { AuditEvent, Actor, EventType } from './audit'
import type { RejectedRow } from './data'
import { addDays, formatDay } from './dates'
import type { DataFlag } from './flags'
import { lastCompleteDay, netResult, sumRows } from './metrics'
import { evaluateRule, explainEvaluation, type Evaluation, type Rule } from './rules'
import type { Dataset } from './types'

export interface SimContext {
  dataset: Dataset
  rules: readonly Rule[]
  flags: readonly DataFlag[]
}

export interface PauseRecord {
  campaignId: string
  /** First sync day the campaign was paused. */
  from: string
  /** Sync day it was resumed, or null while still paused. */
  to: string | null
  by: Actor
  ruleId?: string
  reason: string
}

export type QueueKind = 'auto-paused' | 'approval' | 'alert' | 'warning' | 'flag'
export type QueueStatus = 'open' | 'approved' | 'declined' | 'undone' | 'silenced' | 'reviewed' | 'resolved'

export interface QueueItem {
  id: number
  kind: QueueKind
  status: QueueStatus
  clock: string
  campaignId: string
  ruleId?: string
  ruleName?: string
  flagKey?: string
  title: string
  detail: string
  /** Set when the item is closed, e.g. the decline reason. */
  outcome?: string
}

export interface SimState {
  mode: 'live' | 'replay'
  /** The day of the current sync. */
  clock: string
  /** The first sync day of this run. Flags older than this were raised before WDS went live and are ignored. */
  startClock: string
  pauses: PauseRecord[]
  queue: QueueItem[]
  /** Rule and campaign pairs whose condition is currently true, so each episode acts once. */
  episodes: Record<string, 'triggered' | 'blocked'>
  reviewedFlags: string[]
  events: AuditEvent[]
  nextId: number
}

export type SimAction =
  | { type: 'start'; ctx: SimContext; mode: 'live' | 'replay'; rejected: readonly RejectedRow[]; time: string }
  | { type: 'step'; ctx: SimContext }
  | { type: 'approve'; itemId: number; time: string }
  | { type: 'decline'; itemId: number; reason: string; time: string }
  | { type: 'undo'; itemId: number; time: string }
  | { type: 'silence'; itemId: number; time: string }
  | { type: 'review-flag'; itemId: number; time: string }
  | { type: 'pause'; campaignId: string; reason: string; time: string }
  | { type: 'resume'; campaignId: string; reason: string; time: string }
  | { type: 'log'; event: Omit<AuditEvent, 'id' | 'at'>; time: string }

/** The first hourly sync after a day closes. */
const SYNC_TIME = '01:00'

export const isPaused = (state: SimState, campaignId: string): boolean =>
  state.pauses.some((p) => p.campaignId === campaignId && p.to === null)

export function emptyState(clock: string, mode: 'live' | 'replay' = 'live'): SimState {
  return { mode, clock, startClock: clock, pauses: [], queue: [], episodes: {}, reviewedFlags: [], events: [], nextId: 1 }
}

function log(state: SimState, time: string, event: Omit<AuditEvent, 'id' | 'at'>): SimState {
  return { ...state, events: [...state.events, { ...event, id: state.nextId, at: `${state.clock}T${time}` }], nextId: state.nextId + 1 }
}

function addItem(state: SimState, item: Omit<QueueItem, 'id' | 'status' | 'clock'>): SimState {
  return { ...state, queue: [...state.queue, { ...item, id: state.nextId, status: 'open', clock: state.clock }], nextId: state.nextId + 1 }
}

function setItem(state: SimState, id: number, status: QueueStatus, outcome?: string): SimState {
  return { ...state, queue: state.queue.map((q) => (q.id === id ? { ...q, status, outcome } : q)) }
}

function startPause(state: SimState, pause: Omit<PauseRecord, 'from' | 'to'>): SimState {
  // Open approval requests for the campaign are answered by the pause.
  const queue = state.queue.map((q) =>
    q.campaignId === pause.campaignId && q.kind === 'approval' && q.status === 'open' ? { ...q, status: 'resolved' as const, outcome: 'Campaign paused.' } : q,
  )
  return { ...state, queue, pauses: [...state.pauses, { ...pause, from: state.clock, to: null }] }
}

function endPause(state: SimState, campaignId: string): SimState {
  return { ...state, pauses: state.pauses.map((p) => (p.campaignId === campaignId && p.to === null ? { ...p, to: state.clock } : p)) }
}

const EVENT_FOR: Record<'auto' | 'approval' | 'alert' | 'warning', EventType> = {
  auto: 'auto-paused',
  approval: 'approval-requested',
  alert: 'alert',
  warning: 'warning',
}

function act(state: SimState, rule: Rule, e: Evaluation): SimState {
  const detail = explainEvaluation(e) + (e.limitNote ? ` ${e.limitNote}` : '')
  const base = { campaignId: e.campaignId, ruleId: rule.id, ruleName: rule.name }
  const titles = {
    auto: 'Paused automatically (simulated)',
    approval: 'Pause? Approval needed',
    alert: e.limitNote?.startsWith('TikTok') ? 'Alert: pause it in TikTok' : 'Alert',
    warning: e.status === 'blocked' ? 'Warning: company limit stopped the rule' : 'Warning',
  }
  const messages = {
    auto: `${rule.name} paused the campaign (simulated platform write).`,
    approval: `${rule.name} asks to pause the campaign.`,
    alert: `${rule.name} raised an alert.`,
    warning: `${rule.name} matched. Dashboard warning only.`,
  }

  let next = state
  if (e.automation === 'auto') next = startPause(next, { campaignId: e.campaignId, by: 'WDS', ruleId: rule.id, reason: rule.name })
  next = addItem(next, { ...base, kind: e.automation === 'auto' ? 'auto-paused' : e.automation, title: titles[e.automation], detail })
  return log(next, SYNC_TIME, { ...base, actor: 'WDS', type: EVENT_FOR[e.automation], message: messages[e.automation], detail })
}

/** One hourly sync on day `state.clock`: read new data, raise flags, run every enabled rule. */
function sync(state: SimState, ctx: SimContext): SimState {
  const { dataset } = ctx
  const yesterday = addDays(state.clock, -1)
  const platformTo = yesterday <= dataset.lastDate ? yesterday : dataset.lastDate
  let next = log(state, SYNC_TIME, {
    actor: 'WDS',
    type: 'sync',
    message:
      yesterday <= dataset.lastDate
        ? `Synced Meta, Google and TikTok data up to ${formatDay(platformTo)}. Qualification results complete up to ${formatDay(lastCompleteDay(state.clock))}.`
        : `No new platform data after ${formatDay(dataset.lastDate)} (the file ends there). Qualification results complete up to ${formatDay(lastCompleteDay(state.clock))}.`,
  })

  for (const f of ctx.flags.filter((f) => f.date === yesterday)) {
    next = addItem(next, { kind: 'flag', campaignId: f.campaignId, flagKey: f.key, title: 'Irregular data: review before rules act', detail: `${formatDay(f.date)}: ${f.message}` })
    next = log(next, SYNC_TIME, { actor: 'WDS', type: 'data-flagged', campaignId: f.campaignId, message: f.message, detail: `Data for ${formatDay(f.date)}.` })
  }

  const flagFrom = addDays(next.startClock, -1)
  for (const rule of ctx.rules.filter((r) => r.enabled)) {
    for (const campaign of dataset.campaigns) {
      const key = `${rule.id}|${campaign.id}`
      const unreviewedFlags = ctx.flags.filter(
        (f) => f.campaignId === campaign.id && f.date >= flagFrom && f.date <= yesterday && !next.reviewedFlags.includes(f.key),
      )
      const e = evaluateRule(rule, campaign, next.clock, { paused: isPaused(next, campaign.id), unreviewedFlags })
      const previous = next.episodes[key]

      if (e.status === 'triggered' || e.status === 'blocked') {
        // Act once per episode. A blocked match that later clears its limit acts again.
        if (previous === e.status || previous === 'triggered') continue
        next = { ...next, episodes: { ...next.episodes, [key]: e.status } }
        next = act(next, rule, e)
      } else if (e.status === 'clear' && previous) {
        const episodes = { ...next.episodes }
        delete episodes[key]
        next = { ...next, episodes }
        const open = next.queue.filter((q) => q.ruleId === rule.id && q.campaignId === campaign.id && q.status === 'open' && q.kind !== 'auto-paused')
        for (const q of open) next = setItem(next, q.id, 'resolved', `Condition cleared on ${formatDay(next.clock)}.`)
        if (open.length > 0) {
          next = log(next, SYNC_TIME, { actor: 'WDS', type: 'condition-cleared', campaignId: campaign.id, ruleId: rule.id, ruleName: rule.name, message: `${rule.name} no longer matches.`, detail: explainEvaluation(e) })
        }
      }
    }
  }
  return next
}

export function simReducer(state: SimState, action: SimAction): SimState {
  switch (action.type) {
    case 'start': {
      const { dataset } = action.ctx
      const clock = action.mode === 'live' ? dataset.today : addDays(dataset.firstDate, 1)
      let next = emptyState(clock, action.mode)
      next = log(next, action.time, {
        actor: 'You',
        type: 'data-loaded',
        message: `Read ${dataset.fileName} from the inbox: ${dataset.rows.length} rows, ${dataset.campaigns.length} campaigns, ${formatDay(dataset.firstDate)} to ${formatDay(dataset.lastDate)}.`,
        detail: action.rejected.length > 0 ? `${action.rejected.length} row(s) rejected.` : 'No rows rejected.',
      })
      for (const r of action.rejected) {
        next = log(next, action.time, { actor: 'WDS', type: 'row-rejected', campaignId: r.campaignId || undefined, message: r.reason, detail: `Line ${r.line}${r.date ? `, ${r.date}` : ''}.` })
      }
      if (action.mode === 'replay') {
        next = log(next, action.time, { actor: 'You', type: 'replay-started', message: `Replaying from ${formatDay(clock)} as if WDS had been live, one sync per day.` })
      }
      return sync(next, action.ctx)
    }

    case 'step': {
      if (state.clock >= action.ctx.dataset.today) return state
      return sync({ ...state, clock: addDays(state.clock, 1) }, action.ctx)
    }

    case 'approve': {
      const item = state.queue.find((q) => q.id === action.itemId)
      if (!item || item.kind !== 'approval' || item.status !== 'open') return state
      let next = state
      if (!isPaused(next, item.campaignId)) next = startPause(next, { campaignId: item.campaignId, by: 'You', ruleId: item.ruleId, reason: `Approved: ${item.ruleName}` })
      next = setItem(next, item.id, 'approved', 'Approved. Campaign paused (simulated).')
      return log(next, action.time, { actor: 'You', type: 'approved', campaignId: item.campaignId, ruleId: item.ruleId, ruleName: item.ruleName, message: 'Approved the pause. Campaign paused (simulated platform write).', detail: item.detail })
    }

    case 'decline': {
      const item = state.queue.find((q) => q.id === action.itemId)
      if (!item || item.kind !== 'approval' || item.status !== 'open') return state
      const next = setItem(state, item.id, 'declined', `Declined: ${action.reason}`)
      return log(next, action.time, { actor: 'You', type: 'declined', campaignId: item.campaignId, ruleId: item.ruleId, ruleName: item.ruleName, message: `Declined the pause. Reason: ${action.reason}`, detail: item.detail })
    }

    case 'undo': {
      const item = state.queue.find((q) => q.id === action.itemId)
      if (!item || item.kind !== 'auto-paused' || item.status !== 'open') return state
      const next = setItem(endPause(state, item.campaignId), item.id, 'undone', 'Undone. Campaign running again.')
      return log(next, action.time, { actor: 'You', type: 'resumed', campaignId: item.campaignId, ruleId: item.ruleId, ruleName: item.ruleName, message: 'Undid the automated pause. Campaign resumed (simulated).' })
    }

    case 'silence': {
      const item = state.queue.find((q) => q.id === action.itemId)
      if (!item || (item.kind !== 'alert' && item.kind !== 'warning') || item.status !== 'open') return state
      const next = setItem(state, item.id, 'silenced', 'Silenced. It returns only if the condition clears and recurs.')
      return log(next, action.time, { actor: 'You', type: 'silenced', campaignId: item.campaignId, ruleId: item.ruleId, ruleName: item.ruleName, message: 'Silenced the warning for themselves.' })
    }

    case 'review-flag': {
      const item = state.queue.find((q) => q.id === action.itemId)
      if (!item || item.kind !== 'flag' || item.status !== 'open' || !item.flagKey) return state
      const next = { ...setItem(state, item.id, 'reviewed', 'Reviewed. Rules can act on this data.'), reviewedFlags: [...state.reviewedFlags, item.flagKey] }
      return log(next, action.time, { actor: 'You', type: 'flag-reviewed', campaignId: item.campaignId, message: 'Reviewed the flagged data. Rules can act on it from the next sync.', detail: item.detail })
    }

    case 'pause': {
      if (isPaused(state, action.campaignId)) return state
      const next = startPause(state, { campaignId: action.campaignId, by: 'You', reason: action.reason })
      return log(next, action.time, { actor: 'You', type: 'paused', campaignId: action.campaignId, message: `Paused manually (simulated). Reason: ${action.reason}` })
    }

    case 'resume': {
      if (!isPaused(state, action.campaignId)) return state
      let next = endPause(state, action.campaignId)
      for (const q of next.queue.filter((q) => q.campaignId === action.campaignId && q.kind === 'auto-paused' && q.status === 'open')) {
        next = setItem(next, q.id, 'undone', 'Resumed by the buyer.')
      }
      return log(next, action.time, { actor: 'You', type: 'resumed', campaignId: action.campaignId, message: `Resumed manually (simulated). Reason: ${action.reason}` })
    }

    case 'log':
      return log(state, action.time, action.event)
  }
}

export interface Impact {
  /** Net loss prevented by pauses so far. */
  lossAvoided: number
  /** Net profit that paused campaigns would have made. */
  profitGivenUp: number
  byCampaign: Record<string, number>
}

/**
 * What the pauses changed, using the full backfilled data for the days each campaign was paused, up to the last finished day.
 * Positive per campaign: loss avoided. Negative: profit given up.
 */
export function impact(state: SimState, dataset: Dataset): Impact {
  const lastDay = addDays(state.clock, -1)
  const byCampaign: Record<string, number> = {}
  for (const p of state.pauses) {
    const campaign = dataset.campaigns.find((c) => c.id === p.campaignId)
    if (!campaign) continue
    const end = p.to ? addDays(p.to, -1) : lastDay
    const rows = campaign.rows.filter((r) => r.date >= p.from && r.date <= end)
    byCampaign[p.campaignId] = (byCampaign[p.campaignId] ?? 0) - netResult(sumRows(rows))
  }
  const values = Object.values(byCampaign)
  return {
    lossAvoided: values.reduce((s, v) => s + Math.max(0, v), 0),
    profitGivenUp: values.reduce((s, v) => s + Math.max(0, -v), 0),
    byCampaign,
  }
}
