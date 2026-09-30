<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { UploadFile } from 'element-plus'
import CoverCard from '@/components/common/CoverCard.vue'
import ScarceTag from '@/components/common/ScarceTag.vue'
import { useCatalogFilter } from '@/hooks/useCatalogFilter'
import { useCoverStore } from '@/stores/coverStore'
import { usePostmarkStore } from '@/stores/postmarkStore'
import { useRouteStore } from '@/stores/routeStore'
import type { ImagePayload } from '@/stores/postmarkStore'
import type { Cover, FrankingItem } from '@/types/cover'
import { CONDITION_GRADES, createEmptyCover } from '@/types/cover'
import { clearDraft, loadDraft, saveDraft } from '@/utils/draft'
import { joinCn, nowIso, toNumber } from '@/utils/id'

const router = useRouter()
const coverStore = useCoverStore()
const postmarkStore = usePostmarkStore()
const routeStore = useRouteStore()

const source = computed(() => coverStore.list)
const { filters, filtered, activeCount, reset } = useCatalogFilter<Cover>('cover', source)

const viewMode = ref<'card' | 'table'>('card')
const dialogVisible = ref(false)
const form = reactive<Cover>(createEmptyCover())
const frontImage = ref<ImagePayload | null>(null)
const backImage = ref<ImagePayload | null>(null)
const draftHint = ref('')

onMounted(async () => {
  if (!coverStore.loaded) await coverStore.load()
  if (!postmarkStore.loaded) await postmarkStore.load()
  if (!routeStore.loaded) await routeStore.load()
})

watch(
  form,
  () => {
    if (!dialogVisible.value) return
    saveDraft('cover', JSON.parse(JSON.stringify(form)) as Cover)
    draftHint.value = nowIso()
  },
  { deep: true }
)

function openCreate(): void {
  Object.assign(form, createEmptyCover())
  form.franking = [{ stampName: '', denomination: 8, count: 1 }]
  form.coverNo = coverStore.nextCoverNo()
  frontImage.value = null
  backImage.value = null
  const draft = loadDraft<Cover>('cover')
  if (draft) Object.assign(form, draft)
  dialogVisible.value = true
}

function discardDraft(): void {
  clearDraft('cover')
  draftHint.value = ''
  Object.assign(form, createEmptyCover())
  form.franking = []
  form.coverNo = coverStore.nextCoverNo()
  frontImage.value = null
  backImage.value = null
  ElMessage.info('已清除本地草稿')
}

function addFranking(): void {
  form.franking.push({ stampName: '', denomination: 8, count: 1 })
}

function removeFranking(index: number): void {
  form.franking.splice(index, 1)
}

function frankingTotal(): number {
  return form.franking.reduce((sum: number, f: FrankingItem) => sum + (Number(f.count) || 0), 0)
}

function onImageChange(side: 'front' | 'back', file: UploadFile): void {
  const raw = file.raw
  if (!raw) return
  if (raw.size > 2 * 1024 * 1024) {
    ElMessage.warning('封图请控制在 2MB 以内')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const payload: ImagePayload = { dataUrl: String(reader.result ?? ''), fileName: raw.name }
    if (side === 'front') {
      frontImage.value = payload
      form.frontImage = payload.dataUrl
    } else {
      backImage.value = payload
      form.backImage = payload.dataUrl
    }
  }
  reader.readAsDataURL(raw)
}

function onFrontChange(file: UploadFile): void {
  onImageChange('front', file)
}

function onBackChange(file: UploadFile): void {
  onImageChange('back', file)
}

const postmarkOptions = computed(() =>
  postmarkStore.list.flatMap((pm) =>
    typeof pm.id === 'number' ? [{ label: `${pm.pmNo} ${pm.office}`, value: pm.id }] : []
  )
)

const routeOptions = computed(() =>
  routeStore.list.flatMap((rt) =>
    typeof rt.id === 'number' ? [{ label: `${rt.routeNo} ${rt.name}`, value: rt.id }] : []
  )
)

async function submit(): Promise<void> {
  if (!form.sentFrom.trim() || !form.sentTo.trim()) {
    ElMessage.warning('请填写寄出地与收件地')
    return
  }
  if (!form.franking.length) {
    ElMessage.warning('至少登记一条贴票构成')
    return
  }
  const coverNo = form.coverNo || coverStore.nextCoverNo()
  const id = await coverStore.create(
    {
      ...form,
      coverNo,
      franking: form.franking.map((f) => ({ ...f })),
      cancelPmIds: [...form.cancelPmIds],
      viaPoints: [...form.viaPoints],
      routeId: typeof form.routeId === 'number' ? form.routeId : null,
      price: toNumber(form.price)
    },
    { front: frontImage.value ?? undefined, back: backImage.value ?? undefined }
  )
  clearDraft('cover')
  draftHint.value = ''
  dialogVisible.value = false
  ElMessage.success(`已登记实寄封 ${coverNo}`)
  await router.push(`/covers/${id}`)
}

