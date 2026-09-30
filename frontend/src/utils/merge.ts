/**
 * 离线合并通道：把两台电脑各自整理的邮戳 / 实寄封 / 邮路导出成文件，
 * 回家后离线合并。按稳定编目键（guid）识别同一记录，同键修改保留双方
 * 内容与时间供挑选；跨对象引用先对账（guid ↔ 本地 id），缺项补齐后才完成；
 * 合并失败时现有数据保持原样，可重试。
 */
import type { Postmark } from '@/types/postmark'
import type { Cover } from '@/types/cover'
import type { PostalRoute } from '@/types/route'
import type { StamplessEntry } from '@/types/stampentry'
import type { CatalogAsset } from '@/types/asset'
import { db } from '@/utils/db'
import { guid } from '@/utils/id'

export const MERGE_FORMAT = 'gbpostmark-merge'
export const MERGE_VERSION = 1

export type EntityKind = 'postmark' | 'route' | 'cover' | 'stampEntry'

/* ------------------------------ 导出文件结构 ------------------------------ */

export type ExportedPostmark = Omit<Postmark, 'id'>
export type ExportedRoute = Omit<PostalRoute, 'id'>
export interface ExportedCover extends Omit<Cover, 'id' | 'cancelPmIds' | 'routeId'> {
  cancelPmGuids: string[]
  routeGuid: string | null
}
export interface ExportedStampEntry extends Omit<StamplessEntry, 'id' | 'coverId'> {
  coverGuid: string
}
export interface ExportedAsset extends Omit<CatalogAsset, 'id' | 'ownerId'> {
  ownerGuid: string
}

export interface MergeExportFile {
  format: typeof MERGE_FORMAT
  version: number
  exportedAt: string
  deviceId: string
  postmarks: ExportedPostmark[]
  routes: ExportedRoute[]
  covers: ExportedCover[]
  stampEntries: ExportedStampEntry[]
  assets: ExportedAsset[]
}

/* ------------------------------ 分析结果类型 ------------------------------ */

export interface MergeNew {
  kind: 'new'
  entity: EntityKind
  guid: string
  label: string
  record: ExportedPostmark | ExportedRoute | ExportedCover | ExportedStampEntry
}

export interface MergeIdentical {
  kind: 'identical'
  entity: EntityKind
  guid: string
  label: string
}

export interface MergeConflict {
  kind: 'conflict'
  entity: EntityKind
  guid: string
  label: string
  local: Postmark | PostalRoute | Cover | StamplessEntry
  imported: ExportedPostmark | ExportedRoute | ExportedCover | ExportedStampEntry
  diffFields: string[]
  resolution: 'local' | 'imported'
}

export interface MergeDuplicate {
  kind: 'duplicate'
  entity: EntityKind
  /** 导入端记录的 guid */
  guid: string
  /** 本机匹配到的记录 guid */
  localGuid: string
  label: string
  local: Postmark | PostalRoute | Cover | StamplessEntry
  imported: ExportedPostmark | ExportedRoute | ExportedCover | ExportedStampEntry
  identical: boolean
  diffFields: string[]
  resolution: 'local' | 'imported'
}

export type MergeItem = MergeNew | MergeIdentical | MergeConflict | MergeDuplicate

export interface MissingRef {
  entity: EntityKind
  recordGuid: string
  recordLabel: string
  refField: string
  refGuid: string
}

export interface MergeAnalysis {
  exportedAt: string
  deviceId: string
  postmarks: MergeItem[]
  routes: MergeItem[]
  covers: MergeItem[]
  stampEntries: MergeItem[]
  assets: ExportedAsset[]
  missingRefs: MissingRef[]
  newCount: number
  identicalCount: number
  conflictCount: number
  duplicateCount: number
}

export interface ApplyResult {
  applied: boolean
  added: number
  updated: number
  skipped: number
}

/* ------------------------------ 工具函数 ------------------------------ */

