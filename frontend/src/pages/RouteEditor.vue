<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import RouteTimeline from '@/components/common/RouteTimeline.vue'
import { buildTimeline, useCoverRoute } from '@/hooks/useCoverRoute'
import { computeTotalDays, createRouteNode, useRouteStore } from '@/stores/routeStore'
import { useCoverStore } from '@/stores/coverStore'
import type { Cover } from '@/types/cover'
import type { PostalRoute, RouteNode, TimelineNode } from '@/types/route'
import { TRANSPORT_MODES, createEmptyRoute } from '@/types/route'
import { toGanzhi, validateChronology } from '@/utils/dateRange'
import { nowIso } from '@/utils/id'

const props = defineProps<{ id: string }>()
const router = useRouter()
const routeStore = useRouteStore()
const coverStore = useCoverStore()

const routeId = computed<number | null>(() => {
  const n = Number(props.id)
  return Number.isFinite(n) && n > 0 ? n : null
})

const route = computed<PostalRoute | null>(() => routeStore.byId(routeId.value))

const form = reactive<PostalRoute>(createEmptyRoute())
const nodeDialog = ref(false)
const nodeForm = reactive<RouteNode>(createRouteNode())
const insertIndex = ref<number | null>(null)
const selectedCoverId = ref<number | null>(null)

const previewCoverId = computed<number | null>(() => selectedCoverId.value)

const { cover: previewCover, timeline: previewTimeline, transitDays } = useCoverRoute(previewCoverId)

const nodeTimeline = computed<TimelineNode[]>(() =>
  (route.value?.nodes ?? []).map((node) => ({
    key: node.key,
    label: '节点',
    office: node.office || '节点待补',
    date: node.arriveDate,
    mark: node.transitMark || '中转戳待补',
    kind: 'transit' as const
  }))
)

const chronology = computed(() =>
  validateChronology((route.value?.nodes ?? []).map((n) => n.arriveDate))
)

const computedDays = computed(() => computeTotalDays(route.value?.nodes ?? []))

const attachedCovers = computed(() =>
  coverStore.list.filter((c) => c.routeId === routeId.value)
)

const unattachedCovers = computed(() =>
  coverStore.list.filter((c) => c.routeId !== routeId.value)
)

const coverOptions = computed(() =>
  coverStore.list.flatMap((c) =>
    typeof c.id === 'number'
      ? [
          {
            label: `${c.coverNo} ${c.sentFrom}→${c.sentTo}${c.routeId === routeId.value ? '（已挂）' : ''}`,
            value: c.id
          }
        ]
      : []
  )
)

/** 未挂邮路时，用封的中转地拼出参考时间轴 */
const fallbackTimeline = computed<TimelineNode[]>(() => {
  if (!route.value) return []
  return buildTimeline(
    {
      id: 0,
      coverNo: 'REF',
      sentFrom: route.value.nodes[0]?.office ?? '',
      sentTo: route.value.nodes[route.value.nodes.length - 1]?.office ?? '',
      postDate: route.value.nodes[0]?.arriveDate ?? '',
      arriveDate: route.value.nodes[route.value.nodes.length - 1]?.arriveDate ?? '',
      franking: [],
      cancelPmIds: [],
      routeId: route.value.id ?? null,
      viaPoints: [],
      registered: false,
      conditionGrade: '中品',
      acquireFrom: '',
      price: 0,
      storageAlbum: '',
      frontImage: '',
      backImage: '',
      note: '',
      createdAt: '',
      updatedAt: ''
    },
    route.value
  )
})

onMounted(async () => {
  if (!routeStore.loaded) await routeStore.load()
  if (!coverStore.loaded) await coverStore.load()
  syncForm()
})

watch(route, syncForm)

watch(attachedCovers, (list) => {
  if (selectedCoverId.value == null && list.length && typeof list[0].id === 'number') {
    selectedCoverId.value = list[0].id
  }
})

function syncForm(): void {
  const current = route.value
  if (!current) return
  Object.assign(form, {
    ...current,
    nodes: current.nodes.map((n) => ({ ...n }))
  })
}

async function saveHeader(): Promise<void> {
  const id = routeId.value
  if (id == null) return
  if (!form.name.trim()) {
    ElMessage.warning('请填写邮路名称')
    return
  }
  await routeStore.update(id, {
    routeNo: form.routeNo,
    name: form.name,
    era: form.era,
    transport: form.transport,
    frequency: form.frequency,
    remark: form.remark
  })
  ElMessage.success('邮路信息已保存')
}

function openNodeDialog(index: number | null): void {
  Object.assign(nodeForm, createRouteNode())
  insertIndex.value = index
  nodeDialog.value = true
}

async function submitNode(): Promise<void> {
  const id = routeId.value
  if (id == null) return
  if (!nodeForm.office.trim()) {
    ElMessage.warning('请填写节点局所')
    return
  }
  await routeStore.addNode(id, { ...nodeForm }, insertIndex.value ?? undefined)
  nodeDialog.value = false
  ElMessage.success('已加入邮路节点')
}

