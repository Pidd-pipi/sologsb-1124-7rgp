/**
 * 离线合并通道。
 *
 * 两台电脑各自整理后导出「合并档案」（JSON），回家在本机离线导入：
 * 1. 按稳定编目键识别同一记录（邮戳 pmNo / 封 coverNo / 邮路 routeNo / 票戳组合 entryKey）；
 * 2. 同键但双方都改过的，逐字段保留双方内容与修改时间，供人工挑选；
 * 3. 跨对象引用（封→邮戳、封→邮路、票戳组合→封）先对账成稳定键，
 *    被引用对象在档案里缺项时拦截，缺项补齐（重新导出）后才允许完成；
 * 4. 提交在单个 Dexie 事务内完成，任一步失败整体回滚，现有数据保持原样，可重试。
 */
import type { CatalogAsset, AssetOwnerType, AssetSide } from '@/types/asset'
import type { Cover, FrankingItem } from '@/types/cover'
import type { Postmark } from '@/types/postmark'
import type { PostalRoute, RouteNode } from '@/types/route'
import type { StamplessEntry } from '@/types/stampentry'
import { db } from '@/utils/db'
import { entryContentKey, newEntryKey } from '@/utils/id'

/* ------------------------------ 档案格式 ------------------------------ */

export const MERGE_ARCHIVE_KIND = 'gbpostmark-merge-archive'
export const MERGE_ARCHIVE_VERSION = 1
export const MERGE_FILE_EXT = '.gbpostmark.json'

export interface MergeArchive {
  kind: typeof MERGE_ARCHIVE_KIND
  formatVersion: number
  exportedAt: string
  /** 导出端标识，如「家里电脑」，供对账界面区分双方 */
  deviceName: string
  postmarks: Postmark[]
  covers: Cover[]
  routes: PostalRoute[]
  stampEntries: StamplessEntry[]
  assets: CatalogAsset[]
}

export interface MergeParseResult {
  ok: boolean
  error?: string
  archive?: MergeArchive
}

/** 导出当前库为合并档案；原图资产一并带上，离线合并无需再向对端索取。 */
export async function exportMergeArchive(deviceName: string): Promise<MergeArchive> {
  const [postmarks, covers, routes, stampEntries, assets] = await Promise.all([
    db.postmarks.orderBy('pmNo').toArray(),
    db.covers.orderBy('coverNo').toArray(),
    db.routes.orderBy('routeNo').toArray(),
    db.stampEntries.toArray(),
    db.assets.toArray()
  ])
  return {
    kind: MERGE_ARCHIVE_KIND,
    formatVersion: MERGE_ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    deviceName: deviceName.trim() || '对端电脑',
    postmarks,
    covers,
    routes,
    stampEntries,
    assets
  }
}

/** 档案文件名为「对端标识-导出时间」，固定 .gbpostmark.json 后缀。 */
export function mergeArchiveFileName(archive: MergeArchive): string {
  const stamp = archive.exportedAt
    ? archive.exportedAt.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
    : 'export'
  const safeName = (archive.deviceName || 'device').replace(/[\\/:*?"<>|\s]+/g, '_')
  return `${safeName}-${stamp}${MERGE_FILE_EXT}`
}

/** 读取并校验一份合并档案文本。 */
export function parseMergeArchive(text: string): MergeParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: '文件不是合法的 JSON，请确认导出的合并档案未被改动。' }
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: '档案内容为空或格式不正确。' }
  }
  const obj = raw as Partial<MergeArchive>
  if (obj.kind !== MERGE_ARCHIVE_KIND) {
    return { ok: false, error: `缺少档案标识「${MERGE_ARCHIVE_KIND}」，不是本编目台导出的合并档案。` }
  }
  if (typeof obj.formatVersion !== 'number' || obj.formatVersion > MERGE_ARCHIVE_VERSION) {
    return {
      ok: false,
      error: `档案格式版本 ${obj.formatVersion ?? '未知'} 高于本机支持的 v${MERGE_ARCHIVE_VERSION}，请先升级本应用。`
    }
  }
  const archive: MergeArchive = {
    kind: MERGE_ARCHIVE_KIND,
    formatVersion: obj.formatVersion,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
    deviceName: typeof obj.deviceName === 'string' ? obj.deviceName : '对端电脑',
    postmarks: Array.isArray(obj.postmarks) ? (obj.postmarks as Postmark[]) : [],
    covers: Array.isArray(obj.covers) ? (obj.covers as Cover[]) : [],
    routes: Array.isArray(obj.routes) ? (obj.routes as PostalRoute[]) : [],
    stampEntries: Array.isArray(obj.stampEntries) ? (obj.stampEntries as StamplessEntry[]) : [],
    assets: Array.isArray(obj.assets) ? (obj.assets as CatalogAsset[]) : []
  }
  const noKey: string[] = []
  archive.postmarks.forEach((p) => {
    if (!p || !String(p.pmNo || '').trim()) noKey.push('邮戳（缺编目号）')
  })
  archive.covers.forEach((c) => {
    if (!c || !String(c.coverNo || '').trim()) noKey.push('实寄封（缺封号）')
  })
  archive.routes.forEach((r) => {
    if (!r || !String(r.routeNo || '').trim()) noKey.push('邮路（缺邮路号）')
  })
  if (noKey.length) {
    return { ok: false, error: `档案内有 ${noKey.length} 条记录缺少稳定编目键（编目号/封号/邮路号），无法对账。` }
  }
  return { ok: true, archive }
}

/* ------------------------------ 对账计划 ------------------------------ */

export type MergeSide = 'local' | 'incoming'
export type MergeKind = 'postmark' | 'cover' | 'route' | 'entry'
export type MergeStatus = 'identical' | 'localOnly' | 'incomingOnly' | 'conflict'
export type MissingRefKind = 'postmark' | 'route' | 'cover'

