// Buyer-defined rules, the company limits that sit above them, and rule evaluation for one campaign on one day.

import { addDays, formatDay } from './dates'
import type { DataFlag } from './flags'
import { count, money, percent } from './format'
import { costPerLead, lastCompleteDay, lastPlatformDay, qualificationRate, roas, rowsBetween, sumRows, type Totals } from './metrics'
import { canWrite, type Campaign } from './types'

export type Metric = 'spend' | 'clicks' | 'leads' | 'costPerLead' | 'qualificationRate' | 'roas'

interface MetricInfo {
  label: string
  /** Needs qualification results, so it can only use complete days. */
  needsQualification: boolean
  /** Can be compared with the campaign's own 7-day daily average. */
  allowsRelative: boolean
  format: (value: number) => string
}

export const METRICS: Record<Metric, MetricInfo> = {
  spend: { label: 'Spend', needsQualification: false, allowsRelative: true, format: (v) => money(v) },
  clicks: { label: 'Clicks', needsQualification: false, allowsRelative: true, format: (v) => count(v) },
  leads: { label: 'Leads', needsQualification: false, allowsRelative: true, format: (v) => count(v, v % 1 === 0 ? 0 : 1) },
  costPerLead: { label: 'Cost per lead', needsQualification: false, allowsRelative: false, format: (v) => money(v, 2) },
  qualificationRate: { label: 'Qualification rate', needsQualification: true, allowsRelative: false, format: (v) => percent(v) },
  roas: { label: 'ROAS', needsQualification: true, allowsRelative: false, format: (v) => percent(v) },
}

export function metricValue(metric: Metric, t: Totals): number | null {
  switch (metric) {
    case 'spend': return t.spend
    case 'clicks': return t.clicks
    case 'leads': return t.leads
    case 'costPerLead': return costPerLead(t)
    case 'qualificationRate': return qualificationRate(t)
    case 'roas': return roas(t)
  }
}

export type Comparison = 'below' | 'atLeast'

export interface Condition {
  metric: Metric
  comparison: Comparison
  /** An absolute value, or a share of the 7-day daily average when `relative` is true (0.2 = 20%). Ratios such as ROAS are stored as fractions (1 = 100%). */
  value: number
  relative: boolean
}

export type RuleWindow = { kind: 'lastDay' } | { kind: 'completeDays'; days: number }

export type Automation = 'warning' | 'alert' | 'approval' | 'auto'

export const AUTOMATION_LABELS: Record<Automation, string> = {
  warning: 'Dashboard warning only',
  alert: 'Alert',
  approval: 'Ask for approval',
  auto: 'Act automatically',
}

export interface Rule {
  id: string
  name: string
  enabled: boolean
  window: RuleWindow
  /** Minimum spend in the window before the rule can trigger. */
  minSpend: number
  conditions: Condition[]
  /** Only pausing can be automated in the MVP, so every rule's action is "pause". */
  automation: Automation
  /** Severe rules would bypass quiet hours. Notifications are not part of this prototype, so it is shown but has no effect here. */
  severity: 'normal' | 'severe'
  /** Campaign IDs the rule never touches. */
  exceptions: string[]
}

/** Fixed by the company. Buyers cannot loosen them. */
export const COMPANY_LIMITS = {
  /** Rules never act on campaigns with less history than this. */
  minHistoryDays: 14,
  /** Every rule needs at least this much spend in its window. Buyers can only raise it. */
  minSpend: 300,
  /** Days in the "7-day daily average" baseline, and how many must have data. */
  baselineDays: 7,
  minBaselineDays: 5,
}

