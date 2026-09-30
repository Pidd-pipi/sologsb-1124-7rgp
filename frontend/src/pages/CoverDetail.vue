<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { UploadFile } from 'element-plus'
import RouteTimeline from '@/components/common/RouteTimeline.vue'
import ScarceTag from '@/components/common/ScarceTag.vue'
import StampCard from '@/components/common/StampCard.vue'
import { useCoverRoute } from '@/hooks/useCoverRoute'
import { useCoverStore } from '@/stores/coverStore'
import { usePostmarkStore } from '@/stores/postmarkStore'
import { useRouteStore } from '@/stores/routeStore'
import type { Postmark } from '@/types/postmark'
import type { TimelineNode } from '@/types/route'
import type { StamplessEntry } from '@/types/stampentry'
import {
  COVER_POSITIONS,
  VARIETY_TYPES,
  createEmptyStampEntry
} from '@/types/stampentry'
import { CONDITION_GRADES } from '@/types/cover'
import { loadAssets, saveAsset } from '@/utils/db'
import { nowIso } from '@/utils/id'

const props = defineProps<{ id: string }>()
const router = useRouter()
const coverStore = useCoverStore()
const postmarkStore = usePostmarkStore()
const routeStore = useRouteStore()

const coverId = computed<number | null>(() => {
  const n = Number(props.id)
  return Number.isFinite(n) && n > 0 ? n : null
})

const { cover, route, timeline, transitDays, missingDateNodes, chronological, error, load } =
  useCoverRoute(coverId)

const frontUrl = ref('')
const backUrl = ref('')
const entryDialog = ref(false)
const exportDialog = ref(false)
const exportText = ref('')
const pmDialog = ref(false)
const activePostmark = ref<Postmark | null>(null)
const entryForm = reactive<StamplessEntry>(createEmptyStampEntry(0))

const entries = computed<StamplessEntry[]>(() => coverStore.entriesOf(coverId.value))

onMounted(async () => {
  if (!coverStore.loaded) await coverStore.load()
  if (!postmarkStore.loaded) await postmarkStore.load()
  if (!routeStore.loaded) await routeStore.load()
  await loadAssetsForCover()
})

watch(coverId, () => void loadAssetsForCover())

watch(
  () => cover.value?.id,
  () => {
    if (cover.value) void loadAssetsForCover()
  }
)

async function loadAssetsForCover(): Promise<void> {
  const id = coverId.value
  frontUrl.value = cover.value?.frontImage ?? ''
  backUrl.value = cover.value?.backImage ?? ''
  if (id == null) return
  const assets = await loadAssets('cover', id)
  const front = assets.find((a) => a.side === 'front')
  const back = assets.find((a) => a.side === 'back')
  if (front) frontUrl.value = front.dataUrl
  if (back) backUrl.value = back.dataUrl
}

async function replaceImage(side: 'front' | 'back', file: UploadFile): Promise<void> {
  const id = coverId.value
  const raw = file.raw
  if (id == null || !raw) return
  if (raw.size > 2 * 1024 * 1024) {
    ElMessage.warning('封图请控制在 2MB 以内')
    return
  }
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(raw)
  })
  await saveAsset({
    ownerType: 'cover',
    ownerId: id,
    side,
    dataUrl,
    fileName: raw.name,
    updatedAt: nowIso()
  })
  await coverStore.update(id, side === 'front' ? { frontImage: dataUrl } : { backImage: dataUrl })
  await loadAssetsForCover()
  ElMessage.success(side === 'front' ? '已更新正面图' : '已更新背面图')
}

function onFrontChange(file: UploadFile): void {
  void replaceImage('front', file)
}

function onBackChange(file: UploadFile): void {
  void replaceImage('back', file)
}

async function setGrade(grade: string): Promise<void> {
  const id = coverId.value
  if (id == null) return
  await coverStore.update(id, { conditionGrade: grade as '上品' | '中品' | '下品' })
  await load()
  ElMessage.success(`品相已标记为${grade}`)
}