/** FNV-1a 字符串哈希，输出十六进制。 */
function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** 归一化：去首尾空格、对象按键名排序，保证同内容同哈希。 */
function normalize(value: unknown): unknown {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value).sort()) {
      out[k] = normalize((value as Record<string, unknown>)[k])
    }
    return out
  }
  return value
}

function fingerprintOf(entity: EntityKind, record: Record<string, unknown>): string {
  let identity: unknown
  if (entity === 'postmark') {
    identity = {
      type: record.type,
      office: record.office,
      province: record.province,
      yearFrom: record.yearFrom,
      yearTo: record.yearTo,
      dateOnStamp: record.dateOnStamp,
      lettering: record.lettering
    }
  } else if (entity === 'route') {
    identity = {
      routeNo: record.routeNo,
      name: record.name,
      era: record.era,
      transport: record.transport,
      nodes: (record.nodes as Array<{ office: string; arriveDate: string }>).map((n) => ({
        office: n.office,
        arriveDate: n.arriveDate
      }))
    }
  } else if (entity === 'cover') {
    identity = {
      coverNo: record.coverNo,
      sentFrom: record.sentFrom,
      sentTo: record.sentTo,
      postDate: record.postDate,
      arriveDate: record.arriveDate
    }
  } else {
    identity = {
      stampName: record.stampName,
      denomination: record.denomination,
      issueYear: record.issueYear,
      perforation: record.perforation,
      variety: record.variety,
      positionOnCover: record.positionOnCover
    }
  }
  return fnv1a(JSON.stringify(normalize(identity)))
}

function labelOf(entity: EntityKind, record: Record<string, unknown>): string {
  if (entity === 'postmark') {
    return `${(record.pmNo as string) ?? ''} ${(record.office as string) ?? ''}`.trim() || '未命名邮戳'
  }
  if (entity === 'route') {
    return `${(record.routeNo as string) ?? ''} ${(record.name as string) ?? ''}`.trim() || '未命名邮路'
  }
  if (entity === 'cover') {
    return (
      `${(record.coverNo as string) ?? ''} ${(record.sentFrom as string) ?? ''}→${(record.sentTo as string) ?? ''}`.trim() ||
      '未命名实寄封'
    )
  }
  return `${(record.stampName as string) ?? ''} ${(record.positionOnCover as string) ?? ''}`.trim() || '票戳组合'
}

/** 各类型参与内容比对的字段（不含 id / guid / 时间戳 / 引用字段）。 */
const DISPLAY_FIELDS: Record<EntityKind, string[]> = {
  postmark: [
    'pmNo',
    'type',
    'office',
    'province',
    'yearFrom',
    'yearTo',
    'dateOnStamp',
    'inkColor',
    'diameter',
    'lettering',
    'bilingual',
    'scarceLevel',
    'note'
  ],
  route: ['routeNo', 'name', 'era', 'transport', 'nodes', 'totalDays', 'frequency', 'remark'],
  cover: [
    'coverNo',
    'sentFrom',
    'sentTo',
    'postDate',
    'arriveDate',
    'franking',
    'viaPoints',
    'registered',
    'conditionGrade',
    'acquireFrom',
    'price',
    'storageAlbum',
    'note'
  ],
  stampEntry: ['stampName', 'denomination', 'issueYear', 'perforation', 'variety', 'positionOnCover']
}

/** 比对两条记录的内容字段，返回不一致字段的中文标签（供差异高亮）。 */
function diffFields(
  entity: EntityKind,
  local: Record<string, unknown>,
  imported: Record<string, unknown>
): string[] {
  const fields = DISPLAY_FIELDS[entity]
  const diff: string[] = []
  for (const f of fields) {
    const a = JSON.stringify(normalize(local[f]))
    const b = JSON.stringify(normalize(imported[f]))
    if (a !== b) diff.push(FIELD_LABELS[f] ?? f)
  }
  return diff
}

/** 默认挑选：时间戳较新的一方；持平或缺失时保留本机。 */
function defaultResolution(localUpdatedAt: string, importedUpdatedAt: string): 'local' | 'imported' {
  if (!localUpdatedAt) return 'imported'
  if (!importedUpdatedAt) return 'local'
  return importedUpdatedAt > localUpdatedAt ? 'imported' : 'local'
}

