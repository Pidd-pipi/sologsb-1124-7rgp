/**
 * IndexedDB（Dexie）封装：表结构、版本号与升级迁移、首次运行的样例数据。
 * 戳样与封的正反面原图单独放在 assets 表。
 */
import Dexie, { type Table } from 'dexie'
import type { Postmark } from '@/types/postmark'
import type { Cover } from '@/types/cover'
import type { PostalRoute } from '@/types/route'
import type { StamplessEntry } from '@/types/stampentry'
import type { AssetOwnerType, AssetSide, CatalogAsset } from '@/types/asset'

export const DB_NAME = 'gbpostmark'
/** 当前数据结构版本号，升级迁移写在下面对应的 version() 中 */
export const DB_VERSION = 2

export class GbPostmarkDatabase extends Dexie {
  postmarks!: Table<Postmark, number>
  covers!: Table<Cover, number>
  routes!: Table<PostalRoute, number>
  stampEntries!: Table<StamplessEntry, number>
  /** 戳样 / 封图原图，单独建表 */
  assets!: Table<CatalogAsset, number>

  constructor() {
    super(DB_NAME)

    // v1：初版表结构
    this.version(1).stores({
      postmarks: '++id, pmNo, type, office, province, yearFrom, yearTo, scarceLevel',
      covers: '++id, coverNo, sentFrom, sentTo, postDate, conditionGrade, registered',
      routes: '++id, routeNo, name, era, transport',
      stampEntries: '++id, coverId, stampName, variety',
      assets: '++id, ownerType, ownerId, side'
    })

    // v2：原图拆到 assets 表单独存放，并补齐历史记录缺省字段（升级迁移）
    this.version(DB_VERSION)
      .stores({
        postmarks:
          '++id, pmNo, type, office, province, yearFrom, yearTo, scarceLevel, inkColor, bilingual',
        covers:
          '++id, coverNo, sentFrom, sentTo, postDate, conditionGrade, registered, routeId, acquireFrom',
        routes: '++id, routeNo, name, era, transport, totalDays',
        stampEntries: '++id, coverId, stampName, variety, issueYear',
        assets: '++id, ownerType, ownerId, side, [ownerType+ownerId]'
      })
      .upgrade(async (tx) => {
        await tx
          .table('postmarks')
          .toCollection()
          .modify((pm: Partial<Postmark>) => {
            if (!pm.lettering) pm.lettering = { top: '', middle: '', bottom: '' }
            if (typeof pm.bilingual !== 'boolean') pm.bilingual = false
            if (typeof pm.imageDataUrl !== 'string') pm.imageDataUrl = ''
            if (typeof pm.diameter !== 'number') pm.diameter = 25
          })
        await tx
          .table('covers')
          .toCollection()
          .modify((cv: Partial<Cover>) => {
            if (!Array.isArray(cv.franking)) cv.franking = []
            if (!Array.isArray(cv.cancelPmIds)) cv.cancelPmIds = []
            if (!Array.isArray(cv.viaPoints)) cv.viaPoints = []
            if (typeof cv.frontImage !== 'string') cv.frontImage = ''
            if (typeof cv.backImage !== 'string') cv.backImage = ''
            if (typeof cv.routeId !== 'number') cv.routeId = null
          })
        await tx
          .table('routes')
          .toCollection()
          .modify((rt: Partial<PostalRoute>) => {
            if (!Array.isArray(rt.nodes)) rt.nodes = []
            if (typeof rt.totalDays !== 'number') rt.totalDays = 0
          })
      })
  }
}

export const db = new GbPostmarkDatabase()

/** 打开数据库；首次运行写入样例数据。 */
export async function initDatabase(): Promise<void> {
  await db.open()
  await seedIfEmpty()
}

/** 写入或覆盖一张原图（同 owner + side 视为同一张）。 */
export async function saveAsset(input: {
  ownerType: AssetOwnerType
  ownerId: number
  side: AssetSide
  dataUrl: string
  fileName: string
  updatedAt: string
}): Promise<number> {
  const rows = await db.assets.where('ownerId').equals(input.ownerId).toArray()
  const found = rows.find((a) => a.ownerType === input.ownerType && a.side === input.side)
  if (found && typeof found.id === 'number') {
    await db.assets.update(found.id, { ...input })
    return found.id
  }
  return db.assets.add({ ...input })
}

