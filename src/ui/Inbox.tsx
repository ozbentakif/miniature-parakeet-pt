// The qualification file drop location. Files placed here are read at the next sync; manual upload reads at once.

import { useEffect, useState } from 'react'
import { formatDay } from '../core/dates'
import { count } from '../core/format'
import { DEMO_SYNC_SECONDS, type InboxFile, type Wds } from './useWds'

const time = (d: Date) => d.toTimeString().slice(0, 5)

function Countdown({ from }: { from: Date }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])
  const left = Math.max(0, Math.ceil(DEMO_SYNC_SECONDS - (now - from.getTime()) / 1000))
  return <span>Waiting for the next sync ({left}s)</span>
}

function FileStatus({ f, activeId }: { f: InboxFile; activeId: number | null }) {
  if (f.status === 'waiting') return <span className="pill tone-info"><Countdown from={f.addedAt} /></span>
  if (f.status === 'failed') return <span className="pill tone-bad">Not read: {f.result?.error}</span>
  return <span className={`pill tone-${f.id === activeId ? 'good' : 'muted'}`}>{f.id === activeId ? 'In use' : 'Read'}</span>
}

export default function Inbox({ wds }: { wds: Wds }) {
  const [dragging, setDragging] = useState(false)
  const { files, active, dataset, flags } = wds

  async function take(list: FileList | null | undefined, source: 'inbox' | 'upload') {
    for (const file of Array.from(list ?? [])) wds.addFile(file.name, await file.text(), source)
  }

  const result = active?.result

  return (
    <>
      <section className="panel">
        <h2>Qualification file inbox</h2>
        <p className="small muted">
          In the live system the client's qualification file lands in a fixed folder and WDS reads it at every hourly sync. Here, drop a CSV into the inbox: the next sync (shortened to {DEMO_SYNC_SECONDS} seconds for the demo) reads it, validates it and restarts the dashboard on that data.
        </p>
        <label
          className={`dropzone${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); void take(e.dataTransfer.files, 'inbox') }}
        >
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => { void take(e.target.files, 'inbox'); e.target.value = '' }} />
          <strong>Drop a CSV into the inbox</strong>
          <span className="small muted">or click to choose one. Columns: date, campaign_id, platform, spend, clicks, leads, qualified_leads</span>
        </label>
        <p className="small">
          Fallback:{' '}
          <label className="link">
            upload and read now
            <input type="file" accept=".csv,text/csv" hidden onChange={(e) => { void take(e.target.files, 'upload'); e.target.value = '' }} />
          </label>
          . Files are read in your browser and never uploaded anywhere.
        </p>
      </section>

      <section className="panel">
        <h2>Files</h2>
        {files.length === 0 && <p className="muted empty">No files yet.</p>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>File</th><th>Arrived</th><th>How</th><th>Status</th><th className="num">Rows</th><th className="num">Rejected</th><th /></tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td>{f.name}{f.source === 'sample' && <span className="small muted"> (synthetic sample)</span>}</td>
                  <td>{time(f.addedAt)}</td>
                  <td>{f.source === 'upload' ? 'Manual upload' : f.source === 'sample' ? 'Preloaded' : 'Inbox'}</td>
                  <td><FileStatus f={f} activeId={active?.id ?? null} /></td>
                  <td className="num">{f.result?.dataset ? count(f.result.dataset.rows.length) : '–'}</td>
                  <td className="num">{f.result ? f.result.rejected.length : '–'}</td>
                  <td>{f.status === 'waiting' && <button type="button" className="btn small" onClick={() => wds.readFile(f.id)}>Read now</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {dataset && result && (
        <section className="panel">
          <h2>Validation of {dataset.fileName}</h2>
          <p className="small">
            {count(dataset.rows.length)} rows accepted: {dataset.campaigns.length} campaigns, {formatDay(dataset.firstDate)} to {formatDay(dataset.lastDate)}. Today is treated as {formatDay(dataset.today)}.
          </p>
          {result.rejected.length === 0 ? (
            <p className="small muted">No rows rejected.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Line</th><th>Campaign</th><th>Date</th><th>Why it was rejected</th></tr></thead>
                <tbody>
                  {result.rejected.map((r) => (
                    <tr key={r.line}><td>{r.line}</td><td>{r.campaignId}</td><td>{r.date}</td><td className="wrap">{r.reason}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3>Irregular data</h3>
          {flags.length === 0 ? (
            <p className="small muted">No frozen data, gaps or platform-wide lead drops found.</p>
          ) : (
            <ul className="mini-log">
              {flags.map((f) => (
                <li key={f.key}><span className="muted small">{formatDay(f.date)} · {f.campaignId}</span><span>{f.message}</span></li>
              ))}
            </ul>
          )}
          <p className="small muted">Flags are raised on the dashboard at the sync that first sees them. Rules do not act on flagged data until a buyer reviews it.</p>
        </section>
      )}
    </>
  )
}