/** 冲突 / 重复项的解析键。 */
export function resolutionKey(entity: EntityKind, g: string): string {
  return `${entity}:${g}`
}

/** 字段名中文标签，供差异展示。 */
export const FIELD_LABELS: Record<string, string> = {
  pmNo: '编目号',
  type: '戳型',
  office: '局所',
  province: '省份',
  yearFrom: '使用年代起',
  yearTo: '使用年代止',
  dateOnStamp: '戳面日期',
  inkColor: '墨色',
  diameter: '戳径',
  lettering: '戳面文字',
  bilingual: '中英双文',
  scarceLevel: '稀见度',
  note: '备注',
  routeNo: '邮路号',
  name: '名称',
  era: '时期',
  transport: '运输方式',
  nodes: '节点',
  totalDays: '全程天数',
  frequency: '班期',
  remark: '备注',
  coverNo: '封号',
  sentFrom: '寄出地',
  sentTo: '寄达地',
  postDate: '寄出日期',
  arriveDate: '到达日期',
  franking: '贴票构成',
  viaPoints: '中转地',
  registered: '给据',
  conditionGrade: '品相',
  acquireFrom: '来源',
  price: '购入价',
  storageAlbum: '藏册页位',
  stampName: '邮票名称',
  denomination: '面值',
  issueYear: '发行年份',
  perforation: '齿度',
  variety: '变体',
  positionOnCover: '封上位置'
}

/** 把记录的目录字段转成「标签 + 值」行，供冲突 / 重复对比展示。 */
export function displayRows(
  entity: EntityKind,
  record: Record<string, unknown>
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  for (const f of DISPLAY_FIELDS[entity]) {
    const v = record[f]
    if (f === 'lettering' && v && typeof v === 'object') {
      const l = v as { top: string; middle: string; bottom: string }
      rows.push({
        label: FIELD_LABELS[f],
        value: [l.top, l.middle, l.bottom].filter(Boolean).join(' / ') || '—'
      })
    } else if (f === 'nodes' && Array.isArray(v)) {
      rows.push({ label: FIELD_LABELS[f], value: `${v.length} 站` })
    } else if (f === 'franking' && Array.isArray(v)) {
      rows.push({ label: FIELD_LABELS[f], value: `${v.length} 项` })
    } else if (Array.isArray(v)) {
      rows.push({ label: FIELD_LABELS[f], value: v.length ? v.join('、') : '—' })
    } else if (typeof v === 'boolean') {
      rows.push({ label: FIELD_LABELS[f], value: v ? '是' : '否' })
    } else if (v == null || v === '') {
      rows.push({ label: FIELD_LABELS[f], value: '—' })
    } else {
      rows.push({ label: FIELD_LABELS[f], value: String(v) })
    }
  }
  return rows
}

/* ------------------------------ 导出 ------------------------------ */

const DEVICE_KEY = 'gbpostmark:deviceId'

function deviceId(): string {
  try {
    let id = window.localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = guid()
      window.localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return guid()
  }
}

