// A small daily chart in plain SVG: bars and lines over dates, shaded ranges and event markers.

import { formatDay } from '../core/dates'

export interface Series {
  label: string
  kind: 'bar' | 'line'
  values: (number | null)[]
  /** CSS colour, usually a variable. */
  color: string
  dashed?: boolean
}

export interface Shade {
  from: number
  to: number
  label: string
  className: string
}

export interface Marker {
  index: number
  label: string
  tone: 'bad' | 'warn' | 'info'
}

interface Props {
  title: string
  days: string[]
  series: Series[]
  shades?: Shade[]
  markers?: Marker[]
  format: (v: number) => string
}

const W = 640
const H = 190
const PAD = { top: 14, right: 8, bottom: 22, left: 52 }

function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v
}

export default function Chart({ title, days, series, shades = [], markers = [], format }: Props) {
  const n = days.length
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v != null))))
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const step = innerW / Math.max(1, n)
  const x = (i: number) => PAD.left + step * i + step / 2
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH
  const barSeries = series.filter((s) => s.kind === 'bar')
  const barW = Math.max(2, (step * 0.7) / Math.max(1, barSeries.length))
  const labelEvery = Math.ceil(n / 8)

  return (
    <figure className="chart">
      <figcaption>
        <span>{title}</span>
        <span className="legend">
          {series.map((s) => (
            <span key={s.label}>
              <i style={{ background: s.color }} className={s.kind === 'line' ? (s.dashed ? 'dash' : 'line') : 'bar'} />
              {s.label}
            </span>
          ))}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {shades.map((s) => (
          <g key={`${s.label}${s.from}`}>
            <rect className={s.className} x={PAD.left + step * s.from} y={PAD.top} width={step * (s.to - s.from + 1)} height={innerH} />
            <text className="shade-label" x={PAD.left + step * s.from + 4} y={PAD.top + 11}>{s.label}</text>
          </g>
        ))}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(max * f)} y2={y(max * f)} />
            <text className="axis" x={PAD.left - 6} y={y(max * f) + 4} textAnchor="end">{format(max * f)}</text>
          </g>
        ))}
        {barSeries.map((s, si) =>
          s.values.map((v, i) =>
            v == null ? null : (
              <rect key={`${s.label}${i}`} x={x(i) - (barW * barSeries.length) / 2 + barW * si} y={y(v)} width={barW} height={Math.max(0, y(0) - y(v))} fill={s.color} rx={1}>
                <title>{`${formatDay(days[i])}: ${s.label} ${format(v)}`}</title>
              </rect>
            ),
          ),
        )}
        {series
          .filter((s) => s.kind === 'line')
          .map((s) => {
            // Break the line where values are missing.
            const segments: string[] = []
            let current = ''
            s.values.forEach((v, i) => {
              if (v == null) {
                if (current) segments.push(current)
                current = ''
              } else current += `${current ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
            })
            if (current) segments.push(current)
            return segments.map((d, k) => (
              <path key={`${s.label}${k}`} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '4 3' : undefined} />
            ))
          })}
        {markers.map((m) => (
          <g key={`${m.label}${m.index}`} className={`marker ${m.tone}`}>
            <line x1={x(m.index)} x2={x(m.index)} y1={PAD.top} y2={PAD.top + innerH} />
            <circle cx={x(m.index)} cy={PAD.top + 2} r={3.5}>
              <title>{`${formatDay(days[m.index])}: ${m.label}`}</title>
            </circle>
          </g>
        ))}
        {days.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={d} className="axis" x={x(i)} y={H - 6} textAnchor="middle">{formatDay(d)}</text>
          ) : null,
        )}
      </svg>
    </figure>
  )
}
