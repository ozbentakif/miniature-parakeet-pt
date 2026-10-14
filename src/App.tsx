import { useEffect, useState } from 'react'
import { addDays, formatDay, formatDayLong, weekday } from './core/dates'
import { lastCompleteDay } from './core/metrics'
import Dashboard from './ui/Dashboard'
import Inbox from './ui/Inbox'
import { useWds } from './ui/useWds'

const TABS = [
  { id: 'dashboard', label: 'Dashboard', enabled: true },
  { id: 'inbox', label: 'Inbox', enabled: true },
  // Shown so the full product is visible, but not built in this prototype.
  { id: 'rules', label: 'Rules', enabled: false },
  { id: 'log', label: 'Audit log', enabled: false },
] as const
type TabId = (typeof TABS)[number]['id']

function tabFromHash(): TabId {
  const id = window.location.hash.slice(1)
  return TABS.some((t) => t.enabled && t.id === id) ? (id as TabId) : 'dashboard'
}

export default function App() {
  const wds = useWds()
  const [tab, setTab] = useState<TabId>(tabFromHash)
  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const { dataset, sim } = wds
  const openItems = sim.queue.filter((q) => q.status === 'open').length
  const platformTo = dataset ? (addDays(sim.clock, -1) <= dataset.lastDate ? addDays(sim.clock, -1) : dataset.lastDate) : null

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">W</span>
          <div>
            <h1>WDS</h1>
            <p className="muted small">Wise Digital-Marketing Spending · prototype</p>
          </div>
        </div>
        {dataset && sim.clock && (
          <dl className="status">
            <div>
              <dt>{sim.mode === 'replay' ? 'Replay day' : 'Today'}</dt>
              <dd>{weekday(sim.clock)} {formatDayLong(sim.clock)}</dd>
            </div>
            <div>
              <dt>Last sync</dt>
              <dd>01:00 · hourly</dd>
            </div>
            <div>
              <dt>Platform data</dt>
              <dd>to {platformTo && formatDay(platformTo)}</dd>
            </div>
            <div>
              <dt>Qualification</dt>
              <dd>complete to {formatDay(lastCompleteDay(sim.clock))} <span className="pill tone-good">on time</span></dd>
            </div>
          </dl>
        )}
      </header>

      <p className="notice small">
        Simulated: data comes from a CSV, and pauses, alerts and approvals are not sent anywhere. {dataset?.fileName === 'sample.csv' ? 'You are looking at synthetic sample data. Drop your own extract into the Inbox to use it.' : ''}
      </p>

      <nav className="tabs" aria-label="Sections">
        {TABS.map((t) =>
          t.enabled ? (
            <a key={t.id} href={`#${t.id}`} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined}>
              {t.label}
              {t.id === 'dashboard' && openItems > 0 && <span className="count">{openItems}</span>}
            </a>
          ) : (
            <span key={t.id} className="disabled" aria-disabled="true" title="Not part of this prototype">
              {t.label}
            </span>
          ),
        )}
      </nav>

      <main>
        {tab === 'inbox' && <Inbox wds={wds} />}
        {tab !== 'inbox' && !dataset && (
          <section className="panel">
            <p className="muted empty">Loading the sample data… If nothing appears, add a CSV in the <a href="#inbox">Inbox</a>.</p>
          </section>
        )}
        {tab === 'dashboard' && dataset && <Dashboard wds={wds} dataset={dataset} />}
      </main>
    </div>
  )
}
