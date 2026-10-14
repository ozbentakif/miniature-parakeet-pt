// Builds small datasets for tests. Not used by the app.

import { loadDataset } from './data'
import { addDays } from './dates'
import type { Dataset } from './types'

export interface DaySpec {
  spend?: number
  clicks?: number
  leads?: number
  qualified?: number
}

/**
 * One campaign per entry. Each day defaults to about $500 spend, 500 clicks, 25 leads and 15 qualified (ROAS about 165%).
 * Qualified leads are capped at the day's leads.
 * `days` overrides specific day indexes (0 = first day).
 */
export function makeDataset(
  campaigns: { id: string; platform?: string; length?: number; startOffset?: number; days?: Record<number, DaySpec>; base?: DaySpec }[],
  start = '2026-07-01',
): Dataset {
  const lines = ['date,campaign_id,platform,spend,clicks,leads,qualified_leads']
  for (const c of campaigns) {
    const length = c.length ?? 30
    for (let i = 0; i < length; i++) {
      // Spend alternates by $1 so consecutive days are never identical (identical days are flagged as frozen data).
      const d = { clicks: 500, leads: 25, qualified: 15, ...c.base, ...c.days?.[i] }
      d.spend = (c.days?.[i]?.spend ?? c.base?.spend ?? 500) + (c.days?.[i]?.spend == null ? i % 2 : 0)
      // Qualified leads can never exceed leads.
      d.qualified = Math.min(d.qualified, d.leads)
      lines.push([addDays(start, (c.startOffset ?? 0) + i), c.id, c.platform ?? 'Meta', d.spend, d.clicks, d.leads, d.qualified].join(','))
    }
  }
  const { dataset, error } = loadDataset(lines.join('\n'), 'test.csv')
  if (!dataset) throw new Error(error)
  return dataset
}
