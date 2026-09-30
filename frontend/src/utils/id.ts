/** 编目号 / 唯一键 / 时间戳等通用工具。 */

/** 生成跨表使用的本地唯一键（邮路节点拖拽排序等场景）。 */
export function uid(prefix = 'k'): string {
  const rnd = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${rnd}`
}

/** 当前时间的 ISO 字符串。 */
export function nowIso(): string {
  return new Date().toISOString()
}

/** 把数字补足到指定宽度。 */
export function pad(num: number, width = 4): string {
  return String(Math.max(0, Math.trunc(num))).padStart(width, '0')
}

/** 从已有编号里解析出流水号，解析失败返回 0。 */
export function parseSerial(no: string, prefix: string): number {
  if (!no || !no.startsWith(prefix)) return 0
  const n = Number.parseInt(no.slice(prefix.length).replace(/\D/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

/** 依据已有编号集合生成下一个编目号，如 PM-0007。 */
export function nextSerialNo(prefix: string, existing: string[]): string {
  let max = 0
  for (const no of existing) {
    const n = parseSerial(no, prefix)
    if (n > max) max = n
  }
  return `${prefix}${pad(max + 1)}`
}

/** 截断文本，用于卡片摘要。 */
export function truncate(text: string, max = 48): string {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 把字符串数组按中文顿号连接。 */
export function joinCn(list: string[], empty = '—'): string {
  const items = list.filter((s) => !!s)
  return items.length ? items.join('、') : empty
}

/** 安全的数字转换，异常输入返回兜底值。 */
export function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(n) ? n : fallback
}
