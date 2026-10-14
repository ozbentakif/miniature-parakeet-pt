// One campaign's daily history, the rule events on it, and manual pause or resume with a one-click reason.

import { useEffect, useState } from 'react'
import { dateRange, formatDay } from '../core/dates'
import { count, money, percent } from '../core/format'
import { FEE_PER_QUALIFIED_LEAD, lastCompleteDay, lastPlatformDay } from '../core/metrics'
import { isPaused, type SimState } from '../core/simulation'
import { canWrite, type Campaign } from '../core/types'
import Chart, { type Marker, type Shade } from './Chart'
import type { CampaignRow } from './model'
import type { UserAction } from './useWds'

const PAUSE_REASONS = ['Poor lead quality', 'Tracking issue', 'Client request', 'Testing a change']
const RESUME_REASONS = ['Problem fixed', 'Leads recovered', 'Client request', 'Paused by mistake']

interface Props {
  campaign: Campaign
  row: CampaignRow | undefined
  sim: SimState
  act: (a: UserAction) => void
  onClose: () => void
}

export default function CampaignDetail({ campaign, row, sim, act, onClose }: Props) {
  const [choosing, setChoosing] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const end = lastPlatformDay(sim.clock)
  const complete = lastCompleteDay(sim.clock)
  const days = campaign.firstDate <= end ? dateRange(campaign.firstDate, end < campaign.lastDate ? end : campaign.lastDate) : []
  const rows = days.map((d) => campaign.byDate.get(d))
  const revenue = days.map((d, i) => (d <= complete && rows[i] ? FEE_PER_QUALIFIED_LEAD * rows[i]!.qualifiedLeads : null))
  const avg7 = days.map((_, i) => {
    const prev = rows.slice(Math.max(0, i - 7), i).filter((r) => r != null)
    return prev.length >= 5 ? prev.reduce((s, r) => s + r!.leads, 0) / prev.length : null
  })

  const pendingFrom = days.findIndex((d) => d > complete)
  const shades: Shade[] = []
  if (pendingFrom >= 0) shades.push({ from: pendingFrom, to: days.length - 1, label: 'Qualification pending', className: 'shade-pending' })
  for (const p of sim.pauses.filter((p) => p.campaignId === campaign.id)) {
    const from = days.indexOf(p.from)
    if (from < 0) continue
    const to = p.to ? days.indexOf(p.to) - 1 : days.length - 1
    shades.push({ from, to: to < from ? from : to, label: `Paused (${p.by === 'WDS' ? 'rule' : 'you'})`, className: 'shade-paused' })
  }
  const markers: Marker[] = sim.queue
    .filter((q) => q.campaignId === campaign.id && q.kind !== 'flag')
    .map((q) => ({ index: days.indexOf(q.clock) >= 0 ? days.indexOf(q.clock) : days.length - 1, label: `${q.title} (${q.ruleName ?? ''})`, tone: q.kind === 'auto-paused' ? 'bad' as const : 'warn' as const }))

  const paused = isPaused(sim, campaign.id)
  const writable = canWrite(campaign.platform)
  const history = sim.events.filter((e) => e.campaignId === campaign.id).slice(-8).reverse()

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="detail-title" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2 id="detail-title">{campaign.id}</h2>
            <p className="muted small">{campaign.platform} · first data {formatDay(campaign.firstDate)} · owner: You</p>
          </div>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {row && (
          <dl className="stats">
            <div><dt>Spend</dt><dd>{money(row.view.platform.spend)}</dd></div>
            <div><dt>Leads</dt><dd>{count(row.view.platform.leads)}</dd></div>
            <div><dt>Cost per lead</dt><dd>{row.cpl == null ? '–' : money(row.cpl, 2)}</dd></div>
            <div><dt>Qualified</dt><dd>{percent(row.qualRate)}</dd></div>
            <div><dt>ROAS</dt><dd className={row.roas != null && row.roas < 1 ? 'bad' : ''}>{percent(row.roas)}</dd></div>
          </dl>
        )}

        <Chart
          title="Spend and revenue per day"
          days={days}
          format={(v) => money(v)}
          shades={shades}
          markers={markers}
          series={[
            { label: 'Spend', kind: 'bar', values: rows.map((r) => r?.spend ?? null), color: 'var(--series-1)' },
            { label: `Revenue ($${FEE_PER_QUALIFIED_LEAD} × qualified)`, kind: 'line', values: revenue, color: 'var(--series-2)' },
          ]}
        />
        <Chart
          title="Leads per day"
          days={days}
          format={(v) => count(v)}
          markers={markers}
          series={[
            { label: 'Leads', kind: 'bar', values: rows.map((r) => r?.leads ?? null), color: 'var(--series-3)' },
            { label: '7-day average', kind: 'line', values: avg7, color: 'var(--muted)', dashed: true },
          ]}
        />

        <div className="detail-actions">
          {!writable && <p className="small muted">TikTok is read-only. Pause or resume this campaign in TikTok; WDS sees the change at the next sync.</p>}
          {writable && !choosing && (
            <button type="button" className={`btn ${paused ? 'primary' : ''}`} onClick={() => setChoosing(true)}>
              {paused ? 'Resume campaign…' : 'Pause campaign…'}
            </button>
          )}
          {writable && choosing && (
            <div className="reasons" role="group" aria-label="Reason">
              <span className="small muted">Reason:</span>
              {(paused ? RESUME_REASONS : PAUSE_REASONS).map((r) => (
                <button
                  type="button"
                  key={r}
                  className="chip"
                  onClick={() => {
                    act(paused ? { type: 'resume', campaignId: campaign.id, reason: r } : { type: 'pause', campaignId: campaign.id, reason: r })
                    setChoosing(false)
                  }}
                >
                  {r}
                </button>
              ))}
              <button type="button" className="chip ghost" onClick={() => setChoosing(false)}>Cancel</button>
            </div>
          )}
          <p className="small muted">Pausing and resuming are simulated. Nothing is sent to an ad platform.</p>
        </div>

        {history.length > 0 && (
          <section>
            <h3>Recent log entries</h3>
            <ul className="mini-log">
              {history.map((e) => (
                <li key={e.id}>
                  <span className="muted small">{formatDay(e.at.slice(0, 10))} {e.at.slice(11)} · {e.actor}</span>
                  <span>{e.message}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  )
}
