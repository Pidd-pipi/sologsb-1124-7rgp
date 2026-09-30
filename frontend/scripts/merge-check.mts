/**
 * 离线合并通道端到端验证（内存 IndexedDB，不触碰浏览器真实数据）。
 * 运行：npx vite-node scripts/merge-check.mts
 */
import 'fake-indexeddb/auto'

import { GbPostmarkDatabase } from '../src/utils/db'
import { db as boundDb } from '../src/utils/db'
import type { Cover } from '../src/types/cover'
import type { Postmark } from '../src/types/postmark'
import type { PostalRoute } from '../src/types/route'
import type { StamplessEntry } from '../src/types/stampentry'
import Dexie from 'dexie'
import {
  applyMergePlan,
  buildMergePlan,
  exportMergeArchive,
  parseMergeArchive,
  type LocalSnapshot,
  type MergeArchive
} from '../src/utils/merge'
import { entryContentKey } from '../src/utils/id'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${msg}`)
  } else {
    failed += 1
    console.error(`  ✗ ${msg}`)
  }
}

async function resetBoundDb(): Promise<void> {
  if (boundDb.isOpen()) boundDb.close()
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('gbpostmark')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('delete blocked'))
  })
  await boundDb.open()
}

async function snapshot(): Promise<LocalSnapshot> {
  return {
    postmarks: await boundDb.postmarks.toArray(),
    covers: await boundDb.covers.toArray(),
    routes: await boundDb.routes.toArray(),
    stampEntries: await boundDb.stampEntries.toArray()
  }
}

const T0 = '2026-09-01T08:00:00.000Z'
const T1 = '2026-09-10T08:00:00.000Z'
const T2 = '2026-09-20T08:00:00.000Z'

function pm(over: Partial<Postmark> & Pick<Postmark, 'pmNo'>): Postmark {
  return {
    type: '圆形日戳',
    office: '北京邮局',
    province: '北京',
    yearFrom: 1920,
    yearTo: 1930,
    dateOnStamp: '1925-01-01',
    inkColor: '黑',
    diameter: 26,
    lettering: { top: '北京', middle: '', bottom: '' },
    bilingual: false,
    scarceLevel: '常见',
    imageDataUrl: '',
    note: '',
    createdAt: T0,
    updatedAt: T0,
    ...over
  }
}

function route(over: Partial<PostalRoute> & Pick<PostalRoute, 'routeNo'>): PostalRoute {
  return {
    name: '测试邮路',
    era: '1920-1929',
    transport: '铁路',
    nodes: [],
    totalDays: 0,
    frequency: '逐日班',
    remark: '',
    createdAt: T0,
    updatedAt: T0,
    ...over
  }
}

function cover(over: Partial<Cover> & Pick<Cover, 'coverNo'>): Cover {
  return {
    sentFrom: '北京',
    sentTo: '天津',
    postDate: '1925-01-01',
    arriveDate: '',
    franking: [],
    cancelPmIds: [],
    routeId: null,
    viaPoints: [],
    registered: false,
    conditionGrade: '中品',
    acquireFrom: '',
    price: 0,
    storageAlbum: '',
    frontImage: '',
    backImage: '',
    note: '',
    createdAt: T0,
    updatedAt: T0,
    ...over
  }
}

function archive(part: Partial<MergeArchive>): MergeArchive {
  return {
    kind: 'gbpostmark-merge-archive',
    formatVersion: 1,
    exportedAt: T1,
    deviceName: '外出电脑',
    postmarks: [],
    covers: [],
    routes: [],
    stampEntries: [],
    assets: [],
    ...part
  }
}

async function testAReferenceRemap(): Promise<void> {
  console.log('\n[A] 同键去重 + 对端旧编号引用重写')
  await resetBoundDb()
  const localPm = pm({ pmNo: 'PM-0001', office: '上海邮政总局', province: '上海' })
  const localPmId = await boundDb.postmarks.add(localPm)
  const localRtId = await boundDb.routes.add(route({ routeNo: 'RT-0001' }))
  await boundDb.covers.add(
    cover({ coverNo: 'CV-0001', cancelPmIds: [localPmId], routeId: localRtId })
  )

  // 对端库：同枚邮戳在对端 id=77、同条邮路 id=66；新邮戳 PM-0010 对端 id=99
  const incomingPm = { ...pm({ pmNo: 'PM-0001', office: '上海邮政总局', province: '上海' }), id: 77 }
  const newPm = { ...pm({ pmNo: 'PM-0010', office: '保定邮局', province: '河北' }), id: 99 }
  const incomingRt = { ...route({ routeNo: 'RT-0001' }), id: 66 }
  const incomingCover = {
    ...cover({ coverNo: 'CV-0010', sentFrom: '保定', cancelPmIds: [77, 99], routeId: 66 }),
    id: 88
  }
  const incomingEntry: StamplessEntry = {
    id: 44,
    entryKey: 'ek-fixed-1',
    coverId: 88,
    stampName: '帆船邮票',
    denomination: 4,
    issueYear: 1913,
    perforation: 'P14',
    variety: '正品',
    positionOnCover: '右上',
    createdAt: T1
  }

  const pack = archive({
    postmarks: [incomingPm, newPm],
    routes: [incomingRt],
    covers: [incomingCover],
    stampEntries: [incomingEntry],
    assets: [
      { id: 1, ownerType: 'postmark', ownerId: 99, side: 'sample', dataUrl: 'data:x', fileName: 'a.png', updatedAt: T1 }
    ]
  })

  const plan = buildMergePlan(await snapshot(), pack)
  assert(plan.missing.length === 0, '引用对账无缺项')
  assert(!plan.items.some((i) => i.kind === 'postmark' && i.stableKey === 'PM-0001' && i.status !== 'identical'),
    '双方都有的 PM-0001 识别为同一记录（一致），不拆成重复档案')
  assert(plan.items.some((i) => i.stableKey === 'PM-0010' && i.status === 'incomingOnly'), 'PM-0010 识别为对端新增')

  const result = await applyMergePlan(await snapshot(), pack, plan)
  assert(result.added.postmark === 1 && result.updated.postmark === 0, '仅新增 1 枚邮戳，无重复')

  const mergedCover = await boundDb.covers.where('coverNo').equals('CV-0010').first()
  assert(!!mergedCover, '对端实寄封 CV-0010 已入库')
  const pm1 = await boundDb.postmarks.where('pmNo').equals('PM-0001').first()
  const pm10 = await boundDb.postmarks.where('pmNo').equals('PM-0010').first()
  assert(
    JSON.stringify(mergedCover!.cancelPmIds) === JSON.stringify([pm1!.id, pm10!.id]),
    `销票邮戳旧编号 [77,99] 已重写为本机编号 [${pm1!.id},${pm10!.id}]，实际：${JSON.stringify(mergedCover!.cancelPmIds)}`
  )
  assert(mergedCover!.routeId === localRtId, `所属邮路旧编号 66 已重写为本机 ${localRtId}`)

  const entries = await boundDb.stampEntries.toArray()
  const addedEntry = entries.find((e) => e.entryKey === 'ek-fixed-1')
  assert(!!addedEntry && addedEntry.coverId === mergedCover!.id,
    `票戳组合挂到新封本机编号（实际 coverId=${addedEntry?.coverId}）`)
  const asset = await boundDb.assets.toArray()
  assert(asset.some((a) => a.ownerType === 'postmark' && a.ownerId === pm10!.id && a.side === 'sample'),
    '新邮戳的原图随 owner 重映射入库')
}

async function testBFieldPick(): Promise<void> {
  console.log('\n[B] 同键双方修改：逐字段保留双方内容与时间，按挑选合并')
  await resetBoundDb()
  await boundDb.postmarks.add(pm({
    pmNo: 'PM-0001', office: '上海邮政总局', note: '本机备注', updatedAt: T2
  }))
  const pack = archive({
    postmarks: [
      { id: 77, ...pm({ pmNo: 'PM-0001', office: '上海邮局（对端改）', note: '对端备注', updatedAt: T1 }) }
    ]
  })
  const plan = buildMergePlan(await snapshot(), pack)
  const item = plan.items.find((i) => i.stableKey === 'PM-0001')!
  assert(item.status === 'conflict' && item.diffs.length === 2, `发现 2 个冲突字段（局所/备注），实际 ${item.diffs.length}`)
  const officeDiff = item.diffs.find((d) => d.key === 'office')!
  const noteDiff = item.diffs.find((d) => d.key === 'note')!
  assert(officeDiff.chosen === 'local', '默认采用修改时间较新的本机（T2 > T1）')
  assert(officeDiff.local.includes('上海邮政总局') && officeDiff.incoming.includes('上海邮局'),
    '双方内容都保留在计划中供挑选')
  // 用户把「备注」改选成对端
  noteDiff.chosen = 'incoming'

  await applyMergePlan(await snapshot(), pack, plan)
  const merged = (await boundDb.postmarks.where('pmNo').equals('PM-0001').first())!
  assert(merged.office === '上海邮政总局', '局所采用本机内容')
  assert(merged.note === '对端备注', '备注采用对端内容')
  assert(merged.updatedAt === T2, '合并记录更新时间取双方较晚者')
}

async function testCMissingRef(): Promise<void> {
  console.log('\n[C] 引用缺项：拦截且不写入，补齐后重试成功')
  await resetBoundDb()
  const badPack = archive({
    covers: [
      { id: 88, ...cover({ coverNo: 'CV-0020', cancelPmIds: [123], routeId: 124 }) }
    ]
  })
  const plan = buildMergePlan(await snapshot(), badPack)
  assert(plan.missing.length === 2, `缺 1 枚邮戳 + 1 条邮路（实际 ${plan.missing.length}）`)
  let threw = false
  try {
    await applyMergePlan(await snapshot(), badPack, plan)
  } catch {
    threw = true
  }
  assert(threw, 'apply 在缺项时拒绝提交')
  assert((await boundDb.covers.count()) === 0, '本机数据保持原样（0 个封）')

  // 对端补齐缺项后重新导出，再合并
  const goodPack = archive({
    postmarks: [{ id: 123, ...pm({ pmNo: 'PM-0020' }) }],
    routes: [{ id: 124, ...route({ routeNo: 'RT-0020' }) }],
    covers: [
      { id: 88, ...cover({ coverNo: 'CV-0020', cancelPmIds: [123], routeId: 124 }) }
    ]
  })
  const plan2 = buildMergePlan(await snapshot(), goodPack)
  assert(plan2.missing.length === 0, '补齐后对账无缺项')
  const result = await applyMergePlan(await snapshot(), goodPack, plan2)
  assert(result.added.cover === 1, '重试成功，实寄封入库')
  const cv = (await boundDb.covers.where('coverNo').equals('CV-0020').first())!
  assert(cv.cancelPmIds.length === 1 && cv.routeId != null, '引用已重写到本机新编号')
}

async function testDRollbackRetry(): Promise<void> {
  console.log('\n[D] 提交中途失败：事务整体回滚，现有数据不动，可重试')
  await resetBoundDb()
  const pack = archive({
    postmarks: [{ id: 99, ...pm({ pmNo: 'PM-0010' }) }],
    assets: [
      { id: 1, ownerType: 'postmark', ownerId: 99, side: 'sample', dataUrl: 'data:x', fileName: 'a.png', updatedAt: T1 }
    ]
  })
  const plan = buildMergePlan(await snapshot(), pack)

  const before = await boundDb.postmarks.count()
  const table = boundDb.assets as unknown as { add: (...args: unknown[]) => Promise<unknown> }
  const original = table.add
  table.add = async () => {
    throw new Error('模拟磁盘写入失败')
  }
  let threw = false
  try {
    await applyMergePlan(await snapshot(), pack, plan)
  } catch (err) {
    threw = String((err as Error).message).includes('模拟磁盘写入失败')
  }
  table.add = original
  assert(threw, '写入异常向上抛出')
  assert((await boundDb.postmarks.count()) === before, '事务回滚：已写入的邮戳一并撤销，现有数据保持原样')

  const retry = await applyMergePlan(await snapshot(), pack, buildMergePlan(await snapshot(), pack))
  assert(retry.added.postmark === 1, '重新导入重试成功')
}

/** 旧版（v2，票戳组合无 entryKey）数据库升级到 v3 后，旧记录照样参加合并且不重复。 */
async function testELegacyUpgrade(): Promise<void> {
  console.log('\n[E] v2 旧数据升级 v3 后参加合并（内容稳定键回填）')
  if (boundDb.isOpen()) boundDb.close()
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('gbpostmark')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
  })

  // 用只声明到 v2 的旧结构建库并写入无 entryKey 的数据
  class LegacyDb extends Dexie {
    postmarks!: Dexie.Table<Postmark, number>
    covers!: Dexie.Table<Cover, number>
    routes!: Dexie.Table<PostalRoute, number>
    stampEntries!: Dexie.Table<StamplessEntry, number>
    constructor() {
      super('gbpostmark')
      this.version(1).stores({
        postmarks: '++id, pmNo, type, office, province, yearFrom, yearTo, scarceLevel',
        covers: '++id, coverNo, sentFrom, sentTo, postDate, conditionGrade, registered',
        routes: '++id, routeNo, name, era, transport',
        stampEntries: '++id, coverId, stampName, variety',
        assets: '++id, ownerType, ownerId, side'
      })
      this.version(2).stores({
        postmarks: '++id, pmNo, type, office, province, yearFrom, yearTo, scarceLevel, inkColor, bilingual',
        covers: '++id, coverNo, sentFrom, sentTo, postDate, conditionGrade, registered, routeId, acquireFrom',
        routes: '++id, routeNo, name, era, transport, totalDays',
        stampEntries: '++id, coverId, stampName, variety, issueYear',
        assets: '++id, ownerType, ownerId, side, [ownerType+ownerId]'
      })
    }
  }
  const legacy = new LegacyDb()
  await legacy.open()
  await legacy.covers.add(cover({ coverNo: 'CV-0001' }))
  const legacyEntry = {
    coverId: 1,
    stampName: '蟠龙邮票',
    denomination: 3,
    issueYear: 1908,
    perforation: 'P14',
    variety: '正品' as const,
    positionOnCover: '右上' as const,
    createdAt: T0
  }
  await legacy.stampEntries.add(legacyEntry as StamplessEntry)
  assert((await legacy.stampEntries.toArray())[0].entryKey === undefined, '旧库记录确实没有 entryKey')
  legacy.close()

  // 以当前（v3）结构重新打开 → 触发升级回填
  const upgraded = new GbPostmarkDatabase()
  await upgraded.open()
  const upgradedEntry = (await upgraded.stampEntries.toArray())[0]
  const expectedKey = entryContentKey('CV-0001', legacyEntry)
  assert(!!upgradedEntry.entryKey && upgradedEntry.entryKey === expectedKey,
    'v3 升级按「封号 + 组合内容」确定性回填 entryKey')
  upgraded.close()

  // 重新打开单例库参与合并：对端档案里同封同组合（旧格式、无 entryKey、id 不同）
  await boundDb.open()
  const pack = archive({
    covers: [{ id: 55, ...cover({ coverNo: 'CV-0001' }) }],
    stampEntries: [
      { id: 999, ...legacyEntry, coverId: 55 } as StamplessEntry
    ]
  })
  const plan = buildMergePlan(await snapshot(), pack)
  const entryItem = plan.items.find((i) => i.kind === 'entry')
  assert(!!entryItem && entryItem.status === 'identical', '升级后的旧组合与对端同内容记录识别为同一条（一致）')
  const result = await applyMergePlan(await snapshot(), pack, plan)
  assert(result.added.entry === 0 && result.updated.entry === 0, '票戳组合不新增、不重复')
}

async function testRoundtrip(): Promise<void> {
  console.log('\n[F] 导出/解析往返与坏档案拦截')
  const exported = await exportMergeArchive('家里电脑')
  const reparsed = parseMergeArchive(JSON.stringify(exported))
  assert(reparsed.ok && reparsed.archive?.deviceName === '家里电脑', '导出档案可被解析且标识保留')
  assert(!parseMergeArchive('{"hello":1}').ok, '非合并档案被拒绝')
  assert(!parseMergeArchive('not-json{').ok, '损坏 JSON 被拒绝')
}

async function main(): Promise<void> {
  await testAReferenceRemap()
  await testBFieldPick()
  await testCMissingRef()
  await testDRollbackRetry()
  await testELegacyUpgrade()
  await testRoundtrip()
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exitCode = 1
}

void main()