/** 读取一张原图，不存在返回空串。 */
export async function loadAsset(
  ownerType: AssetOwnerType,
  ownerId: number,
  side: AssetSide
): Promise<string> {
  const rows = await db.assets.where('ownerId').equals(ownerId).toArray()
  const found = rows.find((a) => a.ownerType === ownerType && a.side === side)
  return found?.dataUrl ?? ''
}

/** 读取某个所有者下面的全部原图。 */
export async function loadAssets(
  ownerType: AssetOwnerType,
  ownerId: number
): Promise<CatalogAsset[]> {
  const rows = await db.assets.where('ownerId').equals(ownerId).toArray()
  return rows.filter((a) => a.ownerType === ownerType)
}

/* ------------------------------ 样例数据 ------------------------------ */

const INK_HEX: Record<string, string> = {
  黑: '#2f2a26',
  红: '#b02a1e',
  蓝: '#1f4d8f',
  绿: '#1f7a4d',
  紫: '#6b3f8f',
  棕: '#6b4a2a'
}

function escapeXml(text: string): string {
  return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** 依据戳面信息合成一张戳样图，用作样例数据的戳样。 */
function postmarkSampleDataUrl(pm: Postmark): string {
  const ink = INK_HEX[pm.inkColor] ?? '#2f2a26'
  const r = 46 + Math.min(18, Math.max(0, pm.diameter - 24))
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">',
    '<rect width="240" height="240" fill="#f7f1e6"/>',
    `<circle cx="120" cy="120" r="${r + 18}" fill="none" stroke="${ink}" stroke-width="3"/>`,
    `<circle cx="120" cy="120" r="${r}" fill="none" stroke="${ink}" stroke-width="2"/>`,
    `<text x="120" y="86" font-size="16" fill="${ink}" text-anchor="middle" font-family="serif">${escapeXml(pm.lettering.top || pm.office)}</text>`,
    `<text x="120" y="124" font-size="13" fill="${ink}" text-anchor="middle" font-family="serif">${escapeXml(pm.lettering.middle || pm.type)}</text>`,
    `<text x="120" y="158" font-size="12" fill="${ink}" text-anchor="middle" font-family="serif">${escapeXml(pm.lettering.bottom || `${pm.yearFrom}-${pm.yearTo}`)}</text>`,
    '</svg>'
  ].join('')
  return svgDataUrl(svg)
}

/** 依据收寄地合成一张封图缩略图。 */
function coverThumbDataUrl(coverNo: string, from: string, to: string, date: string): string {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">',
    '<rect width="320" height="200" fill="#f4ead8"/>',
    '<rect x="14" y="14" width="292" height="172" fill="#fdfaf3" stroke="#c9b79a" stroke-width="2"/>',
    '<path d="M14 14 L160 108 L306 14" fill="none" stroke="#c9b79a" stroke-width="2"/>',
    `<rect x="228" y="26" width="60" height="70" fill="#e6d9c2" stroke="#b9a480" stroke-width="1.5" stroke-dasharray="4 3"/>`,
    `<text x="258" y="66" font-size="12" fill="#8c3b2e" text-anchor="middle" font-family="serif">票戳</text>`,
    `<text x="30" y="150" font-size="13" fill="#5a4a37" font-family="serif">${escapeXml(coverNo)}</text>`,
    `<text x="30" y="172" font-size="13" fill="#5a4a37" font-family="serif">${escapeXml(`${from} → ${to}  ${date}`)}</text>`,
    '</svg>'
  ].join('')
  return svgDataUrl(svg)
}

const SEED_TS = '2024-05-01T09:00:00.000Z'

