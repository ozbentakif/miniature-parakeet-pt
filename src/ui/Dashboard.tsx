// Feature 1: every campaign in one place, the attention queue, and the replay of the month with WDS running.

import { useMemo, useState } from 'react'
import { daysBetween, formatDay } from '../core/dates'
import { count, money, moneyShort, percent } from '../core/format'
import { costPerLead, lastCompleteDay, qualificationRate, roas } from '../core/metrics'
import { impact } from '../core/simulation'
import type { Dataset } from '../core/types'
import CampaignDetail from './CampaignDetail'
import { campaignRows, PERIOD_LABELS, portfolio, roasTone, type CampaignRow, type Period } from './model'
import Queue from './Queue'
import type { Wds } from './useWds'

type SortKey = 'id' | 'platform' | 'spend' | 'leads' | 'cpl' | 'qualRate' | 'roas' | 'net'

const SORT_VALUE: Record<SortKey, (r: CampaignRow) => number | string> = {
  id: (r) => r.campaign.id,
  platform: (r) => r.campaign.platform,
  spend: (r) => r.view.platform.spend,
  leads: (r) => r.view.platform.leads,
  cpl: (r) => r.cpl ?? Infinity,
  qualRate: (r) => r.qualRate ?? Infinity,
  roas: (r) => r.roas ?? Infinity,
  net: (r) => r.net,
}

function ReplayBar({ wds, dataset }: { wds: Wds; dataset: Dataset }) {
  const { sim } = wds
  if (sim.mode === 'live') {
    return (
      <div className="replay-bar">
        <p className="small">
          <strong>WDS went live today.</strong> Want to see what it would have done during July? Replay the month as if it had been running.
        </p>
        <button type="button" className="btn primary" onClick={wds.startReplay}>Replay July</button>
      </div>
    )
  }
  const total = daysBetween(sim.startClock, dataset.today)
  const done = daysBetween(sim.startClock, sim.clock)
  const atEnd = sim.clock >= dataset.today
  return (
    <div className="replay-bar active">
      <div className="replay-info">
        <strong>Replay · sync of {formatDay(sim.clock)}</strong>
        <span className="small muted">Live WDS syncs hourly. The data is daily, so the replay moves one day per step. Play stops when something needs you.</span>
        <progress max={total} value={done} aria-label="Replay progress" />
      </div>
      <div className="actions">
        {wds.playing ? (
          <button type="button" className="btn primary" onClick={wds.stop}>Pause</button>
        ) : (
          <button type="button" className="btn primary" onClick={wds.play} disabled={atEnd}>Play</button>
        )}
        <button type="button" className="btn" onClick={wds.step} disabled={atEnd || wds.playing}>Next day</button>
        <button type="button" className="btn" onClick={wds.jumpToToday} disabled={atEnd}>Jump to today</button>
        <button type="button" className="btn ghost" onClick={wds.startReplay}>Restart</button>
        <button type="button" className="btn ghost" onClick={wds.goLive}>Exit replay</button>
      </div>
    </div>
  )
}

