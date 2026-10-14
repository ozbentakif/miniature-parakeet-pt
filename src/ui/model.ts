// View models for the dashboard: what each campaign row shows on the current sync day.

import { addDays } from '../core/dates'
import { addTotals, campaignView, costPerLead, EMPTY_TOTALS, lastPlatformDay, netResult, qualificationRate, roas, type CampaignView, type Totals } from '../core/metrics'
import { COMPANY_LIMITS } from '../core/rules'
import { isPaused, type QueueItem, type SimState } from '../core/simulation'
import type { Campaign, Dataset } from '../core/types'

export type Period = 7 | 14 | 'all'

export const PERIOD_LABELS: Record<string, string> = { 7: 'Last 7 days', 14: 'Last 14 days', all: 'Whole file' }

export type Tone = 'good' | 'bad' | 'warn' | 'info' | 'muted'

export interface CampaignRow {
  campaign: Campaign
  view: CampaignView
  status: { label: string; tone: Tone }
  cpl: number | null
  qualRate: number | null
  roas: number | null
  net: number
  openItems: QueueItem[]
}

export function periodStart(dataset: Dataset, clock: string, period: Period): string {
  return period === 'all' ? dataset.firstDate : addDays(clock, -period)
}

export function campaignRows(dataset: Dataset, sim: SimState, period: Period): CampaignRow[] {
  const from = periodStart(dataset, sim.clock, period)
  return dataset.campaigns
    .filter((c) => c.firstDate <= lastPlatformDay(sim.clock))
    .map((campaign) => {
      const view = campaignView(campaign, sim.clock, from)
      const openItems = sim.queue.filter((q) => q.campaignId === campaign.id && q.status === 'open')
      const pause = sim.pauses.find((p) => p.campaignId === campaign.id && p.to === null)
      let status: CampaignRow['status'] = { label: 'Running', tone: 'good' }
      if (isPaused(sim, campaign.id)) status = { label: pause?.by === 'WDS' ? 'Paused by rule' : 'Paused by you', tone: 'muted' }
      else if (openItems.some((q) => q.kind === 'flag')) status = { label: 'Data flagged', tone: 'warn' }
      else if (!campaign.startedBeforeFile && view.daysOfHistory < COMPANY_LIMITS.minHistoryDays) {
        status = { label: `New: ${view.daysOfHistory} days`, tone: 'info' }
      }
      return {
        campaign,
        view,
        status,
        cpl: costPerLead(view.platform),
        qualRate: qualificationRate(view.complete),
        roas: roas(view.complete),
        net: netResult(view.complete),
        openItems,
      }
    })
}

export interface PortfolioTotals {
  platform: Totals
  complete: Totals
  /** Net result of campaigns below break-even in the period (complete days). */
  lossOnLosers: number
  losers: number
}

export function portfolio(rows: CampaignRow[]): PortfolioTotals {
  let platform = EMPTY_TOTALS
  let complete = EMPTY_TOTALS
  let lossOnLosers = 0
  let losers = 0
  for (const r of rows) {
    platform = addTotals(platform, r.view.platform)
    complete = addTotals(complete, r.view.complete)
    if (r.net < 0) {
      lossOnLosers += r.net
      losers += 1
    }
  }
  return { platform, complete, lossOnLosers, losers }
}

export function roasTone(value: number | null): Tone {
  if (value == null) return 'muted'
  if (value < 1) return 'bad'
  if (value < 1.1) return 'warn'
  return 'good'
}