async function onReorder(payload: { from: number; to: number }): Promise<void> {
  const id = routeId.value
  if (id == null) return
  await routeStore.moveNode(id, payload.from, payload.to)
}

async function onRemove(index: number): Promise<void> {
  const id = routeId.value
  const node = route.value?.nodes[index]
  if (id == null || !node) return
  await routeStore.removeNode(id, node.key)
  ElMessage.success('已移除节点')
}

function onTimelineSelect(node: TimelineNode): void {
  ElMessage.info(`节点 ${node.office}（${node.date || '日期待考'}）`)
}

async function recalc(): Promise<void> {
  const id = routeId.value
  const current = route.value
  if (id == null || !current) return
  await routeStore.update(id, { nodes: current.nodes.map((n) => ({ ...n })) })
  ElMessage.success(`全程天数已重算：${computeTotalDays(current.nodes)} 天`)
}

async function attachCover(): Promise<void> {
  const id = routeId.value
  const coverId = selectedCoverId.value
  if (id == null || coverId == null) {
    ElMessage.warning('请选择要挂到此邮路的实寄封')
    return
  }
  await coverStore.update(coverId, { routeId: id })
  ElMessage.success('实寄封已挂到该邮路')
}

async function detachCover(cover: Cover): Promise<void> {
  if (typeof cover.id !== 'number') return
  await coverStore.update(cover.id, { routeId: null })
  ElMessage.success('已从邮路摘除')
}

function openCover(cover: Cover): void {
  if (typeof cover.id !== 'number') return
  void router.push(`/covers/${cover.id}`)
}

const createForm = reactive<PostalRoute>(createEmptyRoute())
const creating = ref(false)

async function createRoute(): Promise<void> {
  if (!createForm.name.trim()) {
    ElMessage.warning('请填写邮路名称')
    return
  }
  creating.value = true
  try {
    const id = await routeStore.create({
      ...createForm,
      routeNo: createForm.routeNo || routeStore.nextRouteNo(),
      nodes: createForm.nodes.map((n) => ({ ...n })),
      createdAt: nowIso(),
      updatedAt: nowIso()
    })
    ElMessage.success('邮路已创建')
    await router.replace(`/routes/${id}`)
  } finally {
    creating.value = false
  }
}

function nodeGanzhi(node: RouteNode): string {
  const year = Number((node.arriveDate || '').slice(0, 4))
  return year ? toGanzhi(year) : '—'
}
</script>