export const STARTER_RULES: Rule[] = [
  {
    id: 'lead-drop-off',
    name: 'Lead drop-off',
    enabled: true,
    window: { kind: 'lastDay' },
    minSpend: 300,
    conditions: [
      { metric: 'leads', comparison: 'below', value: 0.2, relative: true },
      { metric: 'clicks', comparison: 'atLeast', value: 0.5, relative: true },
    ],
    automation: 'auto',
    severity: 'severe',
    exceptions: [],
  },
  {
    id: 'quality-stop-loss',
    name: 'Quality stop-loss',
    enabled: true,
    window: { kind: 'completeDays', days: 14 },
    minSpend: 1500,
    conditions: [{ metric: 'roas', comparison: 'below', value: 1, relative: false }],
    automation: 'approval',
    severity: 'normal',
    exceptions: [],
  },
]

export function windowLabel(w: RuleWindow): string {
  return w.kind === 'lastDay' ? 'Last 24 hours (last full day)' : `Last ${w.days} fully qualified days`
}

export function describeCondition(c: Condition): string {
  const info = METRICS[c.metric]
  const cmp = c.comparison === 'below' ? 'below' : 'at least'
  if (c.relative) return `${info.label} ${cmp} ${percent(c.value)} of the 7-day daily average`
  return `${info.label} ${cmp} ${info.format(c.value)}`
}

export function describeRule(rule: Rule): string {
  const parts = [`${money(rule.minSpend)}+ spent`, ...rule.conditions.map(describeCondition)]
  return `${windowLabel(rule.window)}: ${parts.join(', ')}.`
}

/** Problems that stop a rule being saved. Empty when the rule is valid. */
export function validateRule(rule: Rule): string[] {
  const errors: string[] = []
  if (!rule.name.trim()) errors.push('Give the rule a name.')
  if (rule.conditions.length === 0) errors.push('Add at least one condition.')
  if (!(rule.minSpend >= COMPANY_LIMITS.minSpend)) errors.push(`Minimum spend must be at least ${money(COMPANY_LIMITS.minSpend)} (company limit).`)
  if (rule.window.kind === 'completeDays' && !(rule.window.days >= 3 && rule.window.days <= 28 && Number.isInteger(rule.window.days))) {
    errors.push('The window must be a whole number of days from 3 to 28.')
  }
  for (const c of rule.conditions) {
    const info = METRICS[c.metric]
    if (!(c.value > 0) || !Number.isFinite(c.value)) errors.push(`${info.label}: enter a value above zero.`)
    if (info.needsQualification && rule.window.kind === 'lastDay') {
      errors.push(`${info.label} needs complete qualification results, so it can only use fully qualified days.`)
    }
    if (c.relative && !info.allowsRelative) errors.push(`${info.label} cannot be compared with a 7-day average.`)
    if (c.relative && rule.window.kind !== 'lastDay') errors.push('Comparisons with the 7-day average only work on the last full day.')
  }
  return errors
}

export type EvaluationStatus = 'clear' | 'triggered' | 'blocked' | 'excluded' | 'paused' | 'no-data'

export interface ObservedCondition {
  condition: Condition
  actual: number | null
  threshold: number | null
  /** The 7-day daily average, for relative conditions. */
  baseline: number | null
  met: boolean
}

export interface Evaluation {
  ruleId: string
  campaignId: string
  clock: string
  status: EvaluationStatus
  from: string
  to: string
  spend: number
  observed: ObservedCondition[]
  /** What WDS does: the rule's level, lowered by the company limits. */
  automation: Automation
  /** Why the company limits lowered or stopped the action. */
  limitNote?: string
}

export interface EvaluationContext {
  paused: boolean
  /** Flags on this campaign's data that no buyer has reviewed yet. */
  unreviewedFlags: readonly DataFlag[]
}