export default function Dashboard({ wds, dataset }: { wds: Wds; dataset: Dataset }) {
  const { sim } = wds
  const [period, setPeriod] = useState<Period>(14)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'roas', dir: 1 })
  const [selected, setSelected] = useState<string | null>(null)

  const rows = useMemo(() => campaignRows(dataset, sim, period), [dataset, sim, period])
  const totals = useMemo(() => portfolio(rows), [rows])
  const sorted = useMemo(() => {
    const value = SORT_VALUE[sort.key]
    return [...rows].sort((a, b) => {
      const va = value(a)
      const vb = value(b)
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir
    })
  }, [rows, sort])
  const effect = useMemo(() => impact(sim, dataset), [sim, dataset])
  const selectedCampaign = dataset.campaigns.find((c) => c.id === selected)

  const header = (key: SortKey, label: string, numeric = true, title?: string) => (
    <th className={numeric ? 'num' : ''} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} title={title}>
      <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : 1 }))}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  )

  const portfolioRoas = roas(totals.complete)
  const completeTo = formatDay(lastCompleteDay(sim.clock))

  return (
    <>
      <ReplayBar wds={wds} dataset={dataset} />

      <div className="toolbar">
        <h2>Portfolio</h2>
        <div className="segmented" role="group" aria-label="Period">
          {([7, 14, 'all'] as Period[]).map((p) => (
            <button type="button" key={String(p)} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>{PERIOD_LABELS[String(p)]}</button>
          ))}
        </div>
      </div>

      <div className="cards">
        <div className="card"><span className="label">Spend</span><span className="value">{moneyShort(totals.platform.spend)}</span></div>
        <div className="card"><span className="label">Leads</span><span className="value">{count(totals.platform.leads)}</span></div>
        <div className="card"><span className="label">Cost per lead</span><span className="value">{money(costPerLead(totals.platform) ?? 0, 2)}</span></div>
        <div className="card"><span className="label">Qualification rate</span><span className="value">{percent(qualificationRate(totals.complete))}</span></div>
        <div className={`card tone-${roasTone(portfolioRoas)}`}><span className="label">ROAS</span><span className="value">{percent(portfolioRoas)}</span></div>
        <div className={`card ${totals.losers > 0 ? 'tone-bad' : ''}`}>
          <span className="label">Lost on campaigns below 100%</span>
          <span className="value">{moneyShort(-totals.lossOnLosers)}</span>
          <span className="small muted">{totals.losers} campaign{totals.losers === 1 ? '' : 's'}</span>
        </div>
      </div>
      <p className="small muted footnote">Qualification rate, ROAS and losses use fully qualified days only (up to {completeTo}). ROAS = ${55} × qualified leads ÷ spend; 100% is break-even.</p>

      {sim.mode === 'replay' && sim.pauses.length > 0 && (
        <div className="impact">
          <div><span className="label">Loss avoided by pauses so far</span><strong className="good">{money(effect.lossAvoided)}</strong></div>
          <div><span className="label">Profit given up by pauses so far</span><strong className={effect.profitGivenUp > 0 ? 'bad' : ''}>{money(effect.profitGivenUp)}</strong></div>
          <p className="small muted">
            Measured on the days each campaign was paused, with the full qualification data. A pause that stays on after the problem is fixed gives up profit, so undo it once leads recover.
          </p>
        </div>
      )}

      <Queue items={sim.queue} act={wds.act} openCampaign={setSelected} />

      <section className="panel" aria-labelledby="campaigns-title">
        <div className="panel-head">
          <h2 id="campaigns-title">Campaigns <span className="count">{rows.length}</span></h2>
          <span className="small muted">Select a campaign for its daily history.</span>
        </div>
        <div className="table-wrap">
          <table className="campaigns">
            <thead>
              <tr>
                {header('id', 'Campaign', false)}
                {header('platform', 'Platform', false)}
                <th>Status</th>
                {header('spend', 'Spend')}
                {header('leads', 'Leads')}
                {header('cpl', 'Cost per lead')}
                {header('qualRate', 'Qualified', true, 'Share of leads that qualified (complete days)')}
                {header('roas', 'ROAS', true, 'Complete days only')}
                {header('net', 'Profit', true, '$55 × qualified leads − spend (complete days)')}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.campaign.id} className={r.status.tone === 'muted' ? 'dim' : ''} onClick={() => setSelected(r.campaign.id)}>
                  <td>
                    <button type="button" className="link" onClick={(e) => { e.stopPropagation(); setSelected(r.campaign.id) }}>{r.campaign.id}</button>
                    {r.openItems.length > 0 && <span className="dot" title={`${r.openItems.length} open item(s)`} />}
                  </td>
                  <td>{r.campaign.platform}</td>
                  <td><span className={`pill tone-${r.status.tone}`}>{r.status.label}</span></td>
                  <td className="num">{money(r.view.platform.spend)}</td>
                  <td className="num">{count(r.view.platform.leads)}</td>
                  <td className="num">{r.cpl == null ? '–' : money(r.cpl, 2)}</td>
                  <td className="num">{percent(r.qualRate)}</td>
                  <td className={`num strong tone-text-${roasTone(r.roas)}`}>{percent(r.roas)}</td>
                  <td className={`num ${r.net < 0 ? 'tone-text-bad' : ''}`}>{money(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedCampaign && (
        <CampaignDetail campaign={selectedCampaign} row={rows.find((r) => r.campaign.id === selected)} sim={sim} act={wds.act} onClose={() => setSelected(null)} />
      )}
    </>
  )
}