<template>
  <div class="gb-page route-editor">
    <header class="gb-page__head">
      <div>
        <h1 class="gb-page__title">
          邮路编辑器
          <span v-if="route" class="route-editor__no">{{ route.routeNo }}</span>
        </h1>
        <p class="gb-page__subtitle">
          <template v-if="route">
            {{ route.name }} · {{ route.era || '时期待考' }} · {{ route.transport }} ·
            {{ route.frequency || '班期待考' }}
          </template>
          <template v-else>节点可拖拽排序、增删中转地，全程天数按节点日期自动计算。</template>
        </p>
      </div>
      <el-button @click="router.push('/covers')">返回实寄封目录</el-button>
    </header>

    <template v-if="route">
      <section class="gb-panel">
        <h2 class="gb-panel__title">邮路信息</h2>
        <el-form :inline="true" label-width="82px" @submit.prevent>
          <el-form-item label="邮路号">
            <el-input v-model="form.routeNo" style="width: 130px" />
          </el-form-item>
          <el-form-item label="邮路名称">
            <el-input v-model="form.name" style="width: 220px" />
          </el-form-item>
          <el-form-item label="时期">
            <el-input v-model="form.era" placeholder="如 1910-1919" style="width: 140px" />
          </el-form-item>
          <el-form-item label="运输">
            <el-select v-model="form.transport" style="width: 110px">
              <el-option v-for="t in TRANSPORT_MODES" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item label="班期">
            <el-input v-model="form.frequency" placeholder="如 逐日班" style="width: 130px" />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="form.remark" style="width: 280px" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="saveHeader">保存邮路信息</el-button>
          </el-form-item>
        </el-form>
      </section>

      <section class="gb-panel">
        <div class="route-editor__head">
          <h2 class="gb-panel__title">节点编辑（拖拽排序 / 增删中转地）</h2>
          <span class="route-editor__summary">
            全程 {{ route.totalDays }} 天（按节点日期自动计算：{{ computedDays }} 天）
            <el-button size="small" @click="recalc">重算全程天数</el-button>
          </span>
        </div>
        <p v-if="!chronology.ok" class="route-editor__warn">{{ chronology.message }}</p>
        <RouteTimeline
          :nodes="nodeTimeline"
          editable
          insertable
          title="邮路节点"
          @reorder="onReorder"
          @remove="onRemove"
          @insert="openNodeDialog"
          @select="onTimelineSelect"
        />
        <el-table :data="route.nodes" border stripe class="route-editor__table">
          <el-table-column label="顺序" width="80">
            <template #default="{ $index }">{{ $index + 1 }}</template>
          </el-table-column>
          <el-table-column prop="office" label="局所" min-width="150" />
          <el-table-column prop="arriveDate" label="到达日期" width="130" />
          <el-table-column label="干支" width="90">
            <template #default="{ row }">{{ nodeGanzhi(row) }}</template>
          </el-table-column>
          <el-table-column prop="transitMark" label="中转戳" min-width="160" />
          <el-table-column label="操作" width="170">
            <template #default="{ $index }">
              <el-button size="small" link type="primary" @click="openNodeDialog($index + 1)">
                后插节点
              </el-button>
              <el-button size="small" link type="danger" @click="onRemove($index)">移除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <section class="gb-panel">
        <h2 class="gb-panel__title">把实寄封挂到邮路节点</h2>
        <div class="route-editor__attach">
          <el-select
            v-model="selectedCoverId"
            placeholder="选择实寄封"
            filterable
            style="width: 320px"
          >
            <el-option
              v-for="opt in coverOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <el-button type="primary" @click="attachCover">挂到此邮路</el-button>
        </div>
        <p v-if="!attachedCovers.length" class="gb-empty">该邮路尚未挂任何实寄封。</p>
        <ul v-else class="route-editor__covers">
          <li v-for="item in attachedCovers" :key="item.id">
            <strong>{{ item.coverNo }}</strong>
            <span>{{ item.sentFrom }} → {{ item.sentTo }}</span>
            <el-button size="small" link type="primary" @click="openCover(item)">详情</el-button>
            <el-button size="small" link type="danger" @click="detachCover(item)">摘除</el-button>
          </li>
        </ul>
        <p v-if="unattachedCovers.length" class="route-editor__hint">
          另有 {{ unattachedCovers.length }} 封未挂邮路，可在上方下拉中检索。
        </p>
      </section>

      <section class="gb-panel">
        <h2 class="gb-panel__title">按实寄封预览寄递时间轴</h2>
        <p v-if="previewCover" class="route-editor__hint">
          预览：{{ previewCover.coverNo }} · 在途
          {{ transitDays == null ? '待考' : `${transitDays} 天` }}
        </p>
        <RouteTimeline
          :nodes="previewCover ? previewTimeline : fallbackTimeline"
          title="寄递事实时间轴"
        />
      </section>
    </template>

    <section v-else class="gb-panel">
      <h2 class="gb-panel__title">未找到该邮路，可直接新建一条</h2>
      <el-form label-width="96px" style="max-width: 560px">
        <el-form-item label="邮路号">
          <el-input v-model="createForm.routeNo" placeholder="留空自动生成" />
        </el-form-item>
        <el-form-item label="邮路名称">
          <el-input v-model="createForm.name" placeholder="如 沪宁铁路邮路" />
        </el-form-item>
        <el-form-item label="时期">
          <el-input v-model="createForm.era" placeholder="如 1910-1919" />
        </el-form-item>
        <el-form-item label="运输">
          <el-select v-model="createForm.transport" style="width: 100%">
            <el-option v-for="t in TRANSPORT_MODES" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="班期">
          <el-input v-model="createForm.frequency" placeholder="如 逐日班" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="creating" @click="createRoute">新建邮路</el-button>
        </el-form-item>
      </el-form>
    </section>

    <el-dialog v-model="nodeDialog" title="新增邮路节点" width="520px">
      <el-form label-width="96px">
        <el-form-item label="局所">
          <el-input v-model="nodeForm.office" placeholder="如 苏州" />
        </el-form-item>
        <el-form-item label="到达日期">
          <el-date-picker
            v-model="nodeForm.arriveDate"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="中转戳">
          <el-input v-model="nodeForm.transitMark" placeholder="如 苏州中转日戳" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="nodeDialog = false">取消</el-button>
        <el-button type="primary" @click="submitNode">保存节点</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.route-editor__no {
  color: #5d3325;
  font-size: 18px;
  margin-left: 8px;
}
.route-editor__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.route-editor__summary {
  font-size: 13px;
  color: var(--gb-muted);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.route-editor__warn {
  margin: 0 0 10px;
  font-size: 13px;
  color: #b06f16;
  background: #fdf5e6;
  border: 1px solid #ecd3a5;
  border-radius: 8px;
  padding: 6px 10px;
}
.route-editor__table {
  margin-top: 12px;
}
.route-editor__attach {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.route-editor__covers {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.route-editor__covers li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--gb-muted);
  border-bottom: 1px dashed var(--gb-line);
  padding-bottom: 5px;
}
.route-editor__covers strong {
  color: #5d3325;
  min-width: 80px;
}
.route-editor__hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--gb-muted);
}
</style>