function openEntryDialog(): void {
  const id = coverId.value
  if (id == null) return
  Object.assign(entryForm, createEmptyStampEntry(id))
  entryDialog.value = true
}

async function submitEntry(): Promise<void> {
  const id = coverId.value
  if (id == null) return
  if (!entryForm.stampName.trim()) {
    ElMessage.warning('请填写邮票名称')
    return
  }
  await coverStore.addEntry({ ...entryForm, coverId: id })
  entryDialog.value = false
  ElMessage.success('已加入票戳组合')
}

async function removeEntry(entry: StamplessEntry): Promise<void> {
  if (typeof entry.id !== 'number') return
  await coverStore.removeEntry(entry.id)
  ElMessage.success('已移除该组合')
}

function buildExportText(): string {
  const c = cover.value
  if (!c) return ''
  const lines = [
    `票戳明细导出 · ${c.coverNo}`,
    `收寄：${c.sentFrom} → ${c.sentTo}`,
    `寄出/到达：${c.postDate || '待考'} / ${c.arriveDate || '待考'}`,
    `品相：${c.conditionGrade}　给据：${c.registered ? '是' : '否'}`,
    '序号,邮票名称,面值,发行年份,齿度,变体,封上位置'
  ]
  entries.value.forEach((e, i) => {
    lines.push(
      [i + 1, e.stampName, e.denomination, e.issueYear, e.perforation, e.variety, e.positionOnCover].join(
        ','
      )
    )
  })
  if (!entries.value.length) lines.push('（暂无票戳组合，请先录入）')
  return lines.join('\n')
}

async function exportEntries(): Promise<void> {
  exportText.value = buildExportText()
  exportDialog.value = true
}

async function copyExport(): Promise<void> {
  try {
    await navigator.clipboard.writeText(exportText.value)
    ElMessage.success('票戳明细已复制')
  } catch {
    ElMessage.info('浏览器未授权剪贴板，请手动选择文本')
  }
}

function showPostmark(pm: Postmark): void {
  activePostmark.value = pm
  pmDialog.value = true
}

const cancelPostmarks = computed<Postmark[]>(() =>
  (cover.value?.cancelPmIds ?? [])
    .map((id) => postmarkStore.byId(id))
    .filter((pm): pm is Postmark => pm != null)
)

function onTimelineSelect(node: TimelineNode): void {
  if (node.kind === 'transit') ElMessage.info(`中转节点：${node.office}（${node.mark}）`)
}

function backToList(): void {
  void router.push('/covers')
}

function openRoute(): void {
  if (route.value?.id != null) void router.push(`/routes/${route.value.id}`)
}
</script>

