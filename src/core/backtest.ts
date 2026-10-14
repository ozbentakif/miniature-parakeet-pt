// "Test on history": replays a rule day by day over past data, deciding only with what was known on each day.
// The outcome (money saved or given up) is then measured with the full, backfilled data.

import { addDays } from './dates'
import type { DataFlag } from './flags'
import { netResult, roas, sumRows } from './metrics'
import { evaluateRule, type Automation, type Evaluation, type Rule } from './rules'
import type { Dataset, Platform } from './types'

export interface BacktestHit {
  campaignId: string
  platform: Platform
  /** The sync day on which the rule fired. */
  clock: string
  evaluation: Evaluation
  automation: Automation
  /** Days the campaign would have been paused (from the trigger until it would be resumed, or the end of the data). */
  pausedFrom: string
  pausedTo: string
  pausedDays: number
  /** Net result the pause would have prevented. Positive: loss avoided. Negative: profit given up. */
  saved: number
}

export interface BacktestBlocked {
  campaignId: string
  clock: string
  evaluation: Evaluation
}

export interface BacktestMiss {
  campaignId: string
  /** Net result over the whole file. */
  net: number
  roas: number | null
}

export interface BacktestResult {
  ruleId: string
  hits: BacktestHit[]
  /** Campaigns where the rule matched but a company limit stopped it acting, and it never acted later. */
  blocked: BacktestBlocked[]
  /** Loss-making campaigns (ROAS below 100% over the whole file) the rule never caught. */
  missed: BacktestMiss[]
  lossAvoided: number
  profitGivenUp: number
  /** Sync days replayed. */
  firstClock: string
  lastClock: string
}

/**
 * Pause model:
 * - Rules on the last full day (such as a lead drop-off) pause from the next day while the problem continues, at least one day.
 *   This assumes the buyer resumes the campaign once the problem is fixed.
 * - Rules on fully qualified days (such as a stop-loss) pause until the end of the data.
 * - Approval requests and alerts are counted as if the buyer acted on the day they were raised.
 * - Flags are assumed reviewed within a day, so a flag only blocks the sync that sees it first.
 */
export function backtest(rule: Rule, dataset: Dataset, flags: readonly DataFlag[]): BacktestResult {
  const firstClock = addDays(dataset.firstDate, 1)
  const lastClock = dataset.lastDate
  const hits: BacktestHit[] = []
  const blocked: BacktestBlocked[] = []

  for (const campaign of dataset.campaigns) {
    const campaignFlags = flags.filter((f) => f.campaignId === campaign.id)
    let firstBlocked: BacktestBlocked | null = null

    for (let clock = firstClock; clock <= lastClock; clock = addDays(clock, 1)) {
      const yesterday = addDays(clock, -1)
      const e = evaluateRule(rule, campaign, clock, { paused: false, unreviewedFlags: campaignFlags.filter((f) => f.date === yesterday) })
      if (e.status === 'blocked') {
        firstBlocked ??= { campaignId: campaign.id, clock, evaluation: e }
        continue
      }
      if (e.status !== 'triggered') continue

      let pausedTo = dataset.lastDate
      if (rule.window.kind === 'lastDay') {
        // Stay paused while the problem continues: the next day still matches the rule.
        pausedTo = clock
        while (pausedTo < dataset.lastDate) {
          const next = evaluateRule(rule, campaign, addDays(pausedTo, 2), { paused: false, unreviewedFlags: [] })
          if (next.status !== 'triggered') break
          pausedTo = addDays(pausedTo, 1)
        }
      }
      const pausedRows = campaign.rows.filter((r) => r.date >= clock && r.date <= pausedTo)
      hits.push({
        campaignId: campaign.id,
        platform: campaign.platform,
        clock,
        evaluation: e,
        automation: e.automation,
        pausedFrom: clock,
        pausedTo,
        pausedDays: pausedRows.length,
        saved: -netResult(sumRows(pausedRows)),
      })
      firstBlocked = null
      break
    }
    if (firstBlocked) blocked.push(firstBlocked)
  }

  const caught = new Set(hits.map((h) => h.campaignId))
  const missed: BacktestMiss[] = dataset.campaigns
    .map((c) => {
      const t = sumRows(c.rows)
      return { campaignId: c.id, net: netResult(t), roas: roas(t) }
    })
    .filter((m) => m.roas != null && m.roas < 1 && !caught.has(m.campaignId))

  hits.sort((a, b) => (a.clock === b.clock ? a.campaignId.localeCompare(b.campaignId) : a.clock < b.clock ? -1 : 1))
  return {
    ruleId: rule.id,
    hits,
    blocked,
    missed,
    lossAvoided: hits.reduce((s, h) => s + Math.max(0, h.saved), 0),
    profitGivenUp: hits.reduce((s, h) => s + Math.max(0, -h.saved), 0),
    firstClock,
    lastClock,
  }
}
