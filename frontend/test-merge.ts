/**
 * 合并通道逻辑测试：用 fake-indexeddb 模拟两台电脑，
 * 验证导出 → 分析（冲突 / 重复 / 新增 / 缺项）→ 应用 的完整流程。
 * 运行：npx tsx test-merge.ts
 */
import 'fake-indexeddb/auto'
import { db, initDatabase } from './src/utils/db'
import {
  exportData,
  analyzeMerge,
  applyMerge,
  parseImport,
  type MergeExportFile
} from './src/utils/merge'
import type { Postmark } from './src/types/postmark'
import type { Cover } from './src/types/cover'
import type { PostalRoute } from './src/types/route'

async function clearAll(): Promise<void> {
  await db.transaction('rw', db.postmarks, db.routes, db.covers, db.stampEntries, db.assets, async (tx) => {
    await Promise.all([
      tx.postmarks.clear(),
      tx.routes.clear(),
      tx.covers.clear(),
      tx.stampEntries.clear(),
      tx.assets.clear()
    ])
  })
}

const TS = (d: string) => new Date(d).toISOString()

async function main(): Promise<void> {
  await initDatabase()

  /* ---------- 设备 A 的数据 ---------- */
  await clearAll()
  const pmA: Postmark = {
    guid: 'pm-guid-A',
    pmNo: 'PM-0001', type: '圆形日戳', office: '上海邮政总局', province: '上海',
    yearFrom: 1908, yearTo: 1912, dateOnStamp: '1910-06-18', inkColor: '黑',
    diameter: 26, lettering: { top: '上海', middle: 'SHANGHAI', bottom: '18 JUN 10' },
    bilingual: true, scarceLevel: '少见', imageDataUrl: '', note: 'A的备注',
    createdAt: TS('2024-01-01'), updatedAt: TS('2024-01-01')
  }
  const pmA2: Postmark = {
    ...pmA, guid: 'pm-guid-A2', pmNo: 'PM-0002', office: '天津邮政局', note: 'A的另一枚戳',
    createdAt: TS('2024-01-02'), updatedAt: TS('2024-01-02')
  }
  const routeA: PostalRoute = {
    guid: 'rt-guid-A', routeNo: 'RT-0001', name: '沪宁铁路邮路', era: '1910-1919',
    transport: '铁路', nodes: [], totalDays: 3, frequency: '逐日班', remark: '',
    createdAt: TS('2024-01-01'), updatedAt: TS('2024-01-01')
  }
  const pmIdA = await db.postmarks.add(pmA)
  await db.postmarks.add(pmA2)
  const routeIdA = await db.routes.add(routeA)
  const coverA: Cover = {
    guid: 'cv-guid-A', coverNo: 'CV-0001', sentFrom: '上海', sentTo: '南京',
    postDate: '1910-06-18', arriveDate: '1910-06-21', franking: [],
    cancelPmIds: [pmIdA], routeId: routeIdA, viaPoints: [], registered: true,
    conditionGrade: '上品', acquireFrom: '', price: 0, storageAlbum: '',
    frontImage: '', backImage: '', note: 'A的封备注',
    createdAt: TS('2024-01-01'), updatedAt: TS('2024-01-01')
  }
  await db.covers.add(coverA)

  // A 导出
  const fileA = await exportData()
  console.log('✓ A 导出:', fileA.postmarks.length, '邮戳,', fileA.routes.length, '邮路,', fileA.covers.length, '封')
  const exportedCover = fileA.covers[0]
  if (exportedCover.cancelPmGuids[0] !== 'pm-guid-A' || exportedCover.routeGuid !== 'rt-guid-A') {
    throw new Error('导出时引用未转成 guid')
  }
  console.log('✓ 导出引用已转 guid:', exportedCover.cancelPmGuids, exportedCover.routeGuid)

  /* ---------- 设备 B 的数据 ---------- */
  await clearAll()
  // B 的 pm：与 A 同内容但不同 guid（重复），时间更新
  const pmB: Postmark = {
    ...pmA, guid: 'pm-guid-B', note: 'B的备注', updatedAt: TS('2024-02-01')
  }
  await db.postmarks.add(pmB)
  // B 的 route：与 A 同 guid 但内容被 B 修改（冲突）
  const routeB: PostalRoute = {
    ...routeA, name: '沪宁铁路邮路（B修订）', updatedAt: TS('2024-03-01')
  }
  await db.routes.add(routeB)
  // B 的 cover：与 A 不同 guid、同内容（重复），引用 B 的 pm 与 A 的 route
  const pmIdB = (await db.postmarks.toArray()).find((p) => p.guid === 'pm-guid-B')!.id!
  const routeIdB = (await db.routes.toArray())[0].id!
  const coverB: Cover = {
    ...coverA, guid: 'cv-guid-B', cancelPmIds: [pmIdB], routeId: routeIdB,
    note: 'B的封备注', updatedAt: TS('2024-02-15')
  }
  await db.covers.add(coverB)

  // B 导入 A 的文件并分析
  const analysis = await analyzeMerge(fileA)
  console.log('✓ 分析结果:', {
    new: analysis.newCount,
    identical: analysis.identicalCount,
    conflict: analysis.conflictCount,
    duplicate: analysis.duplicateCount,
    missing: analysis.missingRefs.length
  })
  console.log('  邮戳项:', analysis.postmarks.map((i) => `${i.kind}:${i.label}`))
  console.log('  邮路项:', analysis.routes.map((i) => `${i.kind}:${i.label}`))
  console.log('  封项:', analysis.covers.map((i) => `${i.kind}:${i.label}`))

  // 断言：pm-guid-A 与 pm-guid-B 是重复；rt-guid-A 是冲突；cv-guid-A 与 cv-guid-B 是重复；pmA2 是新增
  const pmDup = analysis.postmarks.find((i) => i.guid === 'pm-guid-A')
  if (pmDup?.kind !== 'duplicate') throw new Error('pm-guid-A 应识别为重复')
  const pmNew = analysis.postmarks.find((i) => i.guid === 'pm-guid-A2')
  if (pmNew?.kind !== 'new') throw new Error('pm-guid-A2 应识别为新增')
  const rtConflict = analysis.routes.find((i) => i.guid === 'rt-guid-A')
  if (rtConflict?.kind !== 'conflict') throw new Error('rt-guid-A 应识别为冲突')
  const cvDup = analysis.covers.find((i) => i.guid === 'cv-guid-A')
  if (cvDup?.kind !== 'duplicate') throw new Error('cv-guid-A 应识别为重复')
  if (analysis.missingRefs.length !== 0) throw new Error('不应有缺项')
  console.log('✓ 冲突 / 重复 / 新增识别正确')

  // 应用：邮路冲突采用导入（A 的版本），其余默认
  const result = await applyMerge(analysis, {
    'route:rt-guid-A': 'imported'
  })
  console.log('✓ 应用结果:', result)

  // 验证 B 的最终数据
  const pms = await db.postmarks.toArray()
  const routes = await db.routes.toArray()
  const covers = await db.covers.toArray()
  console.log('  合并后: 邮戳', pms.length, '邮路', routes.length, '封', covers.length)
  if (pms.length !== 2) throw new Error('合并后应有 2 枚邮戳（B的1 + 新增的1）')
  if (routes.length !== 1) throw new Error('合并后应有 1 条邮路')
  if (covers.length !== 1) throw new Error('合并后应有 1 封')
  // 邮路采用导入后，名称应为 A 的版本
  if (routes[0].name !== '沪宁铁路邮路') throw new Error('邮路未按「导入」更新')
  // 封的引用应解析到 B 的本地 id
  if (covers[0].cancelPmIds[0] !== pmIdB) throw new Error('封的销票邮戳引用未解析到本地 id')
  if (covers[0].routeId !== routeIdB) throw new Error('封的邮路引用未解析到本地 id')
  console.log('✓ 引用已正确解析为本地 id，邮路按「导入」更新')

  /* ---------- 缺项测试：引用了不存在的 guid ---------- */
  await clearAll()
  await db.postmarks.add(pmB)
  await db.routes.add(routeB)
  await db.covers.add(coverB)
  const badFile: MergeExportFile = {
    ...fileA,
    covers: [
      {
        ...fileA.covers[0],
        guid: 'cv-guid-X',
        cancelPmGuids: ['pm-guid-missing'],
        routeGuid: 'rt-guid-A'
      }
    ]
  }
  const badAnalysis = await analyzeMerge(badFile)
  console.log('✓ 缺项分析:', badAnalysis.missingRefs.map((r) => `${r.recordLabel}→${r.refField}`))
  if (badAnalysis.missingRefs.length === 0) throw new Error('应识别出缺项')
  // 缺项时 applyMerge 应拒绝写入，且现有数据保持原样
  let blocked = false
  try {
    await applyMerge(badAnalysis, {})
  } catch (e) {
    blocked = true
    console.log('✓ 缺项阻止应用:', (e as Error).message)
  }
  if (!blocked) throw new Error('缺项时应拒绝应用')
  const pms2 = await db.postmarks.toArray()
  if (pms2.length !== 1) throw new Error('缺项合并不应改动数据')
  console.log('✓ 缺项被识别并阻止，数据未被破坏')

  /* ---------- 解析校验测试 ---------- */
  try {
    parseImport('not json')
    throw new Error('应拒绝非 JSON')
  } catch (e) {
    if ((e as Error).message.includes('应拒绝')) throw e
    console.log('✓ 拒绝非 JSON:', (e as Error).message)
  }
  try {
    parseImport(JSON.stringify({ format: 'other' }))
    throw new Error('应拒绝错误格式')
  } catch (e) {
    if ((e as Error).message.includes('应拒绝')) throw e
    console.log('✓ 拒绝错误格式:', (e as Error).message)
  }

  console.log('\n🎉 全部测试通过')
}

main().catch((e) => {
  console.error('测试失败:', e)
  process.exit(1)
})