function seedPostmarks(): Postmark[] {
  const base = (pm: Postmark): Postmark => ({ ...pm, imageDataUrl: postmarkSampleDataUrl(pm) })
  return [
    base({
      id: 1,
      pmNo: 'PM-0001',
      type: '圆形日戳',
      office: '上海邮政总局',
      province: '上海',
      yearFrom: 1908,
      yearTo: 1912,
      dateOnStamp: '1910-06-18',
      inkColor: '黑',
      diameter: 26,
      lettering: { top: '上海', middle: 'SHANGHAI', bottom: '18 JUN 10' },
      bilingual: true,
      scarceLevel: '少见',
      imageDataUrl: '',
      note: '三格圆形日戳，中英文并用，戳面清晰，边线完整。',
      createdAt: SEED_TS,
      updatedAt: SEED_TS
    }),
    base({
      id: 2,
      pmNo: 'PM-0002',
      type: '滚筒戳',
      office: '天津邮政局',
      province: '天津',
      yearFrom: 1912,
      yearTo: 1928,
      dateOnStamp: '1921-03-05',
      inkColor: '黑',
      diameter: 32,
      lettering: { top: '天津', middle: 'TIENTSIN', bottom: '21 MAR 5' },
      bilingual: true,
      scarceLevel: '罕见',
      imageDataUrl: '',
      note: '滚筒戳戳面横长，销票时墨色偏淡，此枚墨色饱满。',
      createdAt: SEED_TS,
      updatedAt: SEED_TS
    }),
    base({
      id: 3,
      pmNo: 'PM-0003',
      type: '机盖波纹戳',
      office: '广州邮局',
      province: '广东',
      yearFrom: 1930,
      yearTo: 1949,
      dateOnStamp: '1936-09-12',
      inkColor: '黑',
      diameter: 30,
      lettering: { top: '广州', middle: 'CANTON', bottom: '波纹销票' },
      bilingual: true,
      scarceLevel: '常见',
      imageDataUrl: '',
      note: '机盖波纹戳，波纹段共六线，用于快速销票。',
      createdAt: SEED_TS,
      updatedAt: SEED_TS
    }),
    base({
      id: 4,
      pmNo: 'PM-0004',
      type: '纪念戳',
      office: '南京邮局',
      province: '江苏',
      yearFrom: 1947,
      yearTo: 1947,
      dateOnStamp: '1947-10-10',
      inkColor: '红',
      diameter: 34,
      lettering: { top: '国庆纪念', middle: '南京', bottom: '1947.10.10' },
      bilingual: false,
      scarceLevel: '少见',
      imageDataUrl: '',
      note: '纪念戳仅在纪念日启用，戳径大于同期日戳。',
      createdAt: SEED_TS,
      updatedAt: SEED_TS
    }),
    base({
      id: 5,
      pmNo: 'PM-0005',
      type: '风景戳',
      office: '杭州西湖邮局',
      province: '浙江',
      yearFrom: 1955,
      yearTo: 1965,
      dateOnStamp: '1958-04-02',
      inkColor: '紫',
      diameter: 30,
      lettering: { top: '杭州', middle: '西湖', bottom: '1958.4.2' },
      bilingual: false,
      scarceLevel: '常见',
      imageDataUrl: '',
      note: '风景戳以西湖三潭印月为主图，供集邮者加盖。',
      createdAt: SEED_TS,
      updatedAt: SEED_TS
    }),
    base({
      id: 6,
      pmNo: 'PM-0006',
      type: '军邮戳',
      office: '军邮 231 局',
      province: '四川',
      yearFrom: 1940,
      yearTo: 1945,
      dateOnStamp: '1943-07-21',
      inkColor: '蓝',
      diameter: 28,
      lettering: { top: '军邮', middle: '231', bottom: '1943.7.21' },
      bilingual: false,
      scarceLevel: '孤品',
      imageDataUrl: '',
      note: '军邮局编号戳，抗战时期随军邮站流转，存世极少。',
      createdAt: SEED_TS,
      updatedAt: SEED_TS
    })
  ]
}

