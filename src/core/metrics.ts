// Campaign metrics. ROAS here means our revenue (a fixed fee per qualified lead) divided by spend; 1.0 is break-even.

import { addDays } from './dates'
import type { Campaign, DayRow } from './types'

export const FEE_PER_QUALIFIED_LEAD = 55
/** Qualification is complete 1 to 3 days after a lead is submitted, so only days at least this old are complete. */
export const QUALIFICATION_LAG_DAYS = 3

export interface Totals {
  spend: number
  clicks: number
  leads: number
  qualified: number
  days: number
}

export const EMPTY_TOTALS: Totals = { spend: 0, clicks: 0, leads: 0, qualified: 0, days: 0 }

export function sumRows(rows: readonly DayRow[]): Totals {
  const t = { ...EMPTY_TOTALS }
  for (const r of rows) {
    t.spend += r.spend
    t.clicks += r.clicks
    t.leads += r.leads
    t.qualified += r.qualifiedLeads
    t.days += 1
  }
  return t
}

export function addTotals(a: Totals, b: Totals): Totals {
  return {
    spend: a.spend + b.spend,
    clicks: a.clicks + b.clicks,
    leads: a.leads + b.leads,
    qualified: a.qualified + b.qualified,
    days: a.days + b.days,
  }
}

/** Cost per submitted lead. */
export const costPerLead = (t: Totals): number | null => (t.leads > 0 ? t.spend / t.leads : null)
export const qualificationRate = (t: Totals): number | null => (t.leads > 0 ? t.qualified / t.leads : null)
export const roas = (t: Totals): number | null => (t.spend > 0 ? (FEE_PER_QUALIFIED_LEAD * t.qualified) / t.spend : null)
/** Revenue minus spend. Negative means money lost. */
export const netResult = (t: Totals): number => FEE_PER_QUALIFIED_LEAD * t.qualified - t.spend

/** On day `clock`, platform data is final up to the day before. */
export const lastPlatformDay = (clock: string): string => addDays(clock, -1)
/** On day `clock`, qualification results are complete up to this day. */
export const lastCompleteDay = (clock: string): string => addDays(clock, -QUALIFICATION_LAG_DAYS)

export function rowsBetween(campaign: Campaign, from: string, to: string): DayRow[] {
  return campaign.rows.filter((r) => r.date >= from && r.date <= to)
}

export interface CampaignView {
  /** Spend, clicks and leads for the period, from platform data. */
  platform: Totals
  /** The same period, limited to days whose qualification results are complete. Use for qualification rate and ROAS. */
  complete: Totals
  /** Days with data up to the day before `clock`. */
  daysOfHistory: number
}

/** What WDS knows about a campaign on day `clock`, for the period starting at `from` (inclusive). */
export function campaignView(campaign: Campaign, clock: string, from: string): CampaignView {
  const platformEnd = lastPlatformDay(clock)
  return {
    platform: sumRows(rowsBetween(campaign, from, platformEnd)),
    complete: sumRows(rowsBetween(campaign, from, lastCompleteDay(clock))),
    daysOfHistory: campaign.rows.filter((r) => r.date <= platformEnd).length,
  }
}