export interface FieldMeta {
  key: string
  label: string
}

export const FIELD_META: Record<MergeKind, FieldMeta[]> = {
  postmark: [
    { key: 'type', label: '戳型' },
    { key: 'office', label: '使用局所' },
    { key: 'province', label: '省份' },
    { key: 'yearFrom', label: '年代起' },
    { key: 'yearTo', label: '年代止' },
    { key: 'dateOnStamp', label: '戳面日期' },
    { key: 'inkColor', label: '墨色' },
    { key: 'diameter', label: '戳径' },
    { key: 'lettering', label: '戳面文字' },
    { key: 'bilingual', label: '中英双文字' },
    { key: 'scarceLevel', label: '稀见度' },
    { key: 'note', label: '备注' }
  ],
  cover: [
    { key: 'sentFrom', label: '寄出地' },
    { key: 'sentTo', label: '收件地' },
    { key: 'postDate', label: '寄出日期' },
    { key: 'arriveDate', label: '到达日期' },
    { key: 'franking', label: '贴票构成' },
    { key: 'cancelPmIds', label: '销票邮戳' },
    { key: 'routeId', label: '所属邮路' },
    { key: 'viaPoints', label: '中转地' },
    { key: 'registered', label: '给据' },
    { key: 'conditionGrade', label: '品相' },
    { key: 'acquireFrom', label: '来源' },
    { key: 'price', label: '购入价' },
    { key: 'storageAlbum', label: '藏册页位' },
    { key: 'note', label: '备注' }
  ],
  route: [
    { key: 'name', label: '名称' },
    { key: 'era', label: '时期' },
    { key: 'transport', label: '运输方式' },
    { key: 'nodes', label: '节点' },
    { key: 'totalDays', label: '全程天数' },
    { key: 'frequency', label: '班期' },
    { key: 'remark', label: '备注' }
  ],
  entry: [
    { key: 'stampName', label: '邮票名称' },
    { key: 'denomination', label: '面值' },
    { key: 'issueYear', label: '发行年份' },
    { key: 'perforation', label: '齿度' },
    { key: 'variety', label: '变体' },
    { key: 'positionOnCover', label: '封上位置' }
  ]
}

export const KIND_LABEL: Record<MergeKind, string> = {
  postmark: '邮戳',
  cover: '实寄封',
  route: '邮路',
  entry: '票戳组合'
}

export interface FieldDiff {
  key: string
  label: string
  local: string
  incoming: string
  /** 对账时人工挑选的一方，默认取修改时间较新的一方 */
  chosen: MergeSide
}

/** 一条引用缺口：导入端记录引用了档案里没有、本机也没有的对象。 */
export interface MissingRef {
  kind: MissingRefKind
  /** 缺失对象的稳定键（邮戳号 / 邮路号）；票戳组合缺父封时为封号 */
  key: string
  /** 哪一方的记录发起了引用 */
  fromSide: MergeSide
  /** 发起引用的记录描述，如「实寄封 CV-0009」 */
  fromLabel: string
  /** 引用字段说明，如「销票邮戳」 */
  via: string
}

interface MergeItemBase {
  kind: MergeKind
  /** 稳定编目键（entry 为 entryKey） */
  stableKey: string
  /** 列表显示标题，如「PM-0001 上海邮政总局」 */
  title: string
  status: MergeStatus
  local: Record<string, unknown> | null
  incoming: Record<string, unknown> | null
  localUpdatedAt: string
  incomingUpdatedAt: string
  diffs: FieldDiff[]
}

export type MergeItem = MergeItemBase

export interface MergePlan {
  deviceName: string
  exportedAt: string
  items: MergeItem[]
  missing: MissingRef[]
  /** 本机现存但指向已不存在对象的引用（只提示，不拦截，因为不是导入端造成的） */
  warnings: string[]
}

/* ------------------------------ 工具函数 ------------------------------ */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function arr<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a && b && typeof a === 'object') {
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
      return a.every((v, i) => deepEqual(v, b[i]))
    }
    const ka = Object.keys(a as Record<string, unknown>)
    const kb = Object.keys(b as Record<string, unknown>)
    if (ka.length !== kb.length) return false
    return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  }
  return false
}

function laterSide(localAt: string, incomingAt: string): MergeSide {
  // 时间相同（常见于样例数据）时默认保留本机，用户仍可逐条改选
  return str(incomingAt) > str(localAt) ? 'incoming' : 'local'
}

function boolText(value: unknown): string {
  return value === true ? '是' : value === false ? '否' : '（空）'
}

