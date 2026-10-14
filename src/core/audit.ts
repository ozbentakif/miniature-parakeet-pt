// Audit log events. Every user action and system event is recorded with who, when and what it was based on.

export type Actor = 'WDS' | 'You'

export type EventType =
  | 'data-loaded'
  | 'row-rejected'
  | 'sync'
  | 'data-flagged'
  | 'flag-reviewed'
  | 'warning'
  | 'alert'
  | 'approval-requested'
  | 'approved'
  | 'declined'
  | 'auto-paused'
  | 'paused'
  | 'resumed'
  | 'silenced'
  | 'condition-cleared'
  | 'rule-saved'
  | 'rule-tested'
  | 'replay-started'

export const EVENT_LABELS: Record<EventType, string> = {
  'data-loaded': 'Data loaded',
  'row-rejected': 'Row rejected',
  sync: 'Sync',
  'data-flagged': 'Data flagged',
  'flag-reviewed': 'Flag reviewed',
  warning: 'Warning',
  alert: 'Alert',
  'approval-requested': 'Approval requested',
  approved: 'Approved',
  declined: 'Declined',
  'auto-paused': 'Paused automatically',
  paused: 'Paused',
  resumed: 'Resumed',
  silenced: 'Silenced',
  'condition-cleared': 'Condition cleared',
  'rule-saved': 'Rule saved',
  'rule-tested': 'Rule tested',
  'replay-started': 'Replay started',
}

export interface AuditEvent {
  id: number
  /** Simulated date and time, "2026-07-14T01:00". */
  at: string
  actor: Actor
  type: EventType
  campaignId?: string
  ruleId?: string
  ruleName?: string
  message: string
  /** The data the decision was based on. */
  detail?: string
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function auditToCsv(events: readonly AuditEvent[]): string {
  const header = ['time', 'actor', 'event', 'campaign', 'rule', 'message', 'based_on']
  const lines = events.map((e) =>
    [e.at.replace('T', ' '), e.actor, EVENT_LABELS[e.type], e.campaignId ?? '', e.ruleName ?? '', e.message, e.detail ?? ''].map(csvCell).join(','),
  )
  return [header.join(','), ...lines].join('\n') + '\n'
}
