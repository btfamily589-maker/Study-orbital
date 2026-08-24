export const ymd = (d = new Date()) => {
  const t = new Date(d)
  t.setMinutes(t.getMinutes() - t.getTimezoneOffset())
  return t.toISOString().slice(0, 10)
}

/** 오늘 기준 D-값. 오늘이면 0, 내일이면 1 */
export function dday(dateStr) {
  const a = new Date(`${ymd()}T00:00:00`)
  const b = new Date(`${dateStr}T00:00:00`)
  return Math.round((b - a) / 86400000)
}

export function ddayLabel(n) {
  if (n === 0) return 'D-DAY'
  return n > 0 ? `D-${n}` : `D+${-n}`
}

export function weekdayKo(dateStr) {
  return ['일', '월', '화', '수', '목', '금', '토'][new Date(`${dateStr}T00:00:00`).getDay()]
}

export function prettyDate(dateStr) {
  const [, m, d] = dateStr.split('-')
  return `${Number(m)}/${Number(d)} (${weekdayKo(dateStr)})`
}

export function relTime(ts) {
  const diff = (Date.now() - ts) / 1000
  if (diff < 60) return '방금'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  return `${Math.floor(diff / 86400)}일 전`
}