/** 导出全部编目数据为合并文件（引用一律转成 guid）。 */
export async function exportData(): Promise<MergeExportFile> {
  const [pms, routes, covers, entries, assets] = await Promise.all([
    db.postmarks.toArray(),
    db.routes.toArray(),
    db.covers.toArray(),
    db.stampEntries.toArray(),
    db.assets.toArray()
  ])

  const pmIdToGuid = new Map<number, string>()
  for (const pm of pms) if (pm.id != null) pmIdToGuid.set(pm.id, pm.guid)
  const routeIdToGuid = new Map<number, string>()
  for (const rt of routes) if (rt.id != null) routeIdToGuid.set(rt.id, rt.guid)
  const coverIdToGuid = new Map<number, string>()
  for (const cv of covers) if (cv.id != null) coverIdToGuid.set(cv.id, cv.guid)

  const exportedPms: ExportedPostmark[] = pms.map(({ id: _id, ...rest }) => rest)
  const exportedRoutes: ExportedRoute[] = routes.map(({ id: _id, ...rest }) => rest)
  const exportedCovers: ExportedCover[] = covers.map((cv) => {
    const { id: _id, cancelPmIds, routeId, ...rest } = cv
    return {
      ...rest,
      cancelPmGuids: cancelPmIds
        .map((pid) => pmIdToGuid.get(pid))
        .filter((g): g is string => typeof g === 'string' && !!g),
      routeGuid: routeId != null ? routeIdToGuid.get(routeId) ?? null : null
    }
  })
  const exportedEntries: ExportedStampEntry[] = entries.map((e) => {
    const { id: _id, coverId, ...rest } = e
    return { ...rest, coverGuid: coverIdToGuid.get(coverId) ?? '' }
  })
  const exportedAssets: ExportedAsset[] = assets.map((a) => {
    const { id: _id, ownerId, ...rest } = a
    const ownerGuid =
      a.ownerType === 'postmark' ? pmIdToGuid.get(ownerId) : coverIdToGuid.get(ownerId)
    return { ...rest, ownerGuid: ownerGuid ?? '' }
  })

  return {
    format: MERGE_FORMAT,
    version: MERGE_VERSION,
    exportedAt: new Date().toISOString(),
    deviceId: deviceId(),
    postmarks: exportedPms,
    routes: exportedRoutes,
    covers: exportedCovers,
    stampEntries: exportedEntries,
    assets: exportedAssets
  }
}

/** 生成带时间戳的导出文件名。 */
export function exportFileName(): string {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `gbpostmark-merge-${ts}.json`
}

/** 触发浏览器下载导出文件。 */
export function downloadExport(file: MergeExportFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = exportFileName()
  a.click()
  URL.revokeObjectURL(url)
}

/* ------------------------------ 解析 ------------------------------ */

/** 解析并校验导入文件；格式不对时抛错，不改动任何数据。 */
export function parseImport(text: string): MergeExportFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的 JSON，请选择本编目台导出的合并文件（.json）。')
  }
  if (!data || typeof data !== 'object') throw new Error('合并文件格式不正确。')
  const f = data as Partial<MergeExportFile>
  if (f.format !== MERGE_FORMAT) {
    throw new Error('文件格式不是 gbpostmark-merge，无法合并。请确认选择的是导出的合并文件。')
  }
  if (typeof f.version !== 'number' || f.version > MERGE_VERSION) {
    throw new Error('合并文件版本不受支持，请升级编目台后再导入。')
  }
  if (
    !Array.isArray(f.postmarks) ||
    !Array.isArray(f.routes) ||
    !Array.isArray(f.covers) ||
    !Array.isArray(f.stampEntries)
  ) {
    throw new Error('合并文件缺少必要的记录分组（邮戳 / 邮路 / 实寄封 / 票戳组合）。')
  }
  f.assets = Array.isArray(f.assets) ? f.assets : []
  return f as MergeExportFile
}

/* ------------------------------ 分析 ------------------------------ */

