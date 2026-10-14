// App state: the inbox, the active dataset, the rules and the running simulation.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { AuditEvent } from '../core/audit'
import { loadDataset, type LoadResult } from '../core/data'
import { detectFlags, type DataFlag } from '../core/flags'
import { STARTER_RULES, type Rule } from '../core/rules'
import { emptyState, simReducer, type SimAction, type SimContext, type SimState } from '../core/simulation'
import type { Dataset } from '../core/types'

export interface InboxFile {
  id: number
  name: string
  size: number
  source: 'sample' | 'inbox' | 'upload'
  status: 'waiting' | 'read' | 'failed'
  /** Wall-clock time the file arrived. */
  addedAt: Date
  readAt?: Date
  text: string
  result?: LoadResult
}

/** Seconds until the next "hourly" sync picks up a file in the inbox. Shortened for the demo. */
export const DEMO_SYNC_SECONDS = 4

const RULES_KEY = 'wds.rules.v1'

function loadRules(): Rule[] {
  try {
    const saved = localStorage.getItem(RULES_KEY)
    if (saved) return JSON.parse(saved) as Rule[]
  } catch {
    // Storage can be blocked or empty; the starter rules are the fallback.
  }
  return STARTER_RULES
}

export const nowTime = (): string => new Date().toTimeString().slice(0, 5)

/** Sim actions without the parts the hook fills in. */
export type UserAction =
  | { type: 'approve'; itemId: number }
  | { type: 'decline'; itemId: number; reason: string }
  | { type: 'undo'; itemId: number }
  | { type: 'silence'; itemId: number }
  | { type: 'review-flag'; itemId: number }
  | { type: 'pause'; campaignId: string; reason: string }
  | { type: 'resume'; campaignId: string; reason: string }
  | { type: 'log'; event: Omit<AuditEvent, 'id' | 'at'> }

export function useWds() {
  const [files, setFiles] = useState<InboxFile[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [rules, setRulesState] = useState<Rule[]>(loadRules)
  const [sim, dispatch] = useReducer(simReducer, emptyState(''))
  const [playing, setPlaying] = useState(false)
  const playFrom = useRef('')
  const nextId = useRef(1)

  const active = files.find((f) => f.id === activeId) ?? null
  const dataset: Dataset | null = active?.result?.dataset ?? null
  const flags: DataFlag[] = useMemo(() => (dataset ? detectFlags(dataset) : []), [dataset])
  const ctx: SimContext | null = useMemo(() => (dataset ? { dataset, rules, flags } : null), [dataset, rules, flags])

  // Read a file: validate it, and if it loads, make it the active dataset and restart on "today".
  const filesRef = useRef(files)
  const rulesRef = useRef(rules)
  useEffect(() => {
    filesRef.current = files
    rulesRef.current = rules
  })

  const ingest = useCallback((file: InboxFile) => {
    const result = loadDataset(file.text, file.name)
    const status: InboxFile['status'] = result.dataset ? 'read' : 'failed'
    setFiles((list) => list.map((f) => (f.id === file.id ? { ...f, status, readAt: new Date(), result } : f)))
    if (!result.dataset) return
    setActiveId(file.id)
    setPlaying(false)
    const d = result.dataset
    dispatch({ type: 'start', ctx: { dataset: d, rules: rulesRef.current, flags: detectFlags(d) }, mode: 'live', rejected: result.rejected, time: nowTime() })
  }, [])

  const readFile = useCallback((id: number) => {
    const f = filesRef.current.find((x) => x.id === id && x.status === 'waiting')
    if (f) ingest(f)
  }, [ingest])

  const addFile = useCallback((name: string, text: string, source: InboxFile['source']) => {
    const file: InboxFile = { id: nextId.current++, name, size: text.length, source, status: 'waiting', addedAt: new Date(), text }
    setFiles((list) => [file, ...list])
    if (source !== 'inbox') ingest(file)
  }, [ingest])

  // Files dropped in the inbox are read by the next sync.
  const waiting = files.find((f) => f.status === 'waiting')
  useEffect(() => {
    if (!waiting) return
    const t = setTimeout(() => readFile(waiting.id), DEMO_SYNC_SECONDS * 1000)
    return () => clearTimeout(t)
  }, [waiting, readFile])

  // Load the synthetic sample on first open.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    fetch(`${import.meta.env.BASE_URL}sample.csv`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => addFile('sample.csv', text, 'sample'))
      .catch(() => {
        // Without the sample the inbox simply starts empty.
      })
  }, [addFile])

  const act = useCallback((action: UserAction) => dispatch({ ...action, time: nowTime() } as SimAction), [])

  const startReplay = useCallback(() => {
    if (!ctx || !active?.result) return
    dispatch({ type: 'start', ctx, mode: 'replay', rejected: active.result.rejected, time: nowTime() })
    setPlaying(false)
  }, [ctx, active])

  const goLive = useCallback(() => {
    if (!ctx || !active?.result) return
    dispatch({ type: 'start', ctx, mode: 'live', rejected: active.result.rejected, time: nowTime() })
    setPlaying(false)
  }, [ctx, active])

  const step = useCallback(() => {
    if (ctx) dispatch({ type: 'step', ctx })
  }, [ctx])

  const jumpToToday = useCallback(() => {
    if (!ctx) return
    const days = Math.max(0, Math.round((Date.parse(ctx.dataset.today) - Date.parse(sim.clock)) / 86_400_000))
    for (let i = 0; i < days; i++) dispatch({ type: 'step', ctx })
    setPlaying(false)
  }, [ctx, sim.clock])

  // Play steps one day at a time and stops when something new needs the buyer.
  const play = useCallback(() => {
    playFrom.current = sim.clock
    setPlaying(true)
  }, [sim.clock])

  useEffect(() => {
    if (!playing || !ctx) return
    const needsYou = sim.clock > playFrom.current && sim.queue.some(
      (q) => q.clock === sim.clock && q.status === 'open' && (q.kind === 'approval' || q.kind === 'auto-paused' || q.kind === 'alert'),
    )
    if (needsYou || sim.clock >= ctx.dataset.today) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => dispatch({ type: 'step', ctx }), 700)
    return () => clearTimeout(t)
  }, [playing, ctx, sim.clock, sim.queue])

  const setRules = useCallback((next: Rule[]) => {
    setRulesState(next)
    try {
      localStorage.setItem(RULES_KEY, JSON.stringify(next))
    } catch {
      // Rules still work for this visit without storage.
    }
  }, [])

  const resetDemo = useCallback(() => {
    try {
      localStorage.removeItem(RULES_KEY)
    } catch {
      // Nothing stored.
    }
    setRulesState(STARTER_RULES)
    if (dataset && active?.result) {
      dispatch({ type: 'start', ctx: { dataset, rules: STARTER_RULES, flags }, mode: 'live', rejected: active.result.rejected, time: nowTime() })
    }
    setPlaying(false)
  }, [dataset, flags, active])

  return {
    files,
    active,
    dataset,
    flags,
    rules,
    setRules,
    sim: sim as SimState,
    playing,
    play,
    stop: () => setPlaying(false),
    addFile,
    readFile,
    act,
    startReplay,
    goLive,
    step,
    jumpToToday,
    resetDemo,
  }
}

export type Wds = ReturnType<typeof useWds>
