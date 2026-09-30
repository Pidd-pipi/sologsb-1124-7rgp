<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadFile } from 'element-plus'
import { useCoverStore } from '@/stores/coverStore'
import { usePostmarkStore } from '@/stores/postmarkStore'
import { useRouteStore } from '@/stores/routeStore'
import type {
  MergeArchive,
  MergeItem,
  MergePlan,
  MergeSide,
  MissingRef
} from '@/utils/merge'
import {
  KIND_LABEL,
  applyMergePlan,
  buildMergePlan,
  conflictItems,
  exportMergeArchive,
  mergeArchiveFileName,
  parseMergeArchive,
  summarizePlan
} from '@/utils/merge'
import { nowIso } from '@/utils/id'

const postmarkStore = usePostmarkStore()
const coverStore = useCoverStore()
const routeStore = useRouteStore()

const deviceName = ref('家里电脑')
const exporting = ref(false)
const importing = ref(false)
const applying = ref(false)
const fileName = ref('')
const archive = ref<MergeArchive | null>(null)
const plan = ref<MergePlan | null>(null)
const resultText = ref('')
const lastError = ref('')

const statusFilter = ref<'all' | MergeItem['status']>('all')
const kindFilter = ref<'all' | MergeItem['kind']>('all')

const summary = computed(() => (plan.value ? summarizePlan(plan.value) : null))
const conflicts = computed(() => (plan.value ? conflictItems(plan.value) : []))
const hasMissing = computed(() => (plan.value?.missing.length ?? 0) > 0)

const visibleItems = computed(() => {
  if (!plan.value) return []
  return plan.value.items.filter((item) => {
    if (statusFilter.value !== 'all' && item.status !== statusFilter.value) return false
    if (kindFilter.value !== 'all' && item.kind !== kindFilter.value) return false
    return true
  })
})

const statusTabs = computed(() => {
  const s = summary.value
  return [
    { key: 'all', label: `全部 ${plan.value ? plan.value.items.length : 0}` },
    { key: 'conflict', label: `双方修改 ${s?.conflict ?? 0}` },
    { key: 'incomingOnly', label: `对端新增 ${s?.incomingOnly ?? 0}` },
    { key: 'localOnly', label: `仅本机 ${s?.localOnly ?? 0}` },
    { key: 'identical', label: `一致 ${s?.identical ?? 0}` }
  ] as const
})

async function refreshStores(): Promise<void> {
  await Promise.all([postmarkStore.load(), coverStore.load(), routeStore.load()])
}

async function doExport(): Promise<void> {
  exporting.value = true
  try {
    const pack = await exportMergeArchive(deviceName.value || '家里电脑')
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = mergeArchiveFileName(pack)
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    ElMessage.success(
      `已导出 ${pack.postmarks.length} 枚邮戳、${pack.covers.length} 个实寄封、${pack.routes.length} 条邮路及票戳组合/原图`
    )
  } catch (err) {
    ElMessage.error(`导出失败：${(err as Error).message || err}`)
  } finally {
    exporting.value = false
  }
}

function onFileChange(file: UploadFile): void {
  const raw = file.raw
  if (!raw) return
  fileName.value = raw.name
  const reader = new FileReader()
  reader.onload = () => {
    void loadArchiveText(String(reader.result ?? ''))
  }
  reader.onerror = () => {
    importing.value = false
    ElMessage.error('读取档案文件失败，请重试。')
  }
  importing.value = true
  reader.readAsText(raw)
}

async function loadArchiveText(text: string): Promise<void> {
  lastError.value = ''
  resultText.value = ''
  const parsed = parseMergeArchive(text)
  if (!parsed.ok || !parsed.archive) {
    archive.value = null
    plan.value = null
    lastError.value = parsed.error ?? '档案解析失败'
    importing.value = false
    ElMessage.error(lastError.value)
    return
  }
  archive.value = parsed.archive
  await makePlan()
  importing.value = false
}