<template>
  <div class="gb-page cover-detail">
    <header class="gb-page__head">
      <div>
        <h1 class="gb-page__title">
          实寄封详情
          <span v-if="cover" class="cover-detail__no">{{ cover.coverNo }}</span>
        </h1>
        <p class="gb-page__subtitle">
          <template v-if="cover">
            {{ cover.sentFrom }} → {{ cover.sentTo }} · 寄出 {{ cover.postDate || '待考' }} · 到达
            {{ cover.arriveDate || '待考' }}
          </template>
          <template v-else>按封号读取寄递事实、票戳组合与邮路时间轴。</template>
        </p>
      </div>
      <div class="cover-detail__actions">
        <el-button @click="backToList">返回目录</el-button>
        <el-button v-if="route" type="primary" plain @click="openRoute">打开邮路编辑器</el-button>
      </div>
    </header>

    <p v-if="error" class="gb-empty">{{ error }}</p>

    <template v-else-if="cover">
      <section class="gb-panel">
        <h2 class="gb-panel__title">寄递事实</h2>
        <dl class="gb-facts">
          <div><dt>封号</dt><dd>{{ cover.coverNo }}</dd></div>
          <div><dt>寄出地</dt><dd>{{ cover.sentFrom }}</dd></div>
          <div><dt>收件地</dt><dd>{{ cover.sentTo }}</dd></div>
          <div><dt>寄出日期</dt><dd>{{ cover.postDate || '待考' }}</dd></div>
          <div><dt>到达日期</dt><dd>{{ cover.arriveDate || '待考' }}</dd></div>
          <div><dt>在途天数</dt><dd>{{ transitDays == null ? '待考' : `${transitDays} 天` }}</dd></div>
          <div><dt>中转地</dt><dd>{{ cover.viaPoints.length ? cover.viaPoints.join('、') : '直封' }}</dd></div>
          <div><dt>给据邮件</dt><dd>{{ cover.registered ? '是' : '否' }}</dd></div>
          <div><dt>来源</dt><dd>{{ cover.acquireFrom || '未记' }}</dd></div>
          <div><dt>购入价</dt><dd>{{ cover.price }} 元</dd></div>
          <div><dt>藏册页位</dt><dd>{{ cover.storageAlbum || '未入册' }}</dd></div>
          <div><dt>所属邮路</dt><dd>{{ route ? `${route.routeNo} ${route.name}` : '未挂邮路' }}</dd></div>
        </dl>
        <div class="cover-detail__grade">
          <span class="cover-detail__grade-label">标记品相：</span>
          <el-radio-group
            :model-value="cover.conditionGrade"
            size="small"
            @update:model-value="setGrade(String($event))"
          >
            <el-radio-button v-for="g in CONDITION_GRADES" :key="g" :value="g">{{ g }}</el-radio-button>
          </el-radio-group>
          <ScarceTag :level="cover.conditionGrade" kind="grade" prefix="当前：" />
        </div>
      </section>

      <section class="cover-detail__figures">
        <div class="gb-figure">
          <img v-if="frontUrl" :src="frontUrl" :alt="`${cover.coverNo} 正面`" />
          <span v-else class="cover-detail__no-image">尚未上传正面图</span>
          <el-upload
            :auto-upload="false"
            :show-file-list="false"
            accept="image/*"
            :on-change="onFrontChange"
          >
            <el-button size="small">上传/替换正面图</el-button>
          </el-upload>
        </div>
        <div class="gb-figure">
          <img v-if="backUrl" :src="backUrl" :alt="`${cover.coverNo} 背面`" />
          <span v-else class="cover-detail__no-image">尚未上传背面图</span>
          <el-upload
            :auto-upload="false"
            :show-file-list="false"
            accept="image/*"
            :on-change="onBackChange"
          >
            <el-button size="small">上传/替换背面图</el-button>
          </el-upload>
        </div>
      </section>

      <section class="gb-panel">
        <h2 class="gb-panel__title">寄递事实时间轴</h2>
        <p v-if="!chronological" class="cover-detail__warn">
          日期先后有误：请核对寄出、中转与到达日期的顺序。
        </p>
        <p v-else-if="missingDateNodes.length" class="cover-detail__warn">
          缺日警示：{{ missingDateNodes.map((n) => n.office).join('、') }} 尚未确定日期。
        </p>
        <RouteTimeline :nodes="timeline" @select="onTimelineSelect" />
      </section>

      <section class="gb-panel">
        <div class="cover-detail__section-head">
          <h2 class="gb-panel__title">票戳组合表（{{ entries.length }} 条）</h2>
          <span>
            <el-button size="small" @click="exportEntries">导出票戳明细</el-button>
            <el-button size="small" type="primary" @click="openEntryDialog">录入组合</el-button>
          </span>
        </div>
        <el-table :data="entries" border stripe>
          <el-table-column label="序号" width="70">
            <template #default="{ $index }">{{ $index + 1 }}</template>
          </el-table-column>
          <el-table-column prop="stampName" label="邮票名称" min-width="150" />
          <el-table-column prop="denomination" label="面值" width="90" />
          <el-table-column prop="issueYear" label="发行年份" width="100" />
          <el-table-column prop="perforation" label="齿度" width="90" />
          <el-table-column prop="variety" label="变体" width="100" />
          <el-table-column prop="positionOnCover" label="封上位置" width="110" />
          <el-table-column label="操作" width="90">
            <template #default="{ row }">
              <el-button size="small" link type="danger" @click="removeEntry(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <section class="gb-panel">
        <h2 class="gb-panel__title">关联邮戳（{{ cancelPostmarks.length }} 枚）</h2>
        <p v-if="!cancelPostmarks.length" class="gb-empty">该封尚未关联销票邮戳。</p>
        <div v-else class="gb-grid">
          <StampCard
            v-for="pm in cancelPostmarks"
            :key="pm.id"
            :postmark="pm"
            @select="showPostmark"
          />
        </div>
      </section>
    </template>

    <el-dialog v-model="entryDialog" title="录入票戳组合" width="560px">
      <el-form label-width="96px">
        <el-form-item label="邮票名称">
          <el-input v-model="entryForm.stampName" placeholder="如 蟠龙邮票" />
        </el-form-item>
        <el-form-item label="面值">
          <el-input-number v-model="entryForm.denomination" :min="0" :precision="1" />
        </el-form-item>
        <el-form-item label="发行年份">
          <el-input-number v-model="entryForm.issueYear" :min="1800" :max="2100" />
        </el-form-item>
        <el-form-item label="齿度">
          <el-input v-model="entryForm.perforation" placeholder="如 P11 / P12.5" />
        </el-form-item>
        <el-form-item label="变体">
          <el-select v-model="entryForm.variety" style="width: 100%">
            <el-option v-for="v in VARIETY_TYPES" :key="v" :label="v" :value="v" />
          </el-select>
        </el-form-item>
        <el-form-item label="封上位置">
          <el-select v-model="entryForm.positionOnCover" style="width: 100%">
            <el-option v-for="p in COVER_POSITIONS" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="entryDialog = false">取消</el-button>
        <el-button type="primary" @click="submitEntry">保存组合</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="exportDialog" title="票戳明细导出" width="620px">
      <el-input v-model="exportText" type="textarea" :rows="12" readonly />
      <template #footer>
        <el-button @click="exportDialog = false">关闭</el-button>
        <el-button type="primary" @click="copyExport">复制明细</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="pmDialog" title="邮戳档案" width="520px">
      <div v-if="activePostmark" class="cover-detail__pm">
        <img
          v-if="activePostmark.imageDataUrl"
          :src="activePostmark.imageDataUrl"
          :alt="`${activePostmark.pmNo} 戳样`"
        />
        <dl class="gb-facts">
          <div><dt>编目号</dt><dd>{{ activePostmark.pmNo }}</dd></div>
          <div><dt>戳型</dt><dd>{{ activePostmark.type }}</dd></div>
          <div><dt>局所</dt><dd>{{ activePostmark.office }}</dd></div>
          <div><dt>使用年代</dt><dd>{{ activePostmark.yearFrom }}-{{ activePostmark.yearTo }}</dd></div>
          <div><dt>戳面日期</dt><dd>{{ activePostmark.dateOnStamp || '未注' }}</dd></div>
          <div><dt>戳径/墨色</dt><dd>{{ activePostmark.diameter }}mm / {{ activePostmark.inkColor }}</dd></div>
        </dl>
        <ScarceTag :level="activePostmark.scarceLevel" />
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.cover-detail__no {
  color: #5d3325;
  font-size: 18px;
  margin-left: 8px;
}
.cover-detail__actions {
  display: flex;
  gap: 10px;
}
.cover-detail__grade {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.cover-detail__grade-label {
  font-size: 13px;
  color: var(--gb-muted);
}
.cover-detail__figures {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}
.cover-detail__no-image {
  display: block;
  font-size: 12px;
  color: var(--gb-muted);
  margin-bottom: 8px;
}
.cover-detail__warn {
  margin: 0 0 10px;
  font-size: 13px;
  color: #b06f16;
  background: #fdf5e6;
  border: 1px solid #ecd3a5;
  border-radius: 8px;
  padding: 6px 10px;
}
.cover-detail__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.cover-detail__pm img {
  max-width: 100%;
  border-radius: 8px;
  margin-bottom: 10px;
}
</style>