function seedRoutes(): PostalRoute[] {
  return [
    {
      id: 1,
      routeNo: 'RT-0001',
      name: '沪宁铁路邮路',
      era: '1910-1919',
      transport: '铁路',
      nodes: [
        { key: 'rt1-n1', office: '上海', arriveDate: '1910-06-18', transitMark: '上海圆形日戳' },
        { key: 'rt1-n2', office: '苏州', arriveDate: '1910-06-19', transitMark: '苏州中转日戳' },
        { key: 'rt1-n3', office: '镇江', arriveDate: '1910-06-20', transitMark: '镇江中转日戳' },
        { key: 'rt1-n4', office: '南京', arriveDate: '1910-06-21', transitMark: '南京到达戳' }
      ],
      totalDays: 3,
      frequency: '逐日班',
      remark: '沪宁铁路通车后邮件改由火车运送，全程三日可达。',
      createdAt: SEED_TS,
      updatedAt: SEED_TS
    },
    {
      id: 2,
      routeNo: 'RT-0002',
      name: '津浦—沪宁联运邮路',
      era: '1920-1929',
      transport: '铁路',
      nodes: [
        { key: 'rt2-n1', office: '天津', arriveDate: '1921-03-05', transitMark: '天津滚筒戳' },
        { key: 'rt2-n2', office: '济南', arriveDate: '1921-03-06', transitMark: '济南中转戳' },
        { key: 'rt2-n3', office: '徐州', arriveDate: '1921-03-07', transitMark: '徐州中转戳' },
        { key: 'rt2-n4', office: '南京', arriveDate: '1921-03-08', transitMark: '南京中转戳' },
        { key: 'rt2-n5', office: '上海', arriveDate: '1921-03-10', transitMark: '上海到达戳' }
      ],
      totalDays: 5,
      frequency: '隔日班',
      remark: '津浦线与沪宁线联运，邮件按班期在徐州接驳。',
      createdAt: SEED_TS,
      updatedAt: SEED_TS
    },
    {
      id: 3,
      routeNo: 'RT-0003',
      name: '长江船运邮路',
      era: '1930-1939',
      transport: '船运',
      nodes: [
        { key: 'rt3-n1', office: '广州', arriveDate: '1936-09-12', transitMark: '广州机盖波纹戳' },
        { key: 'rt3-n2', office: '长沙', arriveDate: '1936-09-15', transitMark: '长沙中转戳' },
        { key: 'rt3-n3', office: '汉口', arriveDate: '1936-09-17', transitMark: '汉口中转戳' },
        { key: 'rt3-n4', office: '武汉', arriveDate: '1936-09-20', transitMark: '武汉到达戳' }
      ],
      totalDays: 8,
      frequency: '旬日班',
      remark: '长江轮船带运邮件，受水位影响班期常有延误。',
      createdAt: SEED_TS,
      updatedAt: SEED_TS
    }
  ]
}