async function makePlan(): Promise<void> {
  if (!archive.value) return
  await refreshStores()
  const snapshot = {
    postmarks: postmarkStore.list,
    covers: coverStore.list,
    routes: routeStore.list,
    stampEntries: coverStore.entries
  }
  // 深拷贝再转响应式：对账计划是纯数据，挑选时直接改 diff.chosen 需触发视图更新
  const built = buildMergePlan(snapshot, archive.value)
  plan.value = reactive(structuredClone(built)) as MergePlan
  statusFilter.value = hasMissing.value ? 'all' : 'conflict'
}

/** 冲突复核后重新生成计划（保留挑选需要在重置后由用户再选，故仅在首次导入时建计划）。 */
async function rePlan(): Promise<void> {
  lastError.value = ''
  resultText.value = ''
  try {
    await makePlan()
    ElMessage.success('已按当前本机数据重新对账')
  } catch (err) {
    lastError.value = `重新对账失败：${(err as Error).message || err}`
  }
}

function setChoice(item: MergeItem, fieldKey: string, side: MergeSide): void {
  const diff = item.diffs.find((d) => d.key === fieldKey)
  if (diff) diff.chosen = side
}

function chooseAll(side: MergeSide): void {
  for (const item of conflicts.value) {
    for (const diff of item.diffs) diff.chosen = side
  }
  ElMessage.info(side === 'incoming' ? '本页全部冲突已改为采用对端内容' : '本页全部冲突已改为保留本机内容')
}

const groupedMissing = computed<{ kind: string; rows: MissingRef[] }[]>(() => {
  if (!plan.value) return []
  const labels: Record<string, string> = { postmark: '缺邮戳', route: '缺邮路', cover: '缺实寄封' }
  const map = new Map<string, MissingRef[]>()
  for (const m of plan.value.missing) {
    const list = map.get(m.kind) ?? []
    list.push(m)
    map.set(m.kind, list)
  }
  return [...map.entries()].map(([kind, rows]) => ({ kind: labels[kind] ?? kind, rows }))
})

async function confirmApply(): Promise<void> {
  if (!plan.value || !archive.value || hasMissing.value) return
  try {
    await ElMessageBox.confirm(
      `将写入 ${summary.value?.incomingOnly ?? 0} 条对端新增、合并 ${
        summary.value?.conflict ?? 0
      } 条双方修改。提交在单个事务内完成，失败会整体回滚，现有数据不受影响。`,
      '确认完成合并',
      { confirmButtonText: '执行合并', cancelButtonText: '再看看', type: 'warning' }
    )
  } catch {
    return
  }
  applying.value = true
  lastError.value = ''
  try {
    const snapshot = {
      postmarks: postmarkStore.list,
      covers: coverStore.list,
      routes: routeStore.list,
      stampEntries: coverStore.entries
    }
    const result = await applyMergePlan(snapshot, archive.value, plan.value)
    await refreshStores()
    resultText.value = [
      `合并完成 · ${nowIso()}`,
      `新增：邮戳 ${result.added.postmark} · 实寄封 ${result.added.cover} · 邮路 ${result.added.route} · 票戳组合 ${result.added.entry}`,
      `合并修改：邮戳 ${result.updated.postmark} · 实寄封 ${result.updated.cover} · 邮路 ${result.updated.route} · 票戳组合 ${result.updated.entry}`,
      `原图同步：${result.assetsUpdated} 个文件`
    ].join('\n')
    plan.value = null
    archive.value = null
    fileName.value = ''
    ElMessage.success('合并完成')
  } catch (err) {
    lastError.value = `合并未完成，现有数据保持原样，可调整后重试：${(err as Error).message || err}`
    ElMessage.error('合并失败，数据已回滚')
  } finally {
    applying.value = false
  }
}

function timeLabel(value: string): string {
  if (!value) return '无时间记录'
  return value.replace('T', ' ').slice(0, 19)
}