/** 把字段值转成对账界面可读的短文本（引用字段需先经 label 映射）。 */
export function formatFieldValue(
  kind: MergeKind,
  key: string,
  value: unknown,
  refLabels: { pm?: Map<number, string>; route?: Map<number, string> }
): string {
  const empty = '（空）'
  if (key === 'lettering' && value && typeof value === 'object') {
    const v = value as { top?: string; middle?: string; bottom?: string }
    return [v.top, v.middle, v.bottom].filter((s) => !!s && str(s).trim()).join(' / ') || empty
  }
  if (key === 'bilingual' || key === 'registered') return boolText(value)
  if (key === 'nodes') {
    const nodes = arr<RouteNode>(value)
    return nodes.length ? `${nodes.length} 个节点：${nodes.map((n) => str(n.office) || '?').join(' → ')}` : empty
  }
  if (key === 'franking') {
    const items = arr<FrankingItem>(value)
    if (!items.length) return empty
    const total = items.reduce((s, f) => s + (Number(f.count) || 0), 0)
    return `${items.map((f) => `${str(f.stampName)}×${f.count ?? 0}`).join('、')}（共 ${total} 枚）`
  }
  if (key === 'viaPoints') {
    const list = arr<string>(value).filter((s) => !!str(s).trim())
    return list.length ? list.join('、') : empty
  }
  if (key === 'cancelPmIds') {
    const ids = arr<unknown>(value).map(num).filter((n): n is number => n != null)
    if (!ids.length) return empty
    const map = refLabels.pm
    return ids
      .map((id) => map?.get(id) ?? `未登记邮戳 #${id}`)
      .join('、')
  }
  if (key === 'routeId') {
    const id = num(value)
    if (id == null) return empty
    return refLabels.route?.get(id) ?? `未登记邮路 #${id}`
  }
  if (value == null || value === '') return empty
  if (Array.isArray(value)) return value.length ? value.map((v) => str(v)).join('、') : empty
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

interface SideIndex {
  postmarks: Map<string, Postmark>
  covers: Map<string, Cover>
  routes: Map<string, PostalRoute>
  pmLabelById: Map<number, string>
  routeLabelById: Map<number, string>
}

function buildSideIndex(
  postmarks: Postmark[],
  covers: Cover[],
  routes: PostalRoute[]
): SideIndex {
  const index: SideIndex = {
    postmarks: new Map(),
    covers: new Map(),
    routes: new Map(),
    pmLabelById: new Map(),
    routeLabelById: new Map()
  }
  for (const p of postmarks) {
    const no = str(p.pmNo).trim()
    if (no) index.postmarks.set(no, p)
    if (typeof p.id === 'number') index.pmLabelById.set(p.id, `${p.pmNo} ${p.office}`)
  }
  for (const c of covers) {
    const no = str(c.coverNo).trim()
    if (no) index.covers.set(no, c)
  }
  for (const r of routes) {
    const no = str(r.routeNo).trim()
    if (no) index.routes.set(no, r)
    if (typeof r.id === 'number') index.routeLabelById.set(r.id, `${r.routeNo} ${r.name}`)
  }
  return index
}

/** 取票戳组合的稳定键：优先 entryKey，缺失时按「封号 + 组合内容」确定性生成。 */
function resolveEntryKey(entry: StamplessEntry, side: SideIndex): string {
  const explicit = str(entry.entryKey).trim()
  if (explicit) return explicit
  const coverNo = typeof entry.coverId === 'number' ? findCoverNoById(side, entry.coverId) : ''
  return entryContentKey(coverNo, {
    stampName: str(entry.stampName),
    denomination: num(entry.denomination) ?? 0,
    issueYear: num(entry.issueYear) ?? 0,
    perforation: str(entry.perforation),
    variety: str(entry.variety) as StamplessEntry['variety'],
    positionOnCover: str(entry.positionOnCover) as StamplessEntry['positionOnCover']
  })
}

function findCoverNoById(side: SideIndex, id: number): string {
  for (const c of side.covers.values()) {
    if (c.id === id) return c.coverNo
  }
  return ''
}

function pmTitle(p: Postmark): string {
  return `${p.pmNo} ${p.office}`.trim()
}
function coverTitle(c: Cover): string {
  return `${c.coverNo} ${c.sentFrom}→${c.sentTo}`.trim()
}
function routeTitle(r: PostalRoute): string {
  return `${r.routeNo} ${r.name}`.trim()
}
function entryTitle(e: StamplessEntry, side: SideIndex): string {
  const coverNo = findCoverNoById(side, e.coverId)
  return `${coverNo || '未挂封'} · ${str(e.stampName) || '未命名邮票'} ${
    e.variety && e.variety !== '正品' ? `（${e.variety}）` : ''
  }`.trim()
}

/** 按封号在一侧索引里找到封的表内 id。 */
function idOfCoverNo(side: SideIndex, coverNo: string): number | null {
  const c = side.covers.get(coverNo)
  return c && typeof c.id === 'number' ? c.id : null
}

function rawOf(value: unknown): Record<string, unknown> {
  return asRecord(JSON.parse(JSON.stringify(value ?? {})))
}

function makeItem(
  kind: MergeKind,
  stableKey: string,
  title: string,
  local: Record<string, unknown> | null,
  incoming: Record<string, unknown> | null,
  localAt: string,
  incomingAt: string,
  diffs: FieldDiff[]
): MergeItem {
  let status: MergeStatus
  if (!local && incoming) status = 'incomingOnly'
  else if (local && !incoming) status = 'localOnly'
  else status = diffs.length ? 'conflict' : 'identical'
  return { kind, stableKey, title, status, local, incoming, localUpdatedAt: localAt, incomingUpdatedAt: incomingAt, diffs }
}

/* ------------------------------ 建计划 ------------------------------ */

export interface LocalSnapshot {
  postmarks: Postmark[]
  covers: Cover[]
  routes: PostalRoute[]
  stampEntries: StamplessEntry[]
}

/**
 * 纯函数：比对本机快照与对端档案，产出对账计划。
 * 不触碰数据库，便于在界面上反复调整挑选结果。
 */
export function buildMergePlan(local: LocalSnapshot, archive: MergeArchive): MergePlan {
  const localIdx = buildSideIndex(local.postmarks, local.covers, local.routes)
  const incomingIdx = buildSideIndex(archive.postmarks, archive.covers, archive.routes)

  const items: MergeItem[] = []
  const missing: MissingRef[] = []
  const warnings: string[] = []

  const keys = new Set<string>([...localIdx.postmarks.keys(), ...incomingIdx.postmarks.keys()])
  for (const key of keys) {
    const lp = localIdx.postmarks.get(key) ?? null
    const ip = incomingIdx.postmarks.get(key) ?? null
    items.push(
      makeItem(
        'postmark',
        key,
        pmTitle((lp ?? ip) as Postmark),
        lp ? rawOf(lp) : null,
        ip ? rawOf(ip) : null,
        str(lp?.updatedAt),
        str(ip?.updatedAt),
        diffFields('postmark', lp, ip, localIdx, incomingIdx)
      )
    )
  }

  const routeKeys = new Set<string>([...localIdx.routes.keys(), ...incomingIdx.routes.keys()])
  for (const key of routeKeys) {
    const lr = localIdx.routes.get(key) ?? null
    const ir = incomingIdx.routes.get(key) ?? null
    items.push(
      makeItem(
        'route',
        key,
        routeTitle((lr ?? ir) as PostalRoute),
        lr ? rawOf(lr) : null,
        ir ? rawOf(ir) : null,
        str(lr?.updatedAt),
        str(ir?.updatedAt),
        diffFields('route', lr, ir, localIdx, incomingIdx)
      )
    )
  }

  const coverKeys = new Set<string>([...localIdx.covers.keys(), ...incomingIdx.covers.keys()])
  for (const key of coverKeys) {
    const lc = localIdx.covers.get(key) ?? null
    const ic = incomingIdx.covers.get(key) ?? null
    items.push(
      makeItem(
        'cover',
        key,
        coverTitle((lc ?? ic) as Cover),
        lc ? rawOf(lc) : null,
        ic ? rawOf(ic) : null,
        str(lc?.updatedAt),
        str(ic?.updatedAt),
        diffFields('cover', lc, ic, localIdx, incomingIdx)
      )
    )
  }

  // 跨对象引用先对账：导入端封若引用了档案内不存在的邮戳/邮路（对端旧编号），
  // 或票戳组合的父封不在档案中，则属缺项，需对端补齐重新导出后才能完成。
  collectIncomingCoverRefs(archive.covers, incomingIdx, missing)

  // 票戳组合按「所属封号」分组，组内用 entryKey / 内容键顺序配对，避免内容键跨封碰撞
  const localEntriesByCover = groupEntriesByCoverNo(local.stampEntries, localIdx)
  const incomingEntriesByCover = groupEntriesByCoverNo(archive.stampEntries, incomingIdx)
  const coverNoSet = new Set<string>([
    ...localEntriesByCover.keys(),
    ...incomingEntriesByCover.keys()
  ])
  for (const coverNo of coverNoSet) {
    const localExists = localIdx.covers.has(coverNo)
    const incomingExists = incomingIdx.covers.has(coverNo)
    const lList = localEntriesByCover.get(coverNo) ?? []
    const iList = incomingEntriesByCover.get(coverNo) ?? []

    // 父封在档案中缺失（本机也没有）：无法归属，拦截，等对端把该封补进档案后再合并
    if (!incomingExists && !localExists) {
      for (const e of iList) {
        missing.push({
          kind: 'cover',
          key: coverNo || '（封号为空）',
          fromSide: 'incoming',
          fromLabel: `票戳组合「${entryTitle(e, incomingIdx)}」`,
          via: '所属实寄封'
        })
      }
      continue
    }

    // 档案带了组合但没带父封、而本机恰好有同号封：允许挂到本机封上，不算缺项
    pairEntries(lList, iList, localIdx, incomingIdx, items)
  }

  // 本机存量中悬挂的引用（与本次导入无关），仅提示
  collectLocalDanglingWarnings(local.covers, localIdx, warnings)

  return {
    deviceName: archive.deviceName,
    exportedAt: archive.exportedAt,
    items,
    missing,
    warnings
  }
}

function diffFields(
  kind: MergeKind,
  local: { updatedAt?: string } | null,
  incoming: { updatedAt?: string } | null,
  localIdx: SideIndex,
  incomingIdx: SideIndex
): FieldDiff[] {
  if (!local || !incoming) return []
  const diffs: FieldDiff[] = []
  const lr = asRecord(local)
  const ir = asRecord(incoming)
  for (const meta of FIELD_META[kind]) {
    const lv = canonicalValue(kind, meta.key, lr, localIdx)
    const iv = canonicalValue(kind, meta.key, ir, incomingIdx)
    if (!deepEqual(lv, iv)) {
      diffs.push({
        key: meta.key,
        label: meta.label,
        local: formatFieldValue(kind, meta.key, lr[meta.key], {
          pm: localIdx.pmLabelById,
          route: localIdx.routeLabelById
        }),
        incoming: formatFieldValue(kind, meta.key, ir[meta.key], {
          pm: incomingIdx.pmLabelById,
          route: incomingIdx.routeLabelById
        }),
        chosen: laterSide(str(local.updatedAt), str(incoming.updatedAt))
      })
    }
  }
  return diffs
}

/** 比较前的规范化：引用字段以「是否解析得到 + 稳定键」比较，过滤双方各自的旧编号噪声。 */
function canonicalValue(kind: MergeKind, key: string, row: Record<string, unknown>, idx: SideIndex): unknown {
  if (kind === 'cover' && key === 'cancelPmIds') {
    return arr<unknown>(row.cancelPmIds)
      .map(num)
      .filter((n): n is number => n != null)
      .map((id) => {
        const pm = findPmById(idx, id)
        // 对解析不到的悬挂引用，双方都记成同一占位，避免旧编号不同造成假性冲突
        return pm ? `pm:${pm.pmNo}` : 'pm:∅'
      })
      .sort()
  }
  if (kind === 'cover' && key === 'routeId') {
    const id = num(row.routeId)
    if (id == null) return null
    const rt = findRouteById(idx, id)
    return rt ? `route:${rt.routeNo}` : 'route:∅'
  }
  if (kind === 'entry') {
    // 票戳组合不比较 coverId（父封编号由合并引擎统一重写）
    return row[key] ?? null
  }
  return row[key] ?? null
}

function findPmById(idx: SideIndex, id: number): Postmark | null {
  for (const p of idx.postmarks.values()) if (p.id === id) return p
  return null
}

function findRouteById(idx: SideIndex, id: number): PostalRoute | null {
  for (const r of idx.routes.values()) if (r.id === id) return r
  return null
}

/**
 * 对导入端封的跨对象引用做对账：只认档案内能否按编号解析到被引用对象。
 * - 解析得到：无论该对象在本机是否已存在，都会随合并新增/命中，引用可重写，不缺项；
 * - 解析不到：封上挂的是对端库里的旧编号，合并后必然悬挂，列为缺项拦截。
 */
function collectIncomingCoverRefs(
  covers: Cover[],
  incomingIdx: SideIndex,
  missing: MissingRef[]
): void {
  for (const c of covers) {
    const pmIds = arr<unknown>(c.cancelPmIds).map(num).filter((n): n is number => n != null)
    for (const pmId of pmIds) {
      const pm = findPmById(incomingIdx, pmId)
      if (!pm) {
        missing.push({
          kind: 'postmark',
          key: `#${pmId}`,
          fromSide: 'incoming',
          fromLabel: `实寄封 ${c.coverNo}`,
          via: '销票邮戳（对端旧编号，档案中无对应邮戳）'
        })
      }
    }
    const routeId = num(c.routeId)
    if (routeId != null && !findRouteById(incomingIdx, routeId)) {
      missing.push({
        kind: 'route',
        key: `#${routeId}`,
        fromSide: 'incoming',
        fromLabel: `实寄封 ${c.coverNo}`,
        via: '所属邮路（对端旧编号，档案中无对应邮路）'
      })
    }
  }
}

function collectLocalDanglingWarnings(
  covers: Cover[],
  localIdx: SideIndex,
  warnings: string[]
): void {
  for (const c of covers) {
    for (const pmId of arr<unknown>(c.cancelPmIds).map(num).filter((n): n is number => n != null)) {
      if (!findPmById(localIdx, pmId)) {
        warnings.push(`实寄封 ${c.coverNo} 的销票邮戳 #${pmId} 在本机库中不存在（保持原样，未在本次合并中处理）。`)
      }
    }
    const routeId = num(c.routeId)
    if (routeId != null && !findRouteById(localIdx, routeId)) {
      warnings.push(`实寄封 ${c.coverNo} 的所属邮路 #${routeId} 在本机库中不存在（保持原样）。`)
    }
  }
}

function groupEntriesByCoverNo(
  entries: StamplessEntry[],
  idx: SideIndex
): Map<string, StamplessEntry[]> {
  const map = new Map<string, StamplessEntry[]>()
  for (const e of entries) {
    const coverNo = typeof e.coverId === 'number' ? findCoverNoById(idx, e.coverId) : ''
    const list = map.get(coverNo) ?? []
    list.push(e)
    map.set(coverNo, list)
  }
  return map
}

function pairEntries(
  lList: StamplessEntry[],
  iList: StamplessEntry[],
  localIdx: SideIndex,
  incomingIdx: SideIndex,
  items: MergeItem[]
): void {
  const lByKey = new Map<string, StamplessEntry[]>()
  const iByKey = new Map<string, StamplessEntry[]>()
  for (const e of lList) {
    const k = resolveEntryKey(e, localIdx)
    const list = lByKey.get(k) ?? []
    list.push(e)
    lByKey.set(k, list)
  }
  for (const e of iList) {
    const k = resolveEntryKey(e, incomingIdx)
    const list = iByKey.get(k) ?? []
    list.push(e)
    iByKey.set(k, list)
  }

  // 同键逐条配对；一方多出的同内容组合作为该侧新增
  const pairOne = (le: StamplessEntry | null, ie: StamplessEntry | null): void => {
    const ref = le ?? ie
    if (!ref) return
    items.push(
      makeItem(
        'entry',
        le ? resolveEntryKey(le, localIdx) : resolveEntryKey(ie as StamplessEntry, incomingIdx),
        entryTitle(ref, le ? localIdx : incomingIdx),
        le ? rawOf(le) : null,
        ie ? rawOf(ie) : null,
        str(le?.createdAt),
        str(ie?.createdAt),
        diffEntryFields(le, ie)
      )
    )
  }

  const allKeys = new Set<string>([...lByKey.keys(), ...iByKey.keys()])
  for (const k of allKeys) {
    const ls = lByKey.get(k) ?? []
    const is = iByKey.get(k) ?? []
    const count = Math.max(ls.length, is.length)
    for (let i = 0; i < count; i += 1) pairOne(ls[i] ?? null, is[i] ?? null)
  }
}

function diffEntryFields(local: StamplessEntry | null, incoming: StamplessEntry | null): FieldDiff[] {
  if (!local || !incoming) return []
  const diffs: FieldDiff[] = []
  const lr = asRecord(local)
  const ir = asRecord(incoming)
  for (const meta of FIELD_META.entry) {
    if (!deepEqual(lr[meta.key] ?? null, ir[meta.key] ?? null)) {
      diffs.push({
        key: meta.key,
        label: meta.label,
        local: formatFieldValue('entry', meta.key, lr[meta.key], {}),
        incoming: formatFieldValue('entry', meta.key, ir[meta.key], {}),
        // 票戳组合只有 createdAt，同键视为内容一致地并入；冲突时仍以较晚记录为准
        chosen: laterSide(str(local.createdAt), str(incoming.createdAt))
      })
    }
  }
  return diffs
}

/* ------------------------------ 计划摘要 ------------------------------ */

export interface PlanSummary {
  identical: number
  incomingOnly: number
  localOnly: number
  conflict: number
  conflictFields: number
}

export function summarizePlan(plan: MergePlan): PlanSummary {
  const summary: PlanSummary = { identical: 0, incomingOnly: 0, localOnly: 0, conflict: 0, conflictFields: 0 }
  for (const item of plan.items) {
    summary[item.status] += 1
    summary.conflictFields += item.diffs.length
  }
  return summary
}

/** 冲突项（含同键双方修改与新增/缺失引用对账后仍需挑选的字段）。 */
export function conflictItems(plan: MergePlan): MergeItem[] {
  return plan.items.filter((i) => i.status === 'conflict')
}

export function incomingItems(plan: MergePlan): MergeItem[] {
  return plan.items.filter((i) => i.status === 'incomingOnly')
}

/* ------------------------------ 应用合并 ------------------------------ */

export interface ApplyResult {
  added: Record<MergeKind, number>
  updated: Record<MergeKind, number>
  assetsUpdated: number
}

function emptyCounters(): Record<MergeKind, number> {
  return { postmark: 0, cover: 0, route: 0, entry: 0 }
}

/**
 * 按对账计划把档案写入本机库。
 * - 全部写操作在同一个 rw 事务内：任何一步抛错都会回滚，现有数据保持原样，可重新导入重试；
 * - 提交前重新在事务内校验引用缺项，防止对账后数据又被改动；
 * - 跨对象引用按稳定键重写到本机编号，新增对象使用本机自增 id；
 * - 同键冲突按每个字段挑选的一方合并，更新时间取双方较晚者。
 */
export async function applyMergePlan(
  local: LocalSnapshot,
  archive: MergeArchive,
  plan: MergePlan
): Promise<ApplyResult> {
  if (plan.missing.length) {
    throw new Error(`仍有 ${plan.missing.length} 处引用缺项未补齐，请让对端补全后重新导出再合并。`)
  }

  const result: ApplyResult = { added: emptyCounters(), updated: emptyCounters(), assetsUpdated: 0 }

  await db.transaction(
    'rw',
    db.postmarks,
    db.covers,
    db.routes,
    db.stampEntries,
    db.assets,
    async () => {
      // 事务内重新读取，保证对账依据与写入对象一致
      const [txPms, txCovers, txRoutes, txEntries, txAssets] = await Promise.all([
        db.postmarks.toArray(),
        db.covers.toArray(),
        db.routes.toArray(),
        db.stampEntries.toArray(),
        db.assets.toArray()
      ])
      const localIdx = buildSideIndex(txPms, txCovers, txRoutes)
      const incomingIdx = buildSideIndex(archive.postmarks, archive.covers, archive.routes)

      // 再次校验导入端引用缺项（防止对账后数据又被改动）
      const recheck: MissingRef[] = []
      collectIncomingCoverRefs(archive.covers, incomingIdx, recheck)
      if (recheck.length) {
        throw new Error(`合并前复核发现 ${recheck.length} 处引用缺项，已取消本次写入。`)
      }

      /* 邮戳 */
      const pmIdByNo = new Map<string, number>()
      for (const item of plan.items.filter((i) => i.kind === 'postmark')) {
        const existing = localIdx.postmarks.get(item.stableKey)
        const incoming = incomingIdx.postmarks.get(item.stableKey)
        if (existing && incoming && item.status === 'conflict') {
          const merged = mergePostmark(existing, incoming, item)
          await db.postmarks.put({ ...merged, id: existing.id as number })
          pmIdByNo.set(existing.pmNo, existing.id as number)
          result.updated.postmark += 1
        } else if (!existing && incoming) {
          const id = await db.postmarks.add(stripId(incoming))
          pmIdByNo.set(incoming.pmNo, id)
          result.added.postmark += 1
        } else if (existing) {
          pmIdByNo.set(existing.pmNo, existing.id as number)
        }
      }

      /* 邮路 */
      const routeIdByNo = new Map<string, number>()
      for (const item of plan.items.filter((i) => i.kind === 'route')) {
        const existing = localIdx.routes.get(item.stableKey)
        const incoming = incomingIdx.routes.get(item.stableKey)
        if (existing && incoming && item.status === 'conflict') {
          const merged = mergeRoute(existing, incoming, item)
          await db.routes.put({ ...merged, id: existing.id as number })
          routeIdByNo.set(existing.routeNo, existing.id as number)
          result.updated.route += 1
        } else if (!existing && incoming) {
          const id = await db.routes.add(stripId(incoming))
          routeIdByNo.set(incoming.routeNo, id)
          result.added.route += 1
        } else if (existing) {
          routeIdByNo.set(existing.routeNo, existing.id as number)
        }
      }

      /* 实寄封：引用（销票邮戳 / 所属邮路）按稳定键重写到本机编号 */
      const coverIdByNo = new Map<string, number>()
      for (const item of plan.items.filter((i) => i.kind === 'cover')) {
        const existing = localIdx.covers.get(item.stableKey)
        const incoming = incomingIdx.covers.get(item.stableKey)
        if (existing && incoming && item.status === 'conflict') {
          const merged = mergeCover(existing, incoming, item, localIdx, incomingIdx, pmIdByNo, routeIdByNo)
          await db.covers.put({ ...merged, id: existing.id as number })
          coverIdByNo.set(existing.coverNo, existing.id as number)
          result.updated.cover += 1
        } else if (!existing && incoming) {
          const record = remapNewCover(incoming, incomingIdx, pmIdByNo, routeIdByNo)
          const id = await db.covers.add(record)
          coverIdByNo.set(incoming.coverNo, id)
          result.added.cover += 1
        } else if (existing) {
          coverIdByNo.set(existing.coverNo, existing.id as number)
        }
      }

      /* 票戳组合：按稳定键配对，coverId 重写到封在本机的编号 */
      for (const item of plan.items.filter((i) => i.kind === 'entry')) {
        // 票戳组合整条取较晚一方（字段有改选时跟随改选），不做逐字段拼装
        const chosenRaw =
          item.status === 'conflict'
            ? (pickEntryRecord(item) ?? item.local)
            : item.incoming
              ? item.incoming
              : item.local
        if (!chosenRaw) continue
        const chosen = chosenRaw as unknown as StamplessEntry
        const coverNo = entryCoverNo(item, localIdx, incomingIdx)
        const targetCoverId = coverIdByNo.get(coverNo) ?? idOfCoverNo(localIdx, coverNo)
        if (targetCoverId == null) {
          throw new Error(`票戳组合「${item.title}」所属实寄封 ${coverNo} 未能定位，已取消写入。`)
        }
        const key = str(chosen.entryKey).trim() || item.stableKey
        const localEntry = txEntries.find((e) => str(e.entryKey).trim() === key)
        if (localEntry && typeof localEntry.id === 'number') {
          if (item.status === 'conflict' && chosenRaw === item.incoming) {
            await db.stampEntries.put({
              ...stripId(chosen),
              id: localEntry.id,
              entryKey: key,
              coverId: targetCoverId
            })
            result.updated.entry += 1
          }
        } else if (item.incoming) {
          const record: StamplessEntry = {
            ...stripId(chosen),
            entryKey: key || newEntryKey(),
            coverId: targetCoverId
          }
          await db.stampEntries.add(record)
          result.added.entry += 1
        }
      }

      /* 原图资产：按 owner 稳定键定位本机对象，同 owner+side 取较新文件，缺则新增 */
      const assetKey = (a: CatalogAsset): string => `${a.ownerType}|${a.ownerId}|${a.side}`
      const localAssetByKey = new Map(txAssets.map((a) => [assetKey(a), a]))
      for (const asset of archive.assets) {
        const ownerId = resolveAssetOwnerId(asset, pmIdByNo, coverIdByNo, localIdx, incomingIdx)
        if (ownerId == null) continue // 被引用对象不在合并结果中，跳过（不应发生，缺项已拦截）
        const key = `${asset.ownerType}|${ownerId}|${asset.side}`
        const existingAsset = localAssetByKey.get(key) ?? findAssetByOwner(txAssets, asset.ownerType, ownerId, asset.side)
        if (!existingAsset) {
          await db.assets.add(stripId({ ...asset, ownerId }))
          result.assetsUpdated += 1
          continue
        }
        if (str(asset.updatedAt) > str(existingAsset.updatedAt)) {
          await db.assets.update(existingAsset.id as number, {
            dataUrl: asset.dataUrl,
            fileName: asset.fileName,
            updatedAt: asset.updatedAt
          })
          result.assetsUpdated += 1
        }
      }

      /* 缩略图：同键记录本机缩略图为空、对端带图时顺带补齐（不作为冲突字段） */
      await syncThumbnails(plan, localIdx, incomingIdx)
    }
  )

  return result
}

function findAssetByOwner(
  assets: CatalogAsset[],
  ownerType: AssetOwnerType,
  ownerId: number,
  side: AssetSide
): CatalogAsset | undefined {
  return assets.find((a) => a.ownerType === ownerType && a.ownerId === ownerId && a.side === side)
}

function resolveAssetOwnerId(
  asset: CatalogAsset,
  pmIdByNo: Map<string, number>,
  coverIdByNo: Map<string, number>,
  localIdx: SideIndex,
  incomingIdx: SideIndex
): number | null {
  if (asset.ownerType === 'postmark') {
    const pm = findPmById(incomingIdx, asset.ownerId)
    if (!pm) return null
    return pmIdByNo.get(pm.pmNo) ?? localIdx.postmarks.get(pm.pmNo)?.id ?? null
  }
  const cover = findCoverById(incomingIdx, asset.ownerId)
  if (!cover) return null
  return coverIdByNo.get(cover.coverNo) ?? localIdx.covers.get(cover.coverNo)?.id ?? null
}

function findCoverById(idx: SideIndex, id: number): Cover | null {
  for (const c of idx.covers.values()) if (c.id === id) return c
  return null
}

async function syncThumbnails(
  plan: MergePlan,
  localIdx: SideIndex,
  incomingIdx: SideIndex
): Promise<void> {
  for (const item of plan.items) {
    if (item.kind === 'postmark') {
      const local = localIdx.postmarks.get(item.stableKey)
      const incoming = incomingIdx.postmarks.get(item.stableKey)
      if (local && incoming && typeof local.id === 'number') {
        if (!str(local.imageDataUrl) && str(incoming.imageDataUrl)) {
          await db.postmarks.update(local.id, { imageDataUrl: incoming.imageDataUrl })
        }
      }
    }
    if (item.kind === 'cover') {
      const local = localIdx.covers.get(item.stableKey)
      const incoming = incomingIdx.covers.get(item.stableKey)
      if (local && incoming && typeof local.id === 'number') {
        const patch: Partial<Cover> = {}
        if (!str(local.frontImage) && str(incoming.frontImage)) patch.frontImage = incoming.frontImage
        if (!str(local.backImage) && str(incoming.backImage)) patch.backImage = incoming.backImage
        if (Object.keys(patch).length) await db.covers.update(local.id, patch)
      }
    }
  }
}

function entryCoverNo(item: MergeItem, localIdx: SideIndex, incomingIdx: SideIndex): string {
  // 票戳组合条目标题以封号开头，但稳定归属以引用侧的 coverId 反查为准
  if (item.incoming) {
    const e = item.incoming as unknown as StamplessEntry
    if (typeof e.coverId === 'number') {
      const no = findCoverById(incomingIdx, e.coverId)?.coverNo
      if (no) return no
    }
  }
  if (item.local) {
    const e = item.local as unknown as StamplessEntry
    if (typeof e.coverId === 'number') {
      const no = findCoverById(localIdx, e.coverId)?.coverNo
      if (no) return no
    }
  }
  return item.title.split(' ')[0]
}

/** 票戳组合冲突时：任一字段改选对端则整条取对端，否则取本机（createdAt 较晚优先在对账时定好）。 */
function pickEntryRecord(item: MergeItem): Record<string, unknown> | null {
  return item.diffs.some((d) => d.chosen === 'incoming') ? item.incoming : item.local
}

function chosenValue(item: MergeItem, key: string, fallback: unknown): unknown {
  const diff = item.diffs.find((d) => d.key === key)
  const side: MergeSide = diff ? diff.chosen : 'local'
  const src = side === 'incoming' ? item.incoming : item.local
  return src ? (src as unknown as Record<string, unknown>)[key] : fallback
}

function latestIso(a: string, b: string): string {
  return str(a) >= str(b) ? a : b
}

function mergePostmark(local: Postmark, incoming: Postmark, item: MergeItem): Postmark {
  const pick = (key: keyof Postmark): unknown =>
    chosenValue(item, key, (local as unknown as Record<string, unknown>)[key as string])
  return {
    ...local,
    type: pick('type') as Postmark['type'],
    office: str(pick('office')),
    province: str(pick('province')),
    yearFrom: num(pick('yearFrom')) ?? local.yearFrom,
    yearTo: num(pick('yearTo')) ?? local.yearTo,
    dateOnStamp: str(pick('dateOnStamp')),
    inkColor: str(pick('inkColor')),
    diameter: num(pick('diameter')) ?? local.diameter,
    lettering: (pick('lettering') as Postmark['lettering']) ?? { ...local.lettering },
    bilingual: pick('bilingual') === true,
    scarceLevel: pick('scarceLevel') as Postmark['scarceLevel'],
    note: str(pick('note')),
    updatedAt: latestIso(local.updatedAt, incoming.updatedAt)
  }
}

function mergeRoute(local: PostalRoute, incoming: PostalRoute, item: MergeItem): PostalRoute {
  const pick = (key: keyof PostalRoute): unknown =>
    chosenValue(item, key, (local as unknown as Record<string, unknown>)[key as string])
  const nodes = (pick('nodes') as RouteNode[] | undefined) ?? local.nodes
  return {
    ...local,
    name: str(pick('name')),
    era: str(pick('era')),
    transport: pick('transport') as PostalRoute['transport'],
    nodes: nodes.map((n) => ({ ...n })),
    totalDays: num(pick('totalDays')) ?? local.totalDays,
    frequency: str(pick('frequency')),
    remark: str(pick('remark')),
    updatedAt: latestIso(local.updatedAt, incoming.updatedAt)
  }
}

function mergeCover(
  local: Cover,
  incoming: Cover,
  item: MergeItem,
  localIdx: SideIndex,
  incomingIdx: SideIndex,
  pmIdByNo: Map<string, number>,
  routeIdByNo: Map<string, number>
): Cover {
  const pick = (key: keyof Cover): unknown =>
    chosenValue(item, key, (local as unknown as Record<string, unknown>)[key as string])
  const cancelFromIncoming = item.diffs.some((d) => d.key === 'cancelPmIds' && d.chosen === 'incoming')
  const routeFromIncoming = item.diffs.some((d) => d.key === 'routeId' && d.chosen === 'incoming')
  const rawCancel = pick('cancelPmIds')
  const cancelPmIds = remapPmIds(
    Array.isArray(rawCancel) ? (rawCancel as unknown[]) : local.cancelPmIds,
    cancelFromIncoming ? incomingIdx : localIdx,
    pmIdByNo
  )
  const rawRouteId = pick('routeId')
  const routeId = remapRouteId(
    rawRouteId,
    routeFromIncoming ? incomingIdx : localIdx,
    routeIdByNo
  )
  const franking = (pick('franking') as FrankingItem[] | undefined) ?? local.franking
  return {
    ...local,
    sentFrom: str(pick('sentFrom')),
    sentTo: str(pick('sentTo')),
    postDate: str(pick('postDate')),
    arriveDate: str(pick('arriveDate')),
    franking: franking.map((f) => ({ ...f })),
    cancelPmIds,
    routeId,
    viaPoints: (pick('viaPoints') as string[] | undefined) ?? [...local.viaPoints],
    registered: pick('registered') === true,
    conditionGrade: pick('conditionGrade') as Cover['conditionGrade'],
    acquireFrom: str(pick('acquireFrom')),
    price: num(pick('price')) ?? local.price,
    storageAlbum: str(pick('storageAlbum')),
    note: str(pick('note')),
    updatedAt: latestIso(local.updatedAt, incoming.updatedAt)
  }
}

function remapNewCover(
  incoming: Cover,
  incomingIdx: SideIndex,
  pmIdByNo: Map<string, number>,
  routeIdByNo: Map<string, number>
): Cover {
  return {
    ...stripId(incoming),
    cancelPmIds: remapPmIds(incoming.cancelPmIds, incomingIdx, pmIdByNo),
    routeId: remapRouteId(incoming.routeId, incomingIdx, routeIdByNo)
  }
}

/** 把一侧编号下的邮戳 id 翻译成稳定键，再映射到本机合并后的 id；解析不到的旧编号丢弃。 */
function remapPmIds(
  ids: unknown[],
  sourceIdx: SideIndex,
  pmIdByNo: Map<string, number>
): number[] {
  const out: number[] = []
  for (const rawId of ids.map(num).filter((n): n is number => n != null)) {
    const pm = findPmById(sourceIdx, rawId)
    if (!pm) continue
    const targetId = pmIdByNo.get(pm.pmNo)
    if (typeof targetId === 'number' && !out.includes(targetId)) out.push(targetId)
  }
  return out
}

function remapRouteId(
  rawId: unknown,
  sourceIdx: SideIndex,
  routeIdByNo: Map<string, number>
): number | null {
  const id = num(rawId)
  if (id == null) return null
  const rt = findRouteById(sourceIdx, id)
  if (!rt) return null
  return routeIdByNo.get(rt.routeNo) ?? null
}

function stripId<T extends { id?: number }>(record: T): T {
  const clone = { ...record }
  delete clone.id
  return clone
}