function openDetail(cover: Cover): void {
  if (cover.id == null) return
  void router.push(`/covers/${cover.id}`)
}

function pmLabel(id: number): string {
  return postmarkStore.labelOf(id)
}

function routeLabel(routeId: number | null): string {
  if (routeId == null) return '未挂邮路'
  const route = routeStore.byId(routeId)
  return route ? `${route.routeNo} ${route.name}` : `邮路 #${routeId}`
}
</script>

<template>
  <div class="gb-page cover-page">
    <header class="gb-page__head">
      <div>
        <h1 class="gb-page__title">实寄封目录</h1>
        <p class="gb-page__subtitle">
          共 {{ coverStore.total }} 封，其中给据邮件 {{ coverStore.registeredCount }} 封；按收寄地、年代、品相、是否给据筛选。
        </p>
      </div>
      <div class="cover-page__actions">
        <el-radio-group v-model="viewMode" size="small">
          <el-radio-button value="card">卡片</el-radio-button>
          <el-radio-button value="table">表格</el-radio-button>
        </el-radio-group>
        <el-button type="primary" @click="openCreate">登记实寄封</el-button>
      </div>
    </header>

    <section class="gb-panel">
      <h2 class="gb-panel__title">筛选（{{ activeCount }} 项生效）</h2>
      <el-form :inline="true" label-width="72px" @submit.prevent>
        <el-form-item label="关键词">
          <el-input v-model="filters.keyword" placeholder="封号 / 来源 / 藏册页位" clearable />
        </el-form-item>
        <el-form-item label="收寄地">
          <el-input v-model="filters.office" placeholder="如 上海 或 南京" clearable />
        </el-form-item>
        <el-form-item label="年代区间">
          <el-input v-model="filters.era" placeholder="如 1900-1930" clearable style="width: 150px" />
        </el-form-item>
        <el-form-item label="品相">
          <el-select v-model="filters.conditionGrade" placeholder="全部" clearable style="width: 120px">
            <el-option v-for="g in CONDITION_GRADES" :key="g" :label="g" :value="g" />
          </el-select>
        </el-form-item>
        <el-form-item label="给据邮件">
          <el-select v-model="filters.registered" style="width: 120px">
            <el-option label="全部" value="" />
            <el-option label="仅给据" value="yes" />
            <el-option label="仅平信" value="no" />
          </el-select>
        </el-form-item>
        <el-form-item label="排序">
          <el-select v-model="filters.sortKey" style="width: 150px">
            <el-option label="最近更新" value="recent" />
            <el-option label="封号升序" value="noAsc" />
            <el-option label="年代升序" value="yearAsc" />
            <el-option label="年代降序" value="yearDesc" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button @click="reset">重置筛选</el-button>
        </el-form-item>
      </el-form>
    </section>

    <p v-if="!filtered.length" class="gb-empty">没有符合当前条件的实寄封，试试清空收寄地或放宽年代区间。</p>

    <div v-else-if="viewMode === 'card'" class="gb-grid gb-grid--wide">
      <CoverCard
        v-for="cover in filtered"
        :key="cover.id"
        :cover="cover"
        :stamp-count="coverStore.frankingCount(cover)"
        :pm-count="coverStore.cancelCount(cover)"
        @select="openDetail"
      />
    </div>

    <el-table v-else :data="filtered" border stripe @row-click="openDetail">
      <el-table-column prop="coverNo" label="封号" width="110" />
      <el-table-column label="收寄地" min-width="170">
        <template #default="{ row }">{{ row.sentFrom }} → {{ row.sentTo }}</template>
      </el-table-column>
      <el-table-column prop="postDate" label="寄出" width="115" />
      <el-table-column prop="arriveDate" label="到达" width="115" />
      <el-table-column label="贴票枚数" width="110" align="center">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">{{ coverStore.frankingCount(row) }} 枚</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="关联邮戳" width="120" align="center">
        <template #default="{ row }">
          <el-tag size="small" type="warning" effect="plain">
            {{ coverStore.cancelCount(row) }} 枚
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="品相" width="90">
        <template #default="{ row }">
          <ScarceTag :level="row.conditionGrade" kind="grade" />
        </template>
      </el-table-column>
      <el-table-column label="给据" width="80">
        <template #default="{ row }">{{ row.registered ? '是' : '否' }}</template>
      </el-table-column>
      <el-table-column label="邮路" min-width="150">
        <template #default="{ row }">{{ routeLabel(row.routeId) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="90">
        <template #default="{ row }">
          <el-button size="small" link type="primary" @click.stop="openDetail(row)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" title="登记实寄封" width="760px">
      <el-form label-width="104px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="封号">
              <el-input v-model="form.coverNo" placeholder="留空自动生成" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="品相">
              <el-select v-model="form.conditionGrade" style="width: 100%">
                <el-option v-for="g in CONDITION_GRADES" :key="g" :label="g" :value="g" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="寄出地">
              <el-input v-model="form.sentFrom" placeholder="如 上海" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="收件地">
              <el-input v-model="form.sentTo" placeholder="如 南京" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="寄出日期">
              <el-date-picker
                v-model="form.postDate"
                type="date"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="到达日期">
              <el-date-picker
                v-model="form.arriveDate"
                type="date"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="关联邮戳">
              <el-select
                v-model="form.cancelPmIds"
                multiple
                placeholder="选择销票邮戳"
                style="width: 100%"
              >
                <el-option
                  v-for="opt in postmarkOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="所属邮路">
              <el-select v-model="form.routeId" placeholder="可不挂" clearable style="width: 100%">
                <el-option
                  v-for="opt in routeOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="中转地">
              <el-select
                v-model="form.viaPoints"
                multiple
                filterable
                allow-create
                default-first-option
                :reserve-keyword="false"
                placeholder="输入后回车添加"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="给据邮件">
              <el-switch v-model="form.registered" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="来源">
              <el-input v-model="form.acquireFrom" placeholder="如 邮品交流 / 家族旧藏" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="购入价(元)">
              <el-input-number v-model="form.price" :min="0" :precision="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="藏册页位">
              <el-input v-model="form.storageAlbum" placeholder="如 甲册 3 页" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="正面图">
              <el-upload
                :auto-upload="false"
                :show-file-list="false"
                accept="image/*"
                :on-change="onFrontChange"
              >
                <el-button>选择正面图</el-button>
              </el-upload>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="背面图">
              <el-upload
                :auto-upload="false"
                :show-file-list="false"
                accept="image/*"
                :on-change="onBackChange"
              >
                <el-button>选择背面图</el-button>
              </el-upload>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注">
              <el-input v-model="form.note" type="textarea" :rows="2" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="贴票构成">
          <div class="cover-page__franking">
            <el-table :data="form.franking" size="small" border>
              <el-table-column label="票种" min-width="160">
                <template #default="{ row }">
                  <el-input v-model="row.stampName" placeholder="如 蟠龙邮票" />
                </template>
              </el-table-column>
              <el-table-column label="面值" width="130">
                <template #default="{ row }">
                  <el-input-number v-model="row.denomination" :min="0" :precision="1" size="small" />
                </template>
              </el-table-column>
              <el-table-column label="枚数" width="130">
                <template #default="{ row }">
                  <el-input-number v-model="row.count" :min="1" size="small" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="90">
                <template #default="{ $index }">
                  <el-button size="small" link type="danger" @click="removeFranking($index)">
                    删除
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
            <div class="cover-page__franking-actions">
              <el-button size="small" @click="addFranking">添加一行</el-button>
              <span class="cover-page__draft">合计 {{ frankingTotal() }} 枚</span>
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="cover-page__footer">
          <span class="cover-page__draft">
            {{ draftHint ? '表单草稿已存入浏览器 localStorage' : '未保存草稿' }}
          </span>
          <span>
            <el-button link type="info" @click="discardDraft">清除草稿</el-button>
            <el-button @click="dialogVisible = false">取消</el-button>
            <el-button type="primary" @click="submit">保存并查看详情</el-button>
          </span>
        </div>
      </template>
    </el-dialog>

    <section class="gb-panel">
      <h2 class="gb-panel__title">封上邮戳速览</h2>
      <p v-if="!coverStore.list.length" class="gb-empty">尚无实寄封，先登记一封。</p>
      <ul v-else class="cover-page__pm-list">
        <li v-for="cover in coverStore.list" :key="cover.id">
          <strong>{{ cover.coverNo }}</strong>
          <span>{{ joinCn(cover.cancelPmIds.map(pmLabel)) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.cover-page__actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
.cover-page__franking {
  width: 100%;
}
.cover-page__franking-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}
.cover-page__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.cover-page__draft {
  font-size: 12px;
  color: var(--gb-muted);
}
.cover-page__pm-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.cover-page__pm-list li {
  display: flex;
  gap: 10px;
  font-size: 13px;
  color: var(--gb-muted);
  border-bottom: 1px dashed var(--gb-line);
  padding-bottom: 4px;
}
.cover-page__pm-list strong {
  color: #5d3325;
  min-width: 84px;
}
</style>
