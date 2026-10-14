// "Needs your attention": approval requests, automated pauses, alerts, warnings and flags, each with its one-click responses.

import { useState } from 'react'
import { formatDay } from '../core/dates'
import type { QueueItem } from '../core/simulation'
import type { UserAction } from './useWds'

const DECLINE_REASONS = ['I know this account: keep it running', 'Results are still coming in', 'Client promotion running', 'Fixing it another way']

const KIND_TONE: Record<QueueItem['kind'], string> = {
  'auto-paused': 'bad',
  approval: 'warn',
  alert: 'warn',
  warning: 'info',
  flag: 'info',
}

interface Props {
  items: QueueItem[]
  act: (a: UserAction) => void
  openCampaign: (id: string) => void
}

function Item({ item, act, openCampaign }: { item: QueueItem } & Omit<Props, 'items'>) {
  const [declining, setDeclining] = useState(false)
  const open = item.status === 'open'
  return (
    <li className={`queue-item tone-${KIND_TONE[item.kind]}${open ? '' : ' closed'}`}>
      <div className="queue-head">
        <strong>{item.title}</strong>
        <span className="muted small">{formatDay(item.clock)}</span>
      </div>
      <p className="queue-meta">
        <button type="button" className="link" onClick={() => openCampaign(item.campaignId)}>{item.campaignId}</button>
        {item.ruleName && <span className="muted"> · {item.ruleName}</span>}
      </p>
      <p className="small">{item.detail}</p>
      {!open && item.outcome && <p className="small outcome">{item.outcome}</p>}
      {open && (
        <div className="actions">
          {item.kind === 'approval' && !declining && (
            <>
              <button type="button" className="btn primary" onClick={() => act({ type: 'approve', itemId: item.id })}>Approve pause</button>
              <button type="button" className="btn" onClick={() => setDeclining(true)}>Decline…</button>
            </>
          )}
          {item.kind === 'approval' && declining && (
            <div className="reasons" role="group" aria-label="Reason for declining">
              {DECLINE_REASONS.map((r) => (
                <button type="button" key={r} className="chip" onClick={() => act({ type: 'decline', itemId: item.id, reason: r })}>{r}</button>
              ))}
              <button type="button" className="chip ghost" onClick={() => setDeclining(false)}>Cancel</button>
            </div>
          )}
          {item.kind === 'auto-paused' && (
            <button type="button" className="btn" onClick={() => act({ type: 'undo', itemId: item.id })}>Undo pause</button>
          )}
          {(item.kind === 'alert' || item.kind === 'warning') && (
            <button type="button" className="btn" onClick={() => act({ type: 'silence', itemId: item.id })}>Silence for me</button>
          )}
          {item.kind === 'flag' && (
            <button type="button" className="btn" onClick={() => act({ type: 'review-flag', itemId: item.id })}>Mark reviewed</button>
          )}
        </div>
      )}
    </li>
  )
}

export default function Queue({ items, act, openCampaign }: Props) {
  const [showClosed, setShowClosed] = useState(false)
  const open = items.filter((q) => q.status === 'open').reverse()
  const closed = items.filter((q) => q.status !== 'open').reverse()

  return (
    <section className="panel" aria-labelledby="queue-title">
      <div className="panel-head">
        <h2 id="queue-title">Needs your attention <span className="count">{open.length}</span></h2>
        {closed.length > 0 && (
          <button type="button" className="link small" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? 'Hide' : 'Show'} {closed.length} handled
          </button>
        )}
      </div>
      {open.length === 0 && <p className="muted empty">Nothing waiting. Rules check every campaign at each sync.</p>}
      <ul className="queue">
        {open.map((q) => <Item key={q.id} item={q} act={act} openCampaign={openCampaign} />)}
        {showClosed && closed.map((q) => <Item key={q.id} item={q} act={act} openCampaign={openCampaign} />)}
      </ul>
    </section>
  )
}