function seedCovers(): Cover[] {
  return [
    {
      id: 1,
      coverNo: 'CV-0001',
      sentFrom: '上海',
      sentTo: '南京',
      postDate: '1910-06-18',
      arriveDate: '1910-06-21',
      franking: [
        { stampName: '蟠龙邮票', denomination: 3, count: 2 },
        { stampName: '蟠龙邮票', denomination: 1, count: 1 }
      ],
      cancelPmIds: [1],
      routeId: 1,
      viaPoints: ['苏州', '镇江'],
      registered: true,
      conditionGrade: '上品',
      acquireFrom: '春季邮品交流',
      price: 3800,
      storageAlbum: '甲册 3 页',
      frontImage: coverThumbDataUrl('CV-0001', '上海', '南京', '1910-06-18'),
      backImage: '',
      note: '挂号实寄，封背有三处中转戳，戳面完整。',
      createdAt: SEED_TS,
      updatedAt: SEED_TS
    },
    {
      id: 2,
      coverNo: 'CV-0002',
      sentFrom: '天津',
      sentTo: '上海',
      postDate: '1921-03-05',
      arriveDate: '1921-03-10',
      franking: [{ stampName: '帆船邮票', denomination: 4, count: 2 }],
      cancelPmIds: [2],
      routeId: 2,
      viaPoints: ['济南', '徐州', '南京'],
      registered: false,
      conditionGrade: '中品',
      acquireFrom: '旧书摊收得',
      price: 1200,
      storageAlbum: '乙册 1 页',
      frontImage: coverThumbDataUrl('CV-0002', '天津', '上海', '1921-03-05'),
      backImage: '',
      note: '平信，封舌有裂口，票戳关系清晰。',
      createdAt: SEED_TS,
      updatedAt: SEED_TS
    },
    {
      id: 3,
      coverNo: 'CV-0003',
      sentFrom: '广州',
      sentTo: '武汉',
      postDate: '1936-09-12',
      arriveDate: '1936-09-20',
      franking: [
        { stampName: '孙中山像邮票', denomination: 5, count: 1 },
        { stampName: '孙中山像邮票', denomination: 2, count: 2 }
      ],
      cancelPmIds: [3],
      routeId: 3,
      viaPoints: ['长沙', '汉口'],
      registered: true,
      conditionGrade: '下品',
      acquireFrom: '家族旧藏',
      price: 460,
      storageAlbum: '丙册 2 页',
      frontImage: coverThumbDataUrl('CV-0003', '广州', '武汉', '1936-09-12'),
      backImage: '',
      note: '封体有水渍，邮路节点仍可辨读。',
      createdAt: SEED_TS,
      updatedAt: SEED_TS
    },
    {
      id: 4,
      coverNo: 'CV-0004',
      sentFrom: '南京',
      sentTo: '杭州',
      postDate: '1958-04-02',
      arriveDate: '',
      franking: [{ stampName: '普八邮票', denomination: 8, count: 1 }],
      cancelPmIds: [5],
      routeId: null,
      viaPoints: [],
      registered: false,
      conditionGrade: '中品',
      acquireFrom: '邮友交换',
      price: 120,
      storageAlbum: '丁册 4 页',
      frontImage: coverThumbDataUrl('CV-0004', '南京', '杭州', '1958-04-02'),
      backImage: '',
      note: '到达日期待考，暂按邮路班期推定。',
      createdAt: SEED_TS,
      updatedAt: SEED_TS
    }
  ]
}

function seedStampEntries(): StamplessEntry[] {
  return [
    {
      id: 1,
      coverId: 1,
      stampName: '蟠龙邮票',
      denomination: 3,
      issueYear: 1908,
      perforation: 'P14',
      variety: '正品',
      positionOnCover: '右上',
      createdAt: SEED_TS
    },
    {
      id: 2,
      coverId: 1,
      stampName: '蟠龙邮票',
      denomination: 1,
      issueYear: 1908,
      perforation: 'P14',
      variety: '移位',
      positionOnCover: '中部',
      createdAt: SEED_TS
    },
    {
      id: 3,
      coverId: 2,
      stampName: '帆船邮票',
      denomination: 4,
      issueYear: 1913,
      perforation: 'P14',
      variety: '正品',
      positionOnCover: '右上',
      createdAt: SEED_TS
    },
    {
      id: 4,
      coverId: 3,
      stampName: '孙中山像邮票',
      denomination: 5,
      issueYear: 1931,
      perforation: 'P12.5',
      variety: '组外品',
      positionOnCover: '左上',
      createdAt: SEED_TS
    },
    {
      id: 5,
      coverId: 3,
      stampName: '孙中山像邮票',
      denomination: 2,
      issueYear: 1931,
      perforation: 'P12.5',
      variety: '漏齿',
      positionOnCover: '左下',
      createdAt: SEED_TS
    },
    {
      id: 6,
      coverId: 4,
      stampName: '普八邮票',
      denomination: 8,
      issueYear: 1955,
      perforation: 'P14',
      variety: '正品',
      positionOnCover: '右上',
      createdAt: SEED_TS
    }
  ]
}

/** 首次运行写入样例数据，保证每个页面都有可编目的内容。 */
export async function seedIfEmpty(): Promise<void> {
  const count = await db.postmarks.count()
  if (count > 0) return
  const postmarks = seedPostmarks()
  const routes = seedRoutes()
  const covers = seedCovers()
  const entries = seedStampEntries()
  await db.transaction('rw', db.postmarks, db.covers, db.routes, db.stampEntries, async () => {
    await db.postmarks.bulkPut(postmarks)
    await db.routes.bulkPut(routes)
    await db.covers.bulkPut(covers)
    await db.stampEntries.bulkPut(entries)
  })
}