/** Evaluates one rule for one campaign at the hourly sync on day `clock`, using only what was known then. */
export function evaluateRule(rule: Rule, campaign: Campaign, clock: string, ctx: EvaluationContext): Evaluation {
  const to = rule.window.kind === 'lastDay' ? lastPlatformDay(clock) : lastCompleteDay(clock)
  const from = rule.window.kind === 'lastDay' ? to : addDays(to, 1 - rule.window.days)
  const base: Evaluation = { ruleId: rule.id, campaignId: campaign.id, clock, status: 'clear', from, to, spend: 0, observed: [], automation: rule.automation }

  if (rule.exceptions.includes(campaign.id)) return { ...base, status: 'excluded' }
  if (ctx.paused) return { ...base, status: 'paused' }

  // A window that starts before the campaign's first day of data is not full yet.
  if (rule.window.kind === 'completeDays' && from < campaign.firstDate) return { ...base, status: 'no-data' }
  const rows = rowsBetween(campaign, from, to)
  if (rows.length === 0) return { ...base, status: 'no-data' }
  const totals = sumRows(rows)

  const baselineRows = rowsBetween(campaign, addDays(from, -COMPANY_LIMITS.baselineDays), addDays(from, -1))
  const needsBaseline = rule.conditions.some((c) => c.relative)
  if (needsBaseline && baselineRows.length < COMPANY_LIMITS.minBaselineDays) return { ...base, status: 'no-data', spend: totals.spend }
  const baselineTotals = sumRows(baselineRows)

  const observed: ObservedCondition[] = rule.conditions.map((condition) => {
    const actual = metricValue(condition.metric, totals)
    let baseline: number | null = null
    let threshold: number | null = condition.value
    if (condition.relative) {
      const sum = metricValue(condition.metric, baselineTotals)
      baseline = sum == null ? null : sum / baselineRows.length
      threshold = baseline == null ? null : condition.value * baseline
    }
    const unusable = METRICS[condition.metric].needsQualification && rule.window.kind === 'lastDay'
    const met = !unusable && actual != null && threshold != null && (condition.comparison === 'below' ? actual < threshold : actual >= threshold)
    return { condition, actual, threshold, baseline, met }
  })

  const spendOk = totals.spend >= Math.max(rule.minSpend, COMPANY_LIMITS.minSpend)
  const result = { ...base, spend: totals.spend, observed }
  if (!spendOk || !observed.every((o) => o.met)) return result

  // Campaigns already running when the file starts are treated as old enough. In the live system, imported history answers this.
  const history = campaign.rows.filter((r) => r.date <= lastPlatformDay(clock)).length
  if (!campaign.startedBeforeFile && history < COMPANY_LIMITS.minHistoryDays) {
    return { ...result, status: 'blocked', automation: 'warning', limitNote: `Only ${history} days of history. Rules act after ${COMPANY_LIMITS.minHistoryDays} days.` }
  }
  const flag = ctx.unreviewedFlags.find((f) => f.date >= from && f.date <= to)
  if (flag) {
    return { ...result, status: 'blocked', automation: 'warning', limitNote: `Data for ${formatDay(flag.date)} is flagged. A buyer must review it before rules act.` }
  }
  if (!canWrite(campaign.platform) && (rule.automation === 'approval' || rule.automation === 'auto')) {
    return { ...result, status: 'triggered', automation: 'alert', limitNote: 'TikTok is read-only, so WDS can only alert. Pause it in TikTok.' }
  }
  return { ...result, status: 'triggered' }
}

/** One line explaining what the rule saw, e.g. for the audit log. */
export function explainEvaluation(e: Evaluation): string {
  const parts = e.observed.map((o) => {
    const info = METRICS[o.condition.metric]
    const name = o.condition.metric === 'roas' ? 'ROAS' : info.label.toLowerCase()
    const actual = o.actual == null ? '–' : info.format(o.actual)
    if (o.condition.relative && o.baseline != null) return `${name} ${actual} vs 7-day average ${info.format(o.baseline)}`
    return `${name} ${actual}`
  })
  const period = e.from === e.to ? formatDay(e.from) : `${formatDay(e.from)} to ${formatDay(e.to)}`
  return `${period}: ${[`spend ${money(e.spend)}`, ...parts].join(', ')}.`
}
