// Turns an uploaded CSV into a validated dataset. Impossible rows are rejected with a reason rather than silently fixed.

import { parseCsv, toNumber } from './csv'
import { addDays, isIsoDate } from './dates'
import { PLATFORMS, type Campaign, type Dataset, type DayRow, type Platform } from './types'

export const REQUIRED_COLUMNS = ['date', 'campaign_id', 'platform', 'spend', 'clicks', 'leads', 'qualified_leads'] as const

export interface RejectedRow {
  /** Line in the file, counting the header as line 1. */
  line: number
  campaignId: string
  date: string
  reason: string
}

export interface LoadResult {
  dataset: Dataset | null
  rejected: RejectedRow[]
  /** Set when the whole file is unusable. */
  error?: string
}

function platformOf(value: string): Platform | null {
  return PLATFORMS.find((p) => p.toLowerCase() === value.trim().toLowerCase()) ?? null
}

export function loadDataset(text: string, fileName: string): LoadResult {
  const table = parseCsv(text)
  const missing = REQUIRED_COLUMNS.filter((c) => !table.headers.includes(c))
  if (missing.length > 0) {
    return { dataset: null, rejected: [], error: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` }
  }

  const rejected: RejectedRow[] = []
  const rows: DayRow[] = []
  const seen = new Set<string>()
  const platformById = new Map<string, Platform>()

  table.rows.forEach((raw, i) => {
    const line = i + 2
    const date = raw.date
    const campaignId = raw.campaign_id
    const reject = (reason: string) => {
      rejected.push({ line, campaignId, date, reason })
    }

    if (!isIsoDate(date)) return reject(`Date "${date}" is not a valid YYYY-MM-DD date.`)
    if (!campaignId) return reject('Campaign ID is empty.')
    const platform = platformOf(raw.platform)
    if (!platform) return reject(`Platform "${raw.platform}" is not Meta, Google or TikTok.`)

    const spend = toNumber(raw.spend)
    const clicks = toNumber(raw.clicks)
    const leads = toNumber(raw.leads)
    const qualifiedLeads = toNumber(raw.qualified_leads)
    if (spend == null || clicks == null || leads == null || qualifiedLeads == null) return reject('A number is missing or not numeric.')
    if (spend < 0 || clicks < 0 || leads < 0 || qualifiedLeads < 0) return reject('Negative values are impossible.')
    if (![clicks, leads, qualifiedLeads].every(Number.isInteger)) return reject('Clicks and leads must be whole numbers.')
    if (qualifiedLeads > leads) return reject(`More qualified leads (${qualifiedLeads}) than leads (${leads}).`)
    if (leads > clicks) return reject(`More leads (${leads}) than clicks (${clicks}).`)

    const key = `${campaignId}|${date}`
    if (seen.has(key)) return reject('Duplicate row: this campaign already has data for this date.')
    const known = platformById.get(campaignId)
    if (known && known !== platform) return reject(`Campaign is on ${known} in earlier rows, not ${platform}.`)

    seen.add(key)
    platformById.set(campaignId, platform)
    rows.push({ date, campaignId, platform, spend, clicks, leads, qualifiedLeads })
  })

  if (rows.length === 0) return { dataset: null, rejected, error: 'The file has no valid rows.' }

  rows.sort((a, b) => (a.date === b.date ? a.campaignId.localeCompare(b.campaignId) : a.date < b.date ? -1 : 1))

  const grouped = new Map<string, DayRow[]>()
  for (const r of rows) {
    const list = grouped.get(r.campaignId)
    if (list) list.push(r)
    else grouped.set(r.campaignId, [r])
  }
  const firstDate = rows[0].date
  const lastDate = rows[rows.length - 1].date
  const campaigns: Campaign[] = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([id, list]) => ({
      id,
      platform: list[0].platform,
      firstDate: list[0].date,
      lastDate: list[list.length - 1].date,
      startedBeforeFile: list[0].date === firstDate,
      rows: list,
      byDate: new Map(list.map((r) => [r.date, r])),
    }))

  return {
    dataset: { fileName, rows, campaigns, firstDate, lastDate, today: addDays(lastDate, 2) },
    rejected,
  }
}
