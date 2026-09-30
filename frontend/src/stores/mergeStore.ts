import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  analyzeMerge,
  applyMerge,
  downloadExport,
  exportData,
  parseImport,
  resolutionKey,
  type ApplyResult,
  type MergeAnalysis,
  type MergeExportFile
} from '@/utils/merge'
import { useCoverStore } from './coverStore'
import { usePostmarkStore } from './postmarkStore'
import { useRouteStore } from './routeStore'

export const useMergeStore = defineStore('merge', () => {
  const file = ref<MergeExportFile | null>(null)
  const fileName = ref('')
  const analysis = ref<MergeAnalysis | null>(null)
  const resolutions = ref<Record<string, 'local' | 'imported'>>({})
  const analyzing = ref(false)
  const applying = ref(false)
  const exporting = ref(false)
  const error = ref('')
  const result = ref<ApplyResult | null>(null)

  const hasFile = computed(() => !!file.value)
  const hasAnalysis = computed(() => !!analysis.value)
  const hasMissingRefs = computed(() => (analysis.value?.missingRefs.length ?? 0) > 0)
  const conflictCount = computed(() => analysis.value?.conflictCount ?? 0)
  const duplicateCount = computed(() => analysis.value?.duplicateCount ?? 0)

  /** 导出全部编目数据并下载合并文件。 */
  async function exportToFile(): Promise<void> {
    exporting.value = true
    error.value = ''
    try {
      const data = await exportData()
      downloadExport(data)
    } catch (err) {
      error.value = err instanceof Error ? err.message : '导出失败，请重试。'
    } finally {
      exporting.value = false
    }
  }

  /** 读取导入文件并解析、分析。 */
  async function importFile(selected: File): Promise<void> {
    analyzing.value = true
    error.value = ''
    result.value = null
    try {
      const text = await selected.text()
      const data = parseImport(text)
      const result_ = await analyzeMerge(data)
      file.value = data
      fileName.value = selected.name
      analysis.value = result_
      resolutions.value = {}
    } catch (err) {
      error.value = err instanceof Error ? err.message : '导入失败，请重试。'
      file.value = null
      fileName.value = ''
      analysis.value = null
    } finally {
      analyzing.value = false
    }
  }

  /** 设置某个冲突 / 重复项的挑选结果。 */
  function setResolution(entity: 'postmark' | 'route' | 'cover' | 'stampEntry', g: string, res: 'local' | 'imported'): void {
    resolutions.value[resolutionKey(entity, g)] = res
  }

  function resolutionOf(entity: 'postmark' | 'route' | 'cover' | 'stampEntry', g: string): 'local' | 'imported' {
    return resolutions.value[resolutionKey(entity, g)] ?? 'imported'
  }

  /** 应用合并；缺项未补齐或写入失败时不改动数据，可重试。 */
  async function apply(): Promise<boolean> {
    if (!analysis.value) return false
    if (hasMissingRefs.value) {
      error.value = '存在未补齐的跨对象引用，请先在导出端补全相关记录后重新导出。'
      return false
    }
    applying.value = true
    error.value = ''
    try {
      const res = await applyMerge(analysis.value, resolutions.value)
      result.value = res
      // 刷新各 store，使页面看到合并后的数据
      await Promise.all([
        usePostmarkStore().load(),
        useCoverStore().load(),
        useRouteStore().load()
      ])
      return true
    } catch (err) {
      // 事务已整体回滚，现有数据保持原样
      error.value = err instanceof Error ? err.message : '合并失败，现有数据未改动，请重试。'
      return false
    } finally {
      applying.value = false
    }
  }

  /** 重置导入状态，准备下一次合并。 */
  function reset(): void {
    file.value = null
    fileName.value = ''
    analysis.value = null
    resolutions.value = {}
    error.value = ''
    result.value = null
  }

  return {
    file,
    fileName,
    analysis,
    resolutions,
    analyzing,
    applying,
    exporting,
    error,
    result,
    hasFile,
    hasAnalysis,
    hasMissingRefs,
    conflictCount,
    duplicateCount,
    exportToFile,
    importFile,
    setResolution,
    resolutionOf,
    apply,
    reset
  }
})
