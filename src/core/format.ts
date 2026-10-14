// Number formatting shared by the engine's messages and the UI.

export function money(value: number, decimals = 0): string {
  const sign = value < 0 ? '-' : ''
  return `${sign}$${Math.abs(value).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

/** "$14.9k" for large amounts, "$950" otherwise. */
export function moneyShort(value: number): string {
  if (Math.abs(value) < 10_000) return money(value)
  const sign = value < 0 ? '-' : ''
  return `${sign}$${(Math.abs(value) / 1000).toFixed(1)}k`
}

export function count(value: number, decimals = 0): string {
  return value.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/** 0.142 -> "14%" */
export function percent(value: number | null, decimals = 0): string {
  return value == null ? '–' : `${(value * 100).toFixed(decimals)}%`
}
