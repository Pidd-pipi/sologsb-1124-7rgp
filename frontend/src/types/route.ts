/** 邮路（PostalRoute）数据模型：把一封邮件实际经过的节点串成时间轴。 */

/** 运输方式 */
export type TransportMode = '步班' | '船运' | '铁路' | '航空'

/** 邮路节点：局所名 + 到达日期 + 中转戳 */
export interface RouteNode {
  /** 节点本地唯一键，供拖拽排序使用 */
  key: string
  office: string
  /** 到达日期 YYYY-MM-DD，可为空（空值触发缺日警示） */
  arriveDate: string
  /** 中转戳描述 */
  transitMark: string
}

/** 时间轴节点：邮路节点 / 寄出 / 到达的统一呈现结构 */
export interface TimelineNode {
  key: string
  label: string
  office: string
  date: string
  mark: string
  kind: 'sent' | 'transit' | 'arrive'
}

export interface PostalRoute {
  id?: number
  /** 邮路号，如 RT-0001 */
  routeNo: string
  name: string
  /** 时期，如「清末」「民国」「1950-1959」 */
  era: string
  transport: TransportMode
  nodes: RouteNode[]
  /** 全程天数（由节点日期自动计算） */
  totalDays: number
  /** 班期，如「逐日班」「隔日班」 */
  frequency: string
  remark: string
  createdAt: string
  updatedAt: string
}

export const TRANSPORT_MODES: TransportMode[] = ['步班', '船运', '铁路', '航空']

/** 生成一条空白邮路记录，供表单初始化使用。 */
export function createEmptyRoute(): PostalRoute {
  return {
    routeNo: '',
    name: '',
    era: '',
    transport: '铁路',
    nodes: [],
    totalDays: 0,
    frequency: '',
    remark: '',
    createdAt: '',
    updatedAt: ''
  }
}
