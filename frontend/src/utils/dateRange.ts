/** 年代区间解析、干支与公元互转、日期先后校验。 */

/** 年代区间 */
export interface EraRange {
  from: number
  to: number
}

const STEMS = '甲乙丙丁戊己庚辛壬癸'
const BRANCHES = '子丑寅卯辰巳午未申酉戌亥'

/** 解析年代区间文本，支持「1950-1959」「1950—1959」「1950」「民国` 等写法。 */
export function parseEraRange(input: string): EraRange | null {
  const text = (input || '').trim().replace(/[—–~～至]/g, '-')
  if (!text) return null
  const single = /^(\d{3,4})$/.exec(text)
  if (single) {
    const year = Number(single[1])
    return { from: year, to: year }
  }
  const range = /^(\d{3,4})\s*-\s*(\d{3,4})$/.exec(text)
  if (range) {
    const a = Number(range[1])
    const b = Number(range[2])
    return { from: Math.min(a, b), to: Math.max(a, b) }
  }
  return null
}

/** 区间格式化。 */
export function formatEraRange(range: EraRange | null): string {
  if (!range) return '—'
  if (range.from === range.to) return `${range.from}`
  return `${range.from}-${range.to}`
}

/** 判断某年是否落在区间内；区间为空视为不过滤。 */
export function yearInRange(year: number, range: EraRange | null): boolean {
  if (!range) return true
  if (!Number.isFinite(year)) return false
  return year >= range.from && year <= range.to
}

/** 两个年代区间是否相交。 */
export function rangesIntersect(a: EraRange, b: EraRange): boolean {
  return a.from <= b.to && b.from <= a.to
}

/** 日期是否合法（YYYY-MM-DD）。 */
export function isValidDate(value: string): boolean {
  if (!value) return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time)
}

/** 日期比较：a 早于 b 返回 -1，相等 0，晚于 1；空值排在最后。 */
export function compareDate(a: string, b: string): number {
  const ta = isValidDate(a) ? Date.parse(`${a}T00:00:00Z`) : Number.POSITIVE_INFINITY
  const tb = isValidDate(b) ? Date.parse(`${b}T00:00:00Z`) : Number.POSITIVE_INFINITY
  if (ta === tb) return 0
  return ta < tb ? -1 : 1
}

/** 计算两个日期之间的天数（b - a）；任一非法返回 null。 */
export function daysBetween(a: string, b: string): number | null {
  if (!isValidDate(a) || !isValidDate(b)) return null
  const ta = Date.parse(`${a}T00:00:00Z`)
  const tb = Date.parse(`${b}T00:00:00Z`)
  return Math.round((tb - ta) / 86400000)
}

/** 日期加天数，返回 YYYY-MM-DD。 */
export function addDays(date: string, days: number): string {
  if (!isValidDate(date)) return ''
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86400000
  return new Date(t).toISOString().slice(0, 10)
}

/** 公元年 → 干支纪年。 */
export function toGanzhi(year: number): string {
  if (!Number.isFinite(year)) return ''
  const y = Math.trunc(year)
  const stem = ((y - 4) % 10 + 10) % 10
  const branch = ((y - 4) % 12 + 12) % 12
  return `${STEMS[stem]}${BRANCHES[branch]}`
}

/** 干支纪年 → 指定区间内的公元年列表。 */
export function ganzhiToYears(ganzhi: string, from: number, to: number): number[] {
  const text = (ganzhi || '').trim()
  if (text.length !== 2) return []
  const years: number[] = []
  for (let y = Math.min(from, to); y <= Math.max(from, to); y += 1) {
    if (toGanzhi(y) === text) years.push(y)
  }
  return years
}

/** 一组日期是否单调不减。 */
export function isChronological(dates: string[]): boolean {
  const valid = dates.filter((d) => isValidDate(d))
  for (let i = 1; i < valid.length; i += 1) {
    if (compareDate(valid[i - 1], valid[i]) > 0) return false
  }
  return true
}

/** 日期先后校验：返回 ok 与中文提示，供表单与时间轴复用。 */
export function validateChronology(dates: string[]): { ok: boolean; message: string } {
  if (isChronological(dates)) return { ok: true, message: '' }
  return { ok: false, message: '日期顺序有误：后面的节点日期早于前面的节点，请核对寄递过程。' }
}
