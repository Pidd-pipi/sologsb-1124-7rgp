/** 票戳组合（StamplessEntry）数据模型：一枚封上「票」与「戳」的一处组合关系。 */

/** 变体 */
export type VarietyType = '正品' | '组外品' | '漏齿' | '移位'

/** 封上位置 */
export type CoverPosition =
  | '左上'
  | '右上'
  | '中部'
  | '左下'
  | '右下'
  | '背面'

export interface StamplessEntry {
  id?: number
  /**
   * 跨机合并使用的稳定键：同一条票戳组合在两台电脑上保持一致。
   * 新建时由 utils/id 的 uid('ek') 生成；v3 升级为历史记录回填确定性键。
   * 缺失时合并引擎会按「邮票/面值/年份/齿度/变体/位置」内容键兜底识别。
   */
  entryKey: string
  /** 所属实寄封 id（仅本机有效，跨机引用由合并引擎按封号对账重写） */
  coverId: number
  /** 邮票名称 */
  stampName: string
  /** 面值（元 / 分，按原票面记） */
  denomination: number
  /** 发行年份 */
  issueYear: number
  /** 齿度，如 P11 / P12.5 */
  perforation: string
  variety: VarietyType
  positionOnCover: CoverPosition
  createdAt: string
}

export const VARIETY_TYPES: VarietyType[] = ['正品', '组外品', '漏齿', '移位']

export const COVER_POSITIONS: CoverPosition[] = [
  '左上',
  '右上',
  '中部',
  '左下',
  '右下',
  '背面'
]

/** 生成一条空白票戳组合记录，供表单初始化使用。 */
export function createEmptyStampEntry(coverId: number): StamplessEntry {
  return {
    entryKey: '',
    coverId,
    stampName: '',
    denomination: 0,
    issueYear: 1949,
    perforation: 'P11',
    variety: '正品',
    positionOnCover: '右上',
    createdAt: ''
  }
}
