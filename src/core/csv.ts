// CSV parsing for files loaded in the browser. No dependencies, no DOM access.

export interface CsvTable {
  headers: string[]
  rows: Record<string, string>[]
}

/** Split CSV text into records. Handles quoted fields, escaped quotes, commas and newlines inside quotes, CRLF and a BOM. */
export function parseRecords(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      record.push(field); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      record.push(field); records.push(record)
      record = []; field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || record.length > 0) { record.push(field); records.push(record) }

  // drop blank lines
  return records.filter((r) => !(r.length === 1 && r[0].trim() === ''))
}

/** Parse CSV text with a header row into objects keyed by trimmed header names. */
export function parseCsv(text: string): CsvTable {
  const [head, ...body] = parseRecords(text)
  if (!head) return { headers: [], rows: [] }
  const headers = head.map((h) => h.trim())
  const rows = body.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])))
  return { headers, rows }
}

/** Parse a numeric cell. Accepts "1,234.5", "$12", "15%". Returns null for empty or non-numeric values. */
export function toNumber(value: string | undefined): number | null {
  if (value == null) return null
  const cleaned = value.trim().replace(/[$€£,%\s]/g, '')
  if (cleaned === '' || cleaned === '-') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}
