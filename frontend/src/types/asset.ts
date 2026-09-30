/** 戳样原图与封正反面原图：单独建表存放，避免明细表被大字段拖慢。 */

export type AssetOwnerType = 'postmark' | 'cover'
export type AssetSide = 'sample' | 'front' | 'back'

export interface CatalogAsset {
  id?: number
  ownerType: AssetOwnerType
  ownerId: number
  side: AssetSide
  /** 原图 dataURL */
  dataUrl: string
  fileName: string
  updatedAt: string
}

export const ASSET_SIDES: AssetSide[] = ['sample', 'front', 'back']

export function assetSideLabel(side: AssetSide): string {
  if (side === 'front') return '正面'
  if (side === 'back') return '背面'
  return '戳样'
}
