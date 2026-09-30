/**
 * 统一的编目过滤 / 排序：邮戳目录、实寄封目录、综合检索页共用。
 * 按 kind 决定各字段的匹配语义，避免三个页面各写一套筛选逻辑。
 */
import { computed, reactive, type ComputedRef, type Ref } from 'vue'
import { parseEraRange, yearInRange, type EraRange } from '@/utils/dateRange'

export type CatalogKind = 'postmark' | 'cover' | 'route'
export type SortKey = 'recent' | 'noAsc' | 'yearAsc' | 'yearDesc'

export interface CatalogFilters {
  /** 关键词：编号 / 局所 / 收寄地 / 备注 */
  keyword: string
  /** 戳型 */
  type: string
  /** 收寄地（实寄封）/ 局所（邮戳）模糊匹配 */
  office: string
  province: string
  /** 年代区间，如 1950-1959 */
  era: string
  scarceLevel: string
  conditionGrade: string
  /** 是否给据邮件 */
  registered: '' | 'yes' | 'no'
  /** 运输方式 */
  transport: string
  sortKey: SortKey
}

type AnyRow = Record<string, any>

export function defaultFilters(): CatalogFilters {
  return {
    keyword: '',
    type: '',
    office: '',
    province: '',
    era: '',
    scarceLevel: '',
    conditionGrade: '',
    registered: '',
    transport: '',
    sortKey: 'recent'
  }
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 取记录的代表年份，用于年代区间过滤与排序。 */
function yearOf(kind: CatalogKind, row: AnyRow): number {
  if (kind === 'postmark') return Number(row.yearFrom) || 0
  if (kind === 'cover') {
    const date = textOf(row.postDate)
    return date ? Number(date.slice(0, 4)) : 0
  }
  const nodes = Array.isArray(row.nodes) ? (row.nodes as AnyRow[]) : []
  for (const node of nodes) {
    const date = textOf(node.arriveDate)
    if (date) return Number(date.slice(0, 4))
  }
  const era = parseEraRange(textOf(row.era))
  return era ? era.from : 0
}

function noOf(kind: CatalogKind, row: AnyRow): string {
  if (kind === 'postmark') return textOf(row.pmNo)
  if (kind === 'cover') return textOf(row.coverNo)
  return textOf(row.routeNo)
}

function keywordHaystack(kind: CatalogKind, row: AnyRow): string {
  if (kind === 'postmark') {
    const lettering = (row.lettering ?? {}) as AnyRow
    return [
      textOf(row.pmNo),
      textOf(row.type),
      textOf(row.office),
      textOf(row.province),
      textOf(row.inkColor),
      textOf(row.scarceLevel),
      textOf(lettering.top),
      textOf(lettering.middle),
      textOf(lettering.bottom),
      textOf(row.note),
      String(row.yearFrom ?? ''),
      String(row.yearTo ?? '')
    ].join(' ')
  }
  if (kind === 'cover') {
    return [
      textOf(row.coverNo),
      textOf(row.sentFrom),
      textOf(row.sentTo),
      textOf(row.acquireFrom),
      textOf(row.storageAlbum),
      textOf(row.note),
      Array.isArray(row.viaPoints) ? (row.viaPoints as string[]).join(' ') : ''
    ].join(' ')
  }
  const nodes = Array.isArray(row.nodes) ? (row.nodes as AnyRow[]) : []
  return [
    textOf(row.routeNo),
    textOf(row.name),
    textOf(row.era),
    textOf(row.transport),
    textOf(row.remark),
    nodes.map((n) => `${textOf(n.office)} ${textOf(n.transitMark)}`).join(' ')
  ].join(' ')
}

export interface UseCatalogFilterReturn<T> {
  filters: CatalogFilters
  eraRange: ComputedRef<EraRange | null>
  filtered: ComputedRef<T[]>
  activeCount: ComputedRef<number>
  reset: () => void
}

export function useCatalogFilter<T>(
  kind: CatalogKind,
  source: Ref<T[]> | ComputedRef<T[]>
): UseCatalogFilterReturn<T> {
  const filters = reactive<CatalogFilters>(defaultFilters())
  const eraRange = computed<EraRange | null>(() => parseEraRange(filters.era))

  const filtered = computed<T[]>(() => {
    const kw = filters.keyword.trim().toLowerCase()
    const office = filters.office.trim().toLowerCase()
    const range = eraRange.value
    const rows = (source.value ?? []) as unknown as T[]
    const kept = rows.filter((item) => {
      const row = item as unknown as AnyRow
      if (kw && !keywordHaystack(kind, row).toLowerCase().includes(kw)) return false
      if (kind === 'postmark') {
        if (filters.type && textOf(row.type) !== filters.type) return false
        if (filters.province && textOf(row.province) !== filters.province) return false
        if (filters.scarceLevel && textOf(row.scarceLevel) !== filters.scarceLevel) return false
        if (office && !textOf(row.office).toLowerCase().includes(office)) return false
        if (!yearInRange(Number(row.yearFrom) || 0, range)) return false
      } else if (kind === 'cover') {
        if (filters.conditionGrade && textOf(row.conditionGrade) !== filters.conditionGrade) {
          return false
        }
        if (filters.registered === 'yes' && row.registered !== true) return false
        if (filters.registered === 'no' && row.registered !== false) return false
        if (office) {
          const hay = `${textOf(row.sentFrom)} ${textOf(row.sentTo)}`.toLowerCase()
          if (!hay.includes(office)) return false
        }
        const year = yearOf(kind, row)
        if (range && !yearInRange(year, range)) return false
      } else {
        if (filters.transport && textOf(row.transport) !== filters.transport) return false
        if (office) {
          const nodes = Array.isArray(row.nodes) ? (row.nodes as AnyRow[]) : []
          const hay = nodes.map((n) => textOf(n.office)).join(' ').toLowerCase()
          if (!hay.includes(office)) return false
        }
        const year = yearOf(kind, row)
        if (range && !yearInRange(year, range)) return false
      }
      return true
    })

    const direction = filters.sortKey === 'yearDesc' ? -1 : 1
    return kept.sort((a, b) => {
      const ra = a as unknown as AnyRow
      const rb = b as unknown as AnyRow
      if (filters.sortKey === 'noAsc') return noOf(kind, ra).localeCompare(noOf(kind, rb), 'zh-Hans-CN')
      if (filters.sortKey === 'yearAsc' || filters.sortKey === 'yearDesc') {
        return (yearOf(kind, ra) - yearOf(kind, rb)) * direction
      }
      return textOf(rb.updatedAt).localeCompare(textOf(ra.updatedAt))
    })
  })

  const activeCount = computed(() => {
    const base = defaultFilters()
    return (Object.keys(base) as (keyof CatalogFilters)[]).filter(
      (key) => filters[key] !== base[key]
    ).length
  })

  function reset(): void {
    Object.assign(filters, defaultFilters())
  }

  return { filters, eraRange, filtered, activeCount, reset }
}
