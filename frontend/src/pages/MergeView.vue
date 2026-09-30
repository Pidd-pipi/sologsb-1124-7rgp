<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useMergeStore } from '@/stores/mergeStore'
import {
  displayRows,
  resolutionKey,
  type MergeConflict,
  type MergeDuplicate,
  type MergeItem
} from '@/utils/merge'

const mergeStore = useMergeStore()

const fileInput = ref<HTMLInputElement | null>(null)

function triggerFile(): void {
  fileInput.value?.click()
}

async function onFileChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const selected = input.files?.[0]
  if (selected) await mergeStore.importFile(selected)
  input.value = ''
}

function formatTime(iso: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

interface ConflictRow extends MergeConflict {
  group: string
}
interface DuplicateRow extends MergeDuplicate {
  group: string
}

const conflictItems = computed<ConflictRow[]>(() => {
  if (!mergeStore.analysis) return []
  const groups: [string, MergeItem[]][] = [
    ['邮戳', mergeStore.analysis.postmarks],
    ['邮路', mergeStore.analysis.routes],
    ['实寄封', mergeStore.analysis.covers],
    ['票戳组合', mergeStore.analysis.stampEntries]
  ]
  return groups.flatMap(([group, items]) =>
    items.filter((i): i is MergeConflict => i.kind === 'conflict').map((i) => ({ ...i, group }))
  )
})

const duplicateItems = computed<DuplicateRow[]>(() => {
  if (!mergeStore.analysis) return []
  const groups: [string, MergeItem[]][] = [
    ['邮戳', mergeStore.analysis.postmarks],
    ['邮路', mergeStore.analysis.routes],
    ['实寄封', mergeStore.analysis.covers],
    ['票戳组合', mergeStore.analysis.stampEntries]
  ]
  return groups.flatMap(([group, items]) =>
    items.filter((i): i is MergeDuplicate => i.kind === 'duplicate').map((i) => ({ ...i, group }))
  )
})

const newItems = computed(() => {
  if (!mergeStore.analysis) return []
  const groups: [string, MergeItem[]][] = [
    ['邮戳', mergeStore.analysis.postmarks],
    ['邮路', mergeStore.analysis.routes],
    ['实寄封', mergeStore.analysis.covers],
    ['票戳组合', mergeStore.analysis.stampEntries]
  ]
  return groups.flatMap(([group, items]) =>
    items.filter((i) => i.kind === 'new').map((i) => ({ key: `${group}:${i.guid}`, group, label: i.label }))
  )
})

function resOf(item: MergeConflict | MergeDuplicate): 'local' | 'imported' {
  return mergeStore.resolutionOf(item.entity, item.guid)
}

function setRes(item: MergeConflict | MergeDuplicate, val: 'local' | 'imported'): void {
  mergeStore.setResolution(item.entity, item.guid, val)
}

function localUpdatedAt(item: MergeConflict | MergeDuplicate): string {
  return (item.local as { updatedAt: string }).updatedAt
}

function importedUpdatedAt(item: MergeConflict | MergeDuplicate): string {
  return (item.imported as { updatedAt: string }).updatedAt
}

function localRows(item: MergeConflict | MergeDuplicate): { label: string; value: string }[] {
  return displayRows(item.entity, item.local as unknown as Record<string, unknown>)
}

function importedRows(item: MergeConflict | MergeDuplicate): { label: string; value: string }[] {
  return displayRows(item.entity, item.imported as unknown as Record<string, unknown>)
}

async function onApply(): Promise<void> {
  const ok = await mergeStore.apply()
  if (ok) ElMessage.success('合并完成，数据已更新')
  else ElMessage.error(mergeStore.error || '合并失败')
}

function onReset(): void {
  mergeStore.reset()
}
</script>

<template>
  <div class="gb-page merge-view">
    <header class="gb-page__head">
      <div>
        <h1 class="gb-page__title">数据合并</h1>
        <p class="gb-page__subtitle">
          导出本机编目数据，或导入另一台电脑的导出文件离线合并。按稳定编目键识别同一记录，
          同键修改保留双方内容与时间供挑选；跨对象引用先对账，缺项补齐后才完成。
        </p>
      </div>
    </header>

    <section class="gb-panel">
      <h2 class="gb-panel__title">导出</h2>
      <p class="merge-view__desc">
        把本机的邮戳、实寄封、邮路与票戳组合导出为合并文件（含戳样与封图），供另一台电脑导入。
      </p>
      <el-button type="primary" :loading="mergeStore.exporting" @click="mergeStore.exportToFile">
        导出合并文件
      </el-button>
    </section>

    <section class="gb-panel">
      <h2 class="gb-panel__title">导入合并</h2>
      <p class="merge-view__desc">
        选择另一台电脑导出的 <code>.json</code> 合并文件，先预览差异再挑选、最后应用。合并失败不会改动现有数据，可重试。
      </p>
      <input ref="fileInput" type="file" accept=".json" style="display: none" @change="onFileChange" />
      <el-button :loading="mergeStore.analyzing" @click="triggerFile">选择合并文件</el-button>
      <p v-if="mergeStore.fileName" class="merge-view__file">已选择：{{ mergeStore.fileName }}</p>
      <p v-if="mergeStore.error" class="merge-view__error">{{ mergeStore.error }}</p>
    </section>

    <template v-if="mergeStore.analysis">
      <!-- 缺项警告：存在无法补齐的跨对象引用时阻止应用 -->
      <section v-if="mergeStore.hasMissingRefs" class="gb-panel merge-view__missing">
        <h2 class="gb-panel__title">存在未补齐的跨对象引用</h2>
        <p>
          以下记录引用了既不在本机、也不在导入文件中的邮戳 / 邮路 / 实寄封。
          请先在导出端补全相关记录后重新导出，再行合并。
        </p>
        <ul class="merge-view__missing-list">
          <li v-for="(ref, i) in mergeStore.analysis.missingRefs" :key="i">
            {{ ref.recordLabel }} → {{ ref.refField }}（缺失键 {{ ref.refGuid }}）
          </li>
        </ul>
      </section>

      <!-- 统计概览 -->
      <section class="gb-panel">
        <h2 class="gb-panel__title">合并预览</h2>
        <div class="merge-view__stats">
          <span class="merge-view__stat merge-view__stat--new">新增 {{ mergeStore.analysis.newCount }}</span>
          <span class="merge-view__stat merge-view__stat--same">相同 {{ mergeStore.analysis.identicalCount }}</span>
          <span class="merge-view__stat merge-view__stat--conflict">冲突 {{ mergeStore.analysis.conflictCount }}</span>
          <span class="merge-view__stat merge-view__stat--dup">疑似重复 {{ mergeStore.analysis.duplicateCount }}</span>
        </div>
        <p class="merge-view__hint">
          相同记录已自动对齐，无需操作；请逐一处理下方的「同键修改」与「疑似重复」。
        </p>
      </section>

      <!-- 同键修改 -->
      <section v-if="conflictItems.length" class="gb-panel">
        <h2 class="gb-panel__title">同键修改（{{ conflictItems.length }}）</h2>
        <p class="merge-view__desc">同一记录双方都做了修改，请挑选保留哪一方的内容与时间。</p>
        <div
          v-for="item in conflictItems"
          :key="resolutionKey(item.entity, item.guid)"
          class="merge-view__item"
        >
          <div class="merge-view__item-head">
            <span class="merge-view__item-group">{{ item.group }}</span>
            <strong>{{ item.label }}</strong>
            <el-radio-group
              :model-value="resOf(item)"
              class="merge-view__pick"
              @update:model-value="(v: 'local' | 'imported') => setRes(item, v)"
            >
              <el-radio value="local">保留本机</el-radio>
              <el-radio value="imported">采用导入</el-radio>
            </el-radio-group>
          </div>
          <div class="merge-view__versions">
            <div class="merge-view__version" :class="{ 'is-active': resOf(item) === 'local' }">
              <h4>本机版本</h4>
              <p class="merge-view__time">更新于 {{ formatTime(localUpdatedAt(item)) }}</p>
              <dl class="gb-facts">
                <div v-for="row in localRows(item)" :key="row.label">
                  <dt :class="{ 'is-diff': item.diffFields.includes(row.label) }">{{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                </div>
              </dl>
            </div>
            <div class="merge-view__version" :class="{ 'is-active': resOf(item) === 'imported' }">
              <h4>导入版本</h4>
              <p class="merge-view__time">更新于 {{ formatTime(importedUpdatedAt(item)) }}</p>
              <dl class="gb-facts">
                <div v-for="row in importedRows(item)" :key="row.label">
                  <dt :class="{ 'is-diff': item.diffFields.includes(row.label) }">{{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </section>

      <!-- 疑似重复 -->
      <section v-if="duplicateItems.length" class="gb-panel">
        <h2 class="gb-panel__title">疑似重复（{{ duplicateItems.length }}）</h2>
        <p class="merge-view__desc">
          双方各自新增的同一枚邮戳（内容指纹相同但编目键不同）。请确认是否为同一记录并挑选保留版本。
        </p>
        <div
          v-for="item in duplicateItems"
          :key="resolutionKey(item.entity, item.guid)"
          class="merge-view__item"
        >
          <div class="merge-view__item-head">
            <span class="merge-view__item-group">{{ item.group }}</span>
            <strong>{{ item.label }}</strong>
            <el-radio-group
              :model-value="resOf(item)"
              class="merge-view__pick"
              @update:model-value="(v: 'local' | 'imported') => setRes(item, v)"
            >
              <el-radio value="local">保留本机</el-radio>
              <el-radio value="imported">采用导入</el-radio>
            </el-radio-group>
          </div>
          <div class="merge-view__versions">
            <div class="merge-view__version" :class="{ 'is-active': resOf(item) === 'local' }">
              <h4>本机版本</h4>
              <p class="merge-view__time">更新于 {{ formatTime(localUpdatedAt(item)) }}</p>
              <dl class="gb-facts">
                <div v-for="row in localRows(item)" :key="row.label">
                  <dt :class="{ 'is-diff': !item.identical && item.diffFields.includes(row.label) }">{{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                </div>
              </dl>
            </div>
            <div class="merge-view__version" :class="{ 'is-active': resOf(item) === 'imported' }">
              <h4>导入版本</h4>
              <p class="merge-view__time">更新于 {{ formatTime(importedUpdatedAt(item)) }}</p>
              <dl class="gb-facts">
                <div v-for="row in importedRows(item)" :key="row.label">
                  <dt :class="{ 'is-diff': !item.identical && item.diffFields.includes(row.label) }">{{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </section>

      <!-- 新增记录 -->
      <section v-if="newItems.length" class="gb-panel">
        <el-collapse>
          <el-collapse-item :title="`新增记录（${newItems.length}）`">
            <ul class="merge-view__new-list">
              <li v-for="item in newItems" :key="item.key">
                <span class="merge-view__item-group">{{ item.group }}</span>
                {{ item.label }}
              </li>
            </ul>
          </el-collapse-item>
        </el-collapse>
      </section>

      <!-- 应用 -->
      <section class="gb-panel merge-view__apply">
        <el-button
          type="primary"
          size="large"
          :loading="mergeStore.applying"
          :disabled="mergeStore.hasMissingRefs"
          @click="onApply"
        >
          确认合并
        </el-button>
        <el-button size="large" @click="onReset">重置</el-button>
        <p v-if="mergeStore.hasMissingRefs" class="merge-view__error">
          存在未补齐的跨对象引用，暂时无法合并。
        </p>
        <p v-if="mergeStore.result" class="merge-view__result">
          合并完成：新增 {{ mergeStore.result.added }} 条 · 更新 {{ mergeStore.result.updated }} 条 ·
          跳过 {{ mergeStore.result.skipped }} 条。
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.merge-view__desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--gb-muted);
  line-height: 1.6;
}
.merge-view__file {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--gb-ink);
}
.merge-view__error {
  margin: 10px 0 0;
  font-size: 13px;
  color: #b02a1e;
}
.merge-view__missing {
  border-color: #e6b8af;
  background: #fdf3f1;
}
.merge-view__missing-list {
  margin: 8px 0 0;
  padding-left: 20px;
  font-size: 13px;
  color: #8c3b2e;
  line-height: 1.8;
}
.merge-view__stats {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.merge-view__stat {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
}
.merge-view__stat--new {
  background: #e7f0e7;
  color: #2e6b3a;
}
.merge-view__stat--same {
  background: #eef1f4;
  color: #5a6a7a;
}
.merge-view__stat--conflict {
  background: #fbe9e7;
  color: #b02a1e;
}
.merge-view__stat--dup {
  background: #fdf3e0;
  color: #8a6a2a;
}
.merge-view__hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--gb-muted);
}
.merge-view__item {
  border: 1px solid var(--gb-line);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 12px;
  background: #fffdf8;
}
.merge-view__item-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.merge-view__item-head strong {
  flex: 1;
  min-width: 160px;
  font-size: 14px;
}
.merge-view__item-group {
  font-size: 12px;
  color: var(--gb-muted);
  background: #f0e9dd;
  padding: 2px 8px;
  border-radius: 4px;
}
.merge-view__pick {
  margin-left: auto;
}
.merge-view__versions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 900px) {
  .merge-view__versions {
    grid-template-columns: 1fr;
  }
}
.merge-view__version {
  border: 1px solid var(--gb-line);
  border-radius: 8px;
  padding: 10px 12px;
  background: #faf6ee;
  opacity: 0.7;
}
.merge-view__version.is-active {
  border-color: var(--gb-brown);
  background: #fff;
  opacity: 1;
  box-shadow: 0 0 0 1px var(--gb-brown);
}
.merge-view__version h4 {
  margin: 0 0 4px;
  font-size: 13px;
  color: #5d3325;
}
.merge-view__time {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--gb-muted);
}
.merge-view__version dt.is-diff {
  color: #b02a1e;
  font-weight: 700;
}
.merge-view__new-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.9;
}
.merge-view__apply {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.merge-view__result {
  margin: 0;
  font-size: 13px;
  color: #2e6b3a;
}
</style>