export async function analyzeMerge(file: MergeExportFile): Promise<MergeAnalysis> {
  const [localPms, localRoutes, localCovers, localEntries] = await Promise.all([
    db.postmarks.toArray(),
    db.routes.toArray(),
    db.covers.toArray(),
    db.stampEntries.toArray()
  ])

  // 本机 guid 索引
  const localPmByGuid = new Map<string, Postmark>()
  const localRouteByGuid = new Map<string, PostalRoute>()
  const localCoverByGuid = new Map<string, Cover>()
  const localEntryByGuid = new Map<string, StamplessEntry>()
  for (const pm of localPms) localPmByGuid.set(pm.guid, pm)
  for (const rt of localRoutes) localRouteByGuid.set(rt.guid, rt)
  for (const cv of localCovers) localCoverByGuid.set(cv.guid, cv)
  for (const e of localEntries) localEntryByGuid.set(e.guid, e)

  // 本机内容指纹索引（用于识别「双方各自新增的同一枚邮戳」）
  const localPmByFp = new Map<string, Postmark>()
  const localRouteByFp = new Map<string, PostalRoute>()
  const localCoverByFp = new Map<string, Cover>()
  const localEntryByFp = new Map<string, StamplessEntry>()
  for (const pm of localPms) {
    const fp = fingerprintOf('postmark', pm as unknown as Record<string, unknown>)
    if (!localPmByFp.has(fp)) localPmByFp.set(fp, pm)
  }
  for (const rt of localRoutes) {
    const fp = fingerprintOf('route', rt as unknown as Record<string, unknown>)
    if (!localRouteByFp.has(fp)) localRouteByFp.set(fp, rt)
  }
  for (const cv of localCovers) {
    const fp = fingerprintOf('cover', cv as unknown as Record<string, unknown>)
    if (!localCoverByFp.has(fp)) localCoverByFp.set(fp, cv)
  }
  for (const e of localEntries) {
    const fp = fingerprintOf('stampEntry', e as unknown as Record<string, unknown>)
    if (!localEntryByFp.has(fp)) localEntryByFp.set(fp, e)
  }

  // 已知 guid 集合（本机 + 导入），用于缺项对账
  const knownGuids = new Set<string>()
  for (const g of localPmByGuid.keys()) knownGuids.add(g)
  for (const g of localRouteByGuid.keys()) knownGuids.add(g)
  for (const g of localCoverByGuid.keys()) knownGuids.add(g)
  for (const g of localEntryByGuid.keys()) knownGuids.add(g)
  for (const pm of file.postmarks) knownGuids.add(pm.guid)
  for (const rt of file.routes) knownGuids.add(rt.guid)
  for (const cv of file.covers) knownGuids.add(cv.guid)
  for (const e of file.stampEntries) knownGuids.add(e.guid)

  const postmarkItems: MergeItem[] = []
  const routeItems: MergeItem[] = []
  const coverItems: MergeItem[] = []
  const entryItems: MergeItem[] = []
  const missingRefs: MissingRef[] = []

  // 通用处理：按 guid 匹配，同键比内容，无 guid 匹配再用指纹查重复
  function process<
    TLocal extends { guid: string; updatedAt?: string; createdAt?: string },
    TImported extends { guid: string; updatedAt?: string; createdAt?: string }
  >(
    entity: EntityKind,
    imported: TImported,
    localByGuid: Map<string, TLocal>,
    localByFp: Map<string, TLocal>
  ): MergeItem {
    const label = labelOf(entity, imported as unknown as Record<string, unknown>)
    const local = localByGuid.get(imported.guid)
    const ts = (r: { updatedAt?: string; createdAt?: string }): string => r.updatedAt ?? r.createdAt ?? ''
    if (local) {
      const diff = diffFields(
        entity,
        local as unknown as Record<string, unknown>,
        imported as unknown as Record<string, unknown>
      )
      if (diff.length === 0) {
        return { kind: 'identical', entity, guid: imported.guid, label }
      }
      return {
        kind: 'conflict',
        entity,
        guid: imported.guid,
        label,
        local: local as unknown as Postmark | PostalRoute | Cover | StamplessEntry,
        imported: imported as unknown as
          | ExportedPostmark
          | ExportedRoute
          | ExportedCover
          | ExportedStampEntry,
        diffFields: diff,
        resolution: defaultResolution(ts(local), ts(imported))
      }
    }
    const fp = fingerprintOf(entity, imported as unknown as Record<string, unknown>)
    const dup = localByFp.get(fp)
    if (dup) {
      const diff = diffFields(
        entity,
        dup as unknown as Record<string, unknown>,
        imported as unknown as Record<string, unknown>
      )
      return {
        kind: 'duplicate',
        entity,
        guid: imported.guid,
        localGuid: dup.guid,
        label,
        local: dup as unknown as Postmark | PostalRoute | Cover | StamplessEntry,
        imported: imported as unknown as
          | ExportedPostmark
          | ExportedRoute
          | ExportedCover
          | ExportedStampEntry,
        identical: diff.length === 0,
        diffFields: diff,
        resolution: defaultResolution(ts(dup), ts(imported))
      }
    }
    return {
      kind: 'new',
      entity,
      guid: imported.guid,
      label,
      record: imported as unknown as ExportedPostmark | ExportedRoute | ExportedCover | ExportedStampEntry
    }
  }

  for (const imp of file.postmarks) {
    postmarkItems.push(process('postmark', imp, localPmByGuid, localPmByFp))
  }
  for (const imp of file.routes) {
    routeItems.push(process('route', imp, localRouteByGuid, localRouteByFp))
  }
  for (const imp of file.covers) {
    coverItems.push(process('cover', imp, localCoverByGuid, localCoverByFp))
  }
  for (const imp of file.stampEntries) {
    entryItems.push(process('stampEntry', imp, localEntryByGuid, localEntryByFp))
  }

  // 跨对象引用对账：封 → 邮戳 / 邮路；票戳组合 → 封
  for (const imp of file.covers) {
    for (const g of imp.cancelPmGuids) {
      if (!knownGuids.has(g)) {
        missingRefs.push({
          entity: 'cover',
          recordGuid: imp.guid,
          recordLabel: labelOf('cover', imp as unknown as Record<string, unknown>),
          refField: '销票邮戳',
          refGuid: g
        })
      }
    }
    if (imp.routeGuid && !knownGuids.has(imp.routeGuid)) {
      missingRefs.push({
        entity: 'cover',
        recordGuid: imp.guid,
        recordLabel: labelOf('cover', imp as unknown as Record<string, unknown>),
        refField: '所属邮路',
        refGuid: imp.routeGuid
      })
    }
  }
  for (const imp of file.stampEntries) {
    if (!knownGuids.has(imp.coverGuid)) {
      missingRefs.push({
        entity: 'stampEntry',
        recordGuid: imp.guid,
        recordLabel: labelOf('stampEntry', imp as unknown as Record<string, unknown>),
        refField: '所属封',
        refGuid: imp.coverGuid
      })
    }
  }

  const count = (items: MergeItem[], kind: MergeItem['kind']): number =>
    items.filter((i) => i.kind === kind).length

  return {
    exportedAt: file.exportedAt,
    deviceId: file.deviceId,
    postmarks: postmarkItems,
    routes: routeItems,
    covers: coverItems,
    stampEntries: entryItems,
    assets: file.assets,
    missingRefs,
    newCount:
      count(postmarkItems, 'new') + count(routeItems, 'new') + count(coverItems, 'new') + count(entryItems, 'new'),
    identicalCount:
      count(postmarkItems, 'identical') +
      count(routeItems, 'identical') +
      count(coverItems, 'identical') +
      count(entryItems, 'identical'),
    conflictCount:
      count(postmarkItems, 'conflict') +
      count(routeItems, 'conflict') +
      count(coverItems, 'conflict') +
      count(entryItems, 'conflict'),
    duplicateCount:
      count(postmarkItems, 'duplicate') +
      count(routeItems, 'duplicate') +
      count(coverItems, 'duplicate') +
      count(entryItems, 'duplicate')
  }
}

