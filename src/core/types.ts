// Shared data shapes for the engine.

export const PLATFORMS = ['Meta', 'Google', 'TikTok'] as const
export type Platform = (typeof PLATFORMS)[number]

/** TikTok is read-only, so WDS cannot pause there. Rules on TikTok campaigns only warn or alert. */
export const canWrite = (platform: Platform): boolean => platform !== 'TikTok'

/** One campaign on one day, as in the extract. */
export interface DayRow {
  date: string
  campaignId: string
  platform: Platform
  spend: number
  clicks: number
  leads: number
  /** Leads that passed the client's qualification. Known 1 to 3 days after the lead was submitted. */
  qualifiedLeads: number
}

export interface Campaign {
  id: string
  platform: Platform
  firstDate: string
  lastDate: string
  /** True when the campaign has data on the file's first day, so it started before the file and its full history is unknown. */
  startedBeforeFile: boolean
  /** Sorted by date. */
  rows: DayRow[]
  byDate: Map<string, DayRow>
}

export interface Dataset {
  fileName: string
  rows: DayRow[]
  campaigns: Campaign[]
  firstDate: string
  lastDate: string
  /** The prototype treats "today" as two days after the last date in the file. */
  today: string
}
