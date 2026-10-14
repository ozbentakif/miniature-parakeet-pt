// Irregular-data checks. A flag stops rules acting on that campaign's data for that day until a buyer reviews it.

import { addDays } from './dates'
import { PLATFORMS, type Dataset } from './types'

export type FlagKind = 'frozen' | 'platform-drop' | 'gap'

export interface DataFlag {
  /** Stable id, used to record that a buyer reviewed it. */
  key: string
  campaignId: string
  /** The data day the flag is about. */
  date: string
  kind: FlagKind
  message: string
}

/** A lead drop counts towards a platform-wide drop when leads fall below this share of the 7-day average. */
const PLATFORM_DROP_SHARE = 0.2
const PLATFORM_DROP_MIN_CAMPAIGNS = 3

export function detectFlags(dataset: Dataset): DataFlag[] {
  const flags: DataFlag[] = []
  const add = (campaignId: string, date: string, kind: FlagKind, message: string) =>
    flags.push({ key: `${kind}|${campaignId}|${date}`, campaignId, date, kind, message })

  for (const c of dataset.campaigns) {
    for (let d = addDays(c.firstDate, 1); d <= c.lastDate; d = addDays(d, 1)) {
      const row = c.byDate.get(d)
      const prev = c.byDate.get(addDays(d, -1))
      if (!row) {
        add(c.id, d, 'gap', 'No data for this day, although the campaign has data before and after it.')
      } else if (prev && row.spend > 0 && row.spend === prev.spend && row.clicks === prev.clicks && row.leads === prev.leads) {
        add(c.id, d, 'frozen', 'Spend, clicks and leads are identical to the day before. The platform data may be frozen.')
      }
    }
  }

  // Many campaigns on one platform losing their leads on the same day points to a tracking or platform fault, not to the campaigns.
  for (const date of new Set(dataset.rows.map((r) => r.date))) {
    for (const platform of PLATFORMS) {
      const eligible = dataset.campaigns.filter((c) => c.platform === platform && c.byDate.has(date))
      const dropped = eligible.filter((c) => {
        const baseline = [1, 2, 3, 4, 5, 6, 7].map((k) => c.byDate.get(addDays(date, -k))).filter((r) => r != null)
        if (baseline.length < 5) return false
        const avg = baseline.reduce((s, r) => s + r.leads, 0) / baseline.length
        return avg > 0 && c.byDate.get(date)!.leads < PLATFORM_DROP_SHARE * avg
      })
      if (dropped.length >= PLATFORM_DROP_MIN_CAMPAIGNS && dropped.length * 2 >= eligible.length) {
        for (const c of dropped) {
          add(c.id, date, 'platform-drop', `${dropped.length} of ${eligible.length} ${platform} campaigns lost most of their leads on the same day. This looks like a tracking or platform fault.`)
        }
      }
    }
  }

  return flags.sort((a, b) => (a.date === b.date ? a.campaignId.localeCompare(b.campaignId) : a.date < b.date ? -1 : 1))
}