/* ------------------------------ 应用 ------------------------------ */

/**
 * 应用合并：在一个事务内按依赖顺序写入（邮戳 → 邮路 → 实寄封 → 票戳组合 → 原图），
 * 引用全部解析成本地 id。任何一步失败则整体回滚，现有数据保持原样。
 */
export async function applyMerge(
  analysis: MergeAnalysis,
  resolutions: Record<string, 'local' | 'imported'>
): Promise<ApplyResult> {
  // 缺项未补齐时拒绝写入，保证现有数据不被破坏（可补齐后重试）
  if (analysis.missingRefs.length > 0) {
    const first = analysis.missingRefs[0]
    throw new Error(
      `存在未补齐的跨对象引用：${first.recordLabel} → ${first.refField}（缺少 ${first.refGuid}）。` +
        '请先在导出端补全相关记录后重新导出。'
    )
  }

  // guid → 本地 id 映射，含本机记录与重复项（导入 guid → 本机 id）
  const pmGuidToId = new Map<string, number>()
  const routeGuidToId = new Map<string, number>()
  const coverGuidToId = new Map<string, number>()

  const localPms = await db.postmarks.toArray()
  for (const pm of localPms) if (pm.id != null) pmGuidToId.set(pm.guid, pm.id)
  const localRoutes = await db.routes.toArray()
  for (const rt of localRoutes) if (rt.id != null) routeGuidToId.set(rt.guid, rt.id)
  const localCovers = await db.covers.toArray()
  for (const cv of localCovers) if (cv.id != null) coverGuidToId.set(cv.guid, cv.id)

  for (const item of analysis.postmarks) {
    if (item.kind === 'duplicate' && item.local.id != null) pmGuidToId.set(item.guid, item.local.id)
  }
  for (const item of analysis.routes) {
    if (item.kind === 'duplicate' && item.local.id != null) routeGuidToId.set(item.guid, item.local.id)
  }
  for (const item of analysis.covers) {
    if (item.kind === 'duplicate' && item.local.id != null) coverGuidToId.set(item.guid, item.local.id)
  }

  // 记录每个 (实体, guid) 的处置，供原图同步判断
  const ownerResolution = new Map<string, 'local' | 'imported'>()
  for (const group of [analysis.postmarks, analysis.routes, analysis.covers, analysis.stampEntries]) {
    for (const item of group) {
      if (item.kind === 'conflict' || item.kind === 'duplicate') {
        ownerResolution.set(resolutionKey(item.entity, item.guid), resolutions[resolutionKey(item.entity, item.guid)] ?? item.resolution)
      } else if (item.kind === 'new') {
        ownerResolution.set(resolutionKey(item.entity, item.guid), 'imported')
      } else {
        ownerResolution.set(resolutionKey(item.entity, item.guid), 'local')
      }
    }
  }

  let added = 0
  let updated = 0
  let skipped = 0

  const resOf = (item: MergeConflict | MergeDuplicate): 'local' | 'imported' =>
    resolutions[resolutionKey(item.entity, item.guid)] ?? item.resolution

  await db.transaction(
    'rw',
    db.postmarks,
    db.routes,
    db.covers,
    db.stampEntries,
    db.assets,
    async (tx) => {
      // 1. 邮戳（无外键依赖）
      for (const item of analysis.postmarks) {
        if (item.kind === 'new') {
          const rec = { ...(item.record as ExportedPostmark) } as Postmark
          delete (rec as Partial<Postmark>).id
          const id = await tx.postmarks.add(rec)
          pmGuidToId.set(item.guid, id)
          added += 1
        } else if (item.kind === 'identical') {
          skipped += 1
        } else {
          const res = resOf(item)
          if (res === 'imported' && item.local.id != null) {
            const rec = { ...(item.imported as ExportedPostmark) } as Partial<Postmark>
            delete rec.id
            await tx.postmarks.update(item.local.id, rec)
            updated += 1
          } else {
            skipped += 1
          }
        }
      }

      // 2. 邮路（无外键依赖）
      for (const item of analysis.routes) {
        if (item.kind === 'new') {
          const rec = { ...(item.record as ExportedRoute) } as PostalRoute
          delete (rec as Partial<PostalRoute>).id
          const id = await tx.routes.add(rec)
          routeGuidToId.set(item.guid, id)
          added += 1
        } else if (item.kind === 'identical') {
          skipped += 1
        } else {
          const res = resOf(item)
          if (res === 'imported' && item.local.id != null) {
            const rec = { ...(item.imported as ExportedRoute) } as Partial<PostalRoute>
            delete rec.id
            await tx.routes.update(item.local.id, rec)
            updated += 1
          } else {
            skipped += 1
          }
        }
      }

      // 3. 实寄封（依赖邮戳 + 邮路，引用解析成本地 id）
      for (const item of analysis.covers) {
        if (item.kind === 'new') {
          const imp = item.record as ExportedCover
          const cancelPmIds = imp.cancelPmGuids
            .map((g) => pmGuidToId.get(g))
            .filter((v): v is number => v != null)
          const routeId = imp.routeGuid ? routeGuidToId.get(imp.routeGuid) ?? null : null
          const rec = { ...imp, cancelPmIds, routeId } as unknown as Cover
          delete (rec as Partial<Cover>).id
          delete (rec as unknown as Record<string, unknown>).cancelPmGuids
          delete (rec as unknown as Record<string, unknown>).routeGuid
          const id = await tx.covers.add(rec)
          coverGuidToId.set(item.guid, id)
          added += 1
        } else if (item.kind === 'identical') {
          skipped += 1
        } else {
          const res = resOf(item)
          if (res === 'imported' && item.local.id != null) {
            const imp = item.imported as ExportedCover
            const cancelPmIds = imp.cancelPmGuids
              .map((g) => pmGuidToId.get(g))
              .filter((v): v is number => v != null)
            const routeId = imp.routeGuid ? routeGuidToId.get(imp.routeGuid) ?? null : null
            const patch = { ...imp, cancelPmIds, routeId } as unknown as Partial<Cover>
            delete (patch as unknown as Record<string, unknown>).cancelPmGuids
            delete (patch as unknown as Record<string, unknown>).routeGuid
            await tx.covers.update(item.local.id, patch)
            updated += 1
          } else {
            skipped += 1
          }
        }
      }

      // 4. 票戳组合（依赖实寄封）
      for (const item of analysis.stampEntries) {
        if (item.kind === 'new') {
          const imp = item.record as ExportedStampEntry
          const coverId = coverGuidToId.get(imp.coverGuid)
          if (coverId == null) throw new Error(`票戳组合「${imp.stampName}」缺少所属封，无法补齐。`)
          const rec = { ...imp, coverId } as unknown as StamplessEntry
          delete (rec as Partial<StamplessEntry>).id
          delete (rec as unknown as Record<string, unknown>).coverGuid
          const id = await tx.stampEntries.add(rec)
          void id
          added += 1
        } else if (item.kind === 'identical') {
          skipped += 1
        } else {
          const res = resOf(item)
          if (res === 'imported' && item.local.id != null) {
            const imp = item.imported as ExportedStampEntry
            const coverId = coverGuidToId.get(imp.coverGuid)
            if (coverId == null) throw new Error(`票戳组合「${imp.stampName}」缺少所属封，无法补齐。`)
            const patch = { ...imp, coverId } as unknown as Partial<StamplessEntry>
            delete (patch as unknown as Record<string, unknown>).coverGuid
            await tx.stampEntries.update(item.local.id, patch)
            updated += 1
          } else {
            skipped += 1
          }
        }
      }

      // 5. 原图（依赖邮戳 / 实寄封）
      for (const asset of analysis.assets) {
        const ownerId =
          asset.ownerType === 'postmark'
            ? pmGuidToId.get(asset.ownerGuid)
            : coverGuidToId.get(asset.ownerGuid)
        if (ownerId == null) continue
        const existing = await tx.assets
          .where('[ownerType+ownerId]')
          .equals([asset.ownerType, ownerId])
          .toArray()
        const found = existing.find((a) => a.side === asset.side)
        if (!found) {
          const rec = { ...asset, ownerId } as CatalogAsset
          delete (rec as Partial<CatalogAsset>).id
          await tx.assets.add(rec)
        } else if (found.id != null) {
          const res = ownerResolution.get(resolutionKey(asset.ownerType === 'postmark' ? 'postmark' : 'cover', asset.ownerGuid))
          if (res === 'imported') {
            await tx.assets.update(found.id, { ...asset, ownerId } as Partial<CatalogAsset>)
          }
        }
      }
    }
  )

  return { applied: true, added, updated, skipped }
}