function statusTag(status: MergeItem['status']): { type: 'info' | 'success' | 'warning' | 'danger'; text: string } {
  switch (status) {
    case 'conflict':
      return { type: 'danger', text: '双方都改过' }
    case 'incomingOnly':
      return { type: 'success', text: '对端新增' }
    case 'localOnly':
      return { type: 'info', text: '仅本机有' }
    default:
      return { type: 'info', text: '一致' }
  }
}

function chooseRowAll(item: MergeItem, side: MergeSide): void {
  for (const diff of item.diffs) diff.chosen = side
}

const incomingName = computed(() => plan.value?.deviceName || '对端')
</script>

<template>
  <div class="gb-page merge-page">
    <header class="gb-page__head">
      <div>
        <h1 class="gb-page__title">离线合并通道</h1>
        <p class="gb-page__subtitle">
          两台电脑各自导出档案，回家离线导入：按稳定编目键（编目号 / 封号 / 邮路号 / 票戳组合键）识别同一记录，
          同键修改逐字段保留双方内容供挑选，跨对象引用先对账、缺项补齐后才提交；提交失败整体回滚，可重试。
        </p>
      </div>
    </header>

    <!-- 第一步：导出本机档案 -->
    <section class="gb-panel">
      <h2 class="gb-panel__title">① 导出本机合并档案</h2>
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="本机标识">
          <el-input v-model="deviceName" placeholder="如 家里电脑 / 外出电脑" style="width: 200px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="exporting" @click="doExport">导出合并档案（.gbpostmark.json）</el-button>
        </el-form-item>
      </el-form>
      <p class="merge-page__hint">
        档案包含邮戳、实寄封、邮路、票戳组合与原图，以及记录的创建/修改时间；纯文件交换，全程不联网。
      </p>
    </section>

    <!-- 第二步：导入对端档案 -->
    <section class="gb-panel">
      <h2 class="gb-panel__title">② 导入对端档案并对账</h2>
      <el-upload :auto-upload="false" :show-file-list="false" accept=".json,application/json" :on-change="onFileChange">
        <el-button :loading="importing">选择对端导出的档案文件</el-button>
      </el-upload>
      <span v-if="fileName" class="merge-page__filename">已选择：{{ fileName }}</span>
      <p v-if="lastError" class="merge-page__error">{{ lastError }}</p>
    </section>

    <!-- 第三步：对账结果 -->
    <template v-if="plan">
      <section v-if="hasMissing" class="gb-panel merge-page__blocker">
        <h2 class="gb-panel__title">引用对账：存在缺项，暂不能完成合并</h2>
        <p class="merge-page__blocker-text">
          对端档案中的封或票戳组合引用了档案内不存在的对象（多为对端库里的旧编号）。
          请把缺项补入对端档案后重新导出，再回来导入；现有数据未做任何改动。
        </p>
        <div v-for="group in groupedMissing" :key="group.kind" class="merge-page__missing-group">
          <strong>{{ group.kind }}（{{ group.rows.length }}）</strong>
          <ul>
            <li v-for="(m, i) in group.rows" :key="`${m.kind}-${m.key}-${i}`">
              {{ m.fromLabel }} → {{ m.via }}：<el-tag size="small" type="danger">{{ m.key }}</el-tag>
            </li>
          </ul>
        </div>
        <el-button @click="rePlan">我已在本机补录，重新对账</el-button>
      </section>

      <section v-if="plan.warnings.length" class="gb-panel merge-page__warnings">
        <h2 class="gb-panel__title">本机历史悬挂引用（仅提示，不影响本次合并）</h2>
        <ul>
          <li v-for="(w, i) in plan.warnings" :key="i">{{ w }}</li>
        </ul>
      </section>

      <section class="gb-panel">
        <div class="merge-page__summary-head">
          <h2 class="gb-panel__title">
            对账结果 · 对端：{{ incomingName }}（导出于 {{ timeLabel(plan.exportedAt) }}）
          </h2>
          <div class="merge-page__summary-actions">
            <el-button size="small" @click="rePlan">重新对账</el-button>
            <el-button size="small" @click="chooseAll('local')">冲突全留本机</el-button>
            <el-button size="small" @click="chooseAll('incoming')">冲突全取对端</el-button>
            <el-button type="primary" size="small" :disabled="hasMissing" :loading="applying" @click="confirmApply">
              完成合并
            </el-button>
          </div>
        </div>

        <el-descriptions :column="5" border size="small" class="merge-page__stats">
          <el-descriptions-item label="一致">{{ summary?.identical }}</el-descriptions-item>
          <el-descriptions-item label="对端新增">
            <span class="merge-page__stat-add">{{ summary?.incomingOnly }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="仅本机">{{ summary?.localOnly }}</el-descriptions-item>
          <el-descriptions-item label="双方修改">
            <span class="merge-page__stat-conflict">{{ summary?.conflict }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="冲突字段">{{ summary?.conflictFields }}</el-descriptions-item>
        </el-descriptions>

        <div class="merge-page__filters">
          <el-radio-group v-model="statusFilter" size="small">
            <el-radio-button v-for="t in statusTabs" :key="t.key" :value="t.key">{{ t.label }}</el-radio-button>
          </el-radio-group>
          <el-select v-model="kindFilter" size="small" style="width: 140px">
            <el-option label="全部类型" value="all" />
            <el-option label="邮戳" value="postmark" />
            <el-option label="实寄封" value="cover" />
            <el-option label="邮路" value="route" />
            <el-option label="票戳组合" value="entry" />
          </el-select>
        </div>

        <el-collapse v-if="visibleItems.length" class="merge-page__list">
          <el-collapse-item v-for="item in visibleItems" :key="`${item.kind}-${item.stableKey}`" :name="`${item.kind}-${item.stableKey}`">
            <template #title>
              <div class="merge-page__item-title">
                <el-tag size="small" type="info" effect="plain">{{ KIND_LABEL[item.kind] }}</el-tag>
                <el-tag size="small" :type="statusTag(item.status).type">{{ statusTag(item.status).text }}</el-tag>
                <span class="merge-page__item-name">{{ item.title }}</span>
                <span v-if="item.diffs.length" class="merge-page__item-diff-count">{{ item.diffs.length }} 个字段不同</span>
              </div>
            </template>

            <!-- 新增 / 仅本机 / 一致：摘要展示 -->
            <div v-if="item.status !== 'conflict'" class="merge-page__single">
              <p v-if="item.status === 'incomingOnly'">
                将从对端新增到本机（跨对象引用会自动按编目号重写）。
                <span class="merge-page__time">对端更新于 {{ timeLabel(item.incomingUpdatedAt) }}</span>
              </p>
              <p v-else-if="item.status === 'localOnly'">本机独有，合并后保持不变。</p>
              <p v-else>双方内容一致，无需处理。</p>
            </div>

            <!-- 冲突：逐字段双方内容 + 时间，供挑选 -->
            <table v-else class="merge-page__diff-table">
              <thead>
                <tr>
                  <th class="merge-page__col-field">字段</th>
                  <th class="merge-page__col-side">
                    本机内容
                    <el-button link type="primary" size="small" @click.stop="chooseRowAll(item, 'local')">全选</el-button>
                    <span class="merge-page__time">{{ timeLabel(item.localUpdatedAt) }}</span>
                  </th>
                  <th class="merge-page__col-side">
                    {{ incomingName }}内容
                    <el-button link type="primary" size="small" @click.stop="chooseRowAll(item, 'incoming')">全选</el-button>
                    <span class="merge-page__time">{{ timeLabel(item.incomingUpdatedAt) }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="diff in item.diffs" :key="diff.key">
                  <td>{{ diff.label }}</td>
                  <td :class="{ 'merge-page__chosen': diff.chosen === 'local' }" @click="setChoice(item, diff.key, 'local')">
                    <el-radio :model-value="diff.chosen" value="local" size="small">&nbsp;</el-radio>
                    <span>{{ diff.local }}</span>
                  </td>
                  <td :class="{ 'merge-page__chosen': diff.chosen === 'incoming' }" @click="setChoice(item, diff.key, 'incoming')">
                    <el-radio :model-value="diff.chosen" value="incoming" size="small">&nbsp;</el-radio>
                    <span>{{ diff.incoming }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </el-collapse-item>
        </el-collapse>
        <p v-else class="gb-empty">当前筛选下没有记录。</p>
      </section>
    </template>

    <section v-if="resultText" class="gb-panel merge-page__result">
      <h2 class="gb-panel__title">合并结果</h2>
      <pre>{{ resultText }}</pre>
    </section>

    <section v-if="!plan && !resultText" class="gb-panel">
      <h2 class="gb-panel__title">合并规则说明</h2>
      <ul class="merge-page__rules">
        <li>同一记录按稳定编目键识别：邮戳＝编目号 PM-xxxx，实寄封＝封号 CV-xxxx，邮路＝邮路号 RT-xxxx，票戳组合＝内容稳定键。</li>
        <li>双方新增同一枚（同编目号）不会拆成重复档案；双方都改过的，逐字段并列展示内容与修改时间，由你挑选。</li>
        <li>封上的销票邮戳、所属邮路先按编目号/邮路号对账重写，自动适配两端不同的表内编号。</li>
        <li>被引用的邮戳、邮路或父封在对端档案中缺失时，合并被拦截；缺项补齐、重新导出后再导入即可。</li>
        <li>全部写入在同一事务内完成：任一步失败整体回滚，现有数据保持原样，可重新导入重试。</li>
        <li>旧版本数据升级（v3 回填票戳组合稳定键）后，同样参加后续合并。</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.merge-page__hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--gb-muted);
}
.merge-page__filename {
  margin-left: 12px;
  font-size: 13px;
  color: var(--gb-muted);
}
.merge-page__error {
  margin: 10px 0 0;
  color: #b02a1e;
  font-size: 13px;
}
.merge-page__blocker {
  border-color: #e0b4ad;
  background: #fdf3f1;
}
.merge-page__blocker-text {
  font-size: 13px;
  color: #8c3b2e;
}
.merge-page__missing-group ul {
  margin: 4px 0 10px;
  padding-left: 20px;
  font-size: 13px;
}
.merge-page__missing-group li {
  margin: 3px 0;
}
.merge-page__warnings {
  border-color: #ecd3a5;
  background: #fdf8ee;
}
.merge-page__warnings ul {
  margin: 0;
  padding-left: 20px;
  font-size: 12px;
  color: var(--gb-muted);
}
.merge-page__summary-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.merge-page__summary-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.merge-page__stats {
  margin: 8px 0 12px;
}
.merge-page__stat-add {
  color: #1f7a4d;
  font-weight: 700;
}
.merge-page__stat-conflict {
  color: #b02a1e;
  font-weight: 700;
}
.merge-page__filters {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.merge-page__list {
  border-top: 1px solid var(--gb-line);
}
.merge-page__item-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.merge-page__item-name {
  font-weight: 600;
}
.merge-page__item-diff-count {
  font-size: 12px;
  color: #b02a1e;
}
.merge-page__single {
  font-size: 13px;
  color: var(--gb-muted);
  padding: 4px 8px 8px;
}
.merge-page__time {
  margin-left: 8px;
  font-size: 12px;
  color: var(--gb-muted);
}
.merge-page__diff-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.merge-page__diff-table th,
.merge-page__diff-table td {
  border: 1px solid var(--gb-line);
  padding: 6px 8px;
  vertical-align: top;
  text-align: left;
}
.merge-page__diff-table th {
  background: #faf3e8;
  width: 42%;
}
.merge-page__col-field {
  width: 110px;
}
.merge-page__diff-table td {
  cursor: pointer;
}
.merge-page__chosen {
  background: #f3f9f4;
}
.merge-page__result pre {
  white-space: pre-wrap;
  font-size: 13px;
  margin: 0;
  color: var(--gb-ink);
}
.merge-page__rules {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--gb-muted);
  line-height: 1.9;
}
</style>
