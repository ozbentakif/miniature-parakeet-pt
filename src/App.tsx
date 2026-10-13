import { useState } from 'react'
import { parseCsv, type CsvTable } from './core/csv'

const PREVIEW_ROWS = 10

export default function App() {
  const [table, setTable] = useState<CsvTable | null>(null)
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)

  async function load(file: File | undefined) {
    if (!file) return
    setFileName(file.name)
    setTable(parseCsv(await file.text()))
  }

  return (
    <main className="app">
      <header>
        <h1>Product Prototype</h1>
        <p className="muted">Load a CSV file to start. The file is read in your browser and never uploaded.</p>
      </header>

      <label
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); load(e.dataTransfer.files[0]) }}
      >
        <input type="file" accept=".csv,text/csv" onChange={(e) => load(e.target.files?.[0])} hidden />
        <strong>Drop a CSV file here</strong>
        <span className="muted">or click to choose one</span>
      </label>

      {table && (
        <section>
          <p>
            <strong>{fileName}</strong>: {table.rows.length.toLocaleString()} rows, {table.headers.length} columns
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>{table.headers.map((h) => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {table.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                  <tr key={i}>{table.headers.map((h) => <td key={h}>{row[h]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {table.rows.length > PREVIEW_ROWS && <p className="muted">Showing the first {PREVIEW_ROWS} rows.</p>}
        </section>
      )}
    </main>
  )
}
