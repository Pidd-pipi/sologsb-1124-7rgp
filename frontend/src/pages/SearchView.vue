<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import CoverCard from '@/components/common/CoverCard.vue'
import ScarceTag from '@/components/common/ScarceTag.vue'
import StampCard from '@/components/common/StampCard.vue'
import { useCatalogFilter } from '@/hooks/useCatalogFilter'
import { useCoverStore } from '@/stores/coverStore'
import { usePostmarkStore } from '@/stores/postmarkStore'
import { useRouteStore } from '@/stores/routeStore'
import type { Cover } from '@/types/cover'
import type { Postmark } from '@/types/postmark'
import type { PostalRoute } from '@/types/route'
import { POSTMARK_TYPES } from '@/types/postmark'
import { TRANSPORT_MODES } from '@/types/route'
import { parseEraRange, toGanzhi } from '@/utils/dateRange'

const router = useRouter()
const postmarkStore = usePostmarkStore()
const coverStore = useCoverStore()
const routeStore = useRouteStore()

const keyword = ref('')
const era = ref('')
const groups = reactive({ postmark: true, cover: true, route: true })

const pmFilter = useCatalogFilter<Postmark>('postmark', computed(() => postmarkStore.list))
const coverFilter = useCatalogFilter<Cover>('cover', computed(() => coverStore.list))
const routeFilter = useCatalogFilter<PostalRoute>('route', computed(() => routeStore.list))

const eraHint = computed(() => {
  const range = parseEraRange(era.value)
  if (!range) return ''
  return `${range.from} 年 ${toGanzhi(range.from)} — ${range.to} 年 ${toGanzhi(range.to)}`
})

onMounted(async () => {
  if (!postmarkStore.loaded) await postmarkStore.load()
  if (!coverStore.loaded) await coverStore.load()
  if (!routeStore.loaded) await routeStore.load()
})

watch([keyword, era], () => {
  for (const filter of [pmFilter.filters, coverFilter.filters, routeFilter.filters]) {
    filter.keyword = keyword.value
    filter.era = era.value
  }
})

const totalHits = computed(
  () => pmFilter.filtered.value.length + coverFilter.filtered.value.length + routeFilter.filtered.value.length
)

const detailDialog = ref(false)
const activePostmark = ref<Postmark | null>(null)

function showPostmark(pm: Postmark): void {
  activePostmark.value = pm
  detailDialog.value = true
}

function openCover(cover: Cover): void {
  if (typeof cover.id === 'number') void router.push(`/covers/${cover.id}`)
}

function openRoute(route: PostalRoute): void {
  if (typeof route.id === 'number') void router.push(`/routes/${route.id}`)
}

function resetAll(): void {
  keyword.value = ''
  era.value = ''
  pmFilter.reset()
  coverFilter.reset()
  routeFilter.reset()
  groups.postmark = true
  groups.cover = true
  groups.route = true
}
</script>

<template>
  <div class="gb-page search-view">
    <header class="gb-page__head">
      <div>
        <h1 class="gb-page__title">综合检索</h1>
        <p class="gb-page__subtitle">
          跨邮戳、实寄封、邮路按关键词与年代检索，结果按类型分组；命中 {{ totalHits }} 条。
        </p>
      </div>
      <el-button @click="resetAll">重置全部条件</el-button>
    </header>

    <section class="gb-panel">
      <el-form :inline="true" label-width="82px" @submit.prevent>
        <el-form-item label="关键词">
          <el-input
            v-model="keyword"
            placeholder="编目号 / 局所 / 收寄地 / 邮路名 / 备注"
            clearable
            style="width: 280px"
          />
        </el-form-item>
        <el-form-item label="年代区间">
          <el-input v-model="era" placeholder="如 1910-1919" clearable style="width: 160px" />
        </el-form-item>
        <el-form-item label="检索范围">
          <el-checkbox v-model="groups.postmark">邮戳</el-checkbox>
          <el-checkbox v-model="groups.cover">实寄封</el-checkbox>
          <el-checkbox v-model="groups.route">邮路</el-checkbox>
        </el-form-item>
      </el-form>
      <p v-if="eraHint" class="search-view__hint">年代换算：{{ eraHint }}</p>
    </section>

    <section v-if="groups.postmark" class="gb-panel">
      <div class="search-view__head">
        <h2 class="gb-panel__title">邮戳（{{ pmFilter.filtered.value.length }} 条）</h2>
        <el-form :inline="true" @submit.prevent>
          <el-form-item label="戳型">
            <el-select v-model="pmFilter.filters.type" placeholder="全部" clearable style="width: 140px">
              <el-option v-for="t in POSTMARK_TYPES" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item label="排序">
            <el-select v-model="pmFilter.filters.sortKey" style="width: 140px">
              <el-option label="最近更新" value="recent" />
              <el-option label="编号升序" value="noAsc" />
              <el-option label="年代升序" value="yearAsc" />
              <el-option label="年代降序" value="yearDesc" />
            </el-select>
          </el-form-item>
        </el-form>
      </div>
      <p v-if="!pmFilter.filtered.value.length" class="gb-empty">没有匹配的邮戳。</p>
      <div v-else class="gb-grid">
        <StampCard
          v-for="pm in pmFilter.filtered.value"
          :key="pm.id"
          :postmark="pm"
          @select="showPostmark"
        />
      </div>
    </section>

    <section v-if="groups.cover" class="gb-panel">
      <div class="search-view__head">
        <h2 class="gb-panel__title">实寄封（{{ coverFilter.filtered.value.length }} 条）</h2>
        <el-form :inline="true" @submit.prevent>
          <el-form-item label="给据">
            <el-select v-model="coverFilter.filters.registered" style="width: 120px">
              <el-option label="全部" value="" />
              <el-option label="仅给据" value="yes" />
              <el-option label="仅平信" value="no" />
            </el-select>
          </el-form-item>
          <el-form-item label="排序">
            <el-select v-model="coverFilter.filters.sortKey" style="width: 140px">
              <el-option label="最近更新" value="recent" />
              <el-option label="封号升序" value="noAsc" />
              <el-option label="年代升序" value="yearAsc" />
              <el-option label="年代降序" value="yearDesc" />
            </el-select>
          </el-form-item>
        </el-form>
      </div>
      <p v-if="!coverFilter.filtered.value.length" class="gb-empty">没有匹配的实寄封。</p>
      <div v-else class="gb-grid gb-grid--wide">
        <CoverCard
          v-for="cover in coverFilter.filtered.value"
          :key="cover.id"
          :cover="cover"
          :stamp-count="coverStore.frankingCount(cover)"
          :pm-count="coverStore.cancelCount(cover)"
          @select="openCover"
        />
      </div>
    </section>

    <section v-if="groups.route" class="gb-panel">
      <div class="search-view__head">
        <h2 class="gb-panel__title">邮路（{{ routeFilter.filtered.value.length }} 条）</h2>
        <el-form :inline="true" @submit.prevent>
          <el-form-item label="运输">
            <el-select
              v-model="routeFilter.filters.transport"
              placeholder="全部"
              clearable
              style="width: 120px"
            >
              <el-option v-for="t in TRANSPORT_MODES" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-form>
      </div>
      <p v-if="!routeFilter.filtered.value.length" class="gb-empty">没有匹配的邮路。</p>
      <el-table v-else :data="routeFilter.filtered.value" border stripe>
        <el-table-column prop="routeNo" label="邮路号" width="110" />
        <el-table-column prop="name" label="邮路名称" min-width="180" />
        <el-table-column prop="era" label="时期" width="120" />
        <el-table-column prop="transport" label="运输" width="90" />
        <el-table-column label="节点" width="90">
          <template #default="{ row }">{{ row.nodes.length }} 站</template>
        </el-table-column>
        <el-table-column label="全程" width="90">
          <template #default="{ row }">{{ row.totalDays }} 天</template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="openRoute(row)">编辑邮路</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog v-model="detailDialog" title="邮戳档案" width="540px">
      <div v-if="activePostmark" class="search-view__pm">
        <img
          v-if="activePostmark.imageDataUrl"
          :src="activePostmark.imageDataUrl"
          :alt="`${activePostmark.pmNo} 戳样`"
        />
        <dl class="gb-facts">
          <div><dt>编目号</dt><dd>{{ activePostmark.pmNo }}</dd></div>
          <div><dt>戳型</dt><dd>{{ activePostmark.type }}</dd></div>
          <div><dt>局所</dt><dd>{{ activePostmark.office }}</dd></div>
          <div><dt>省份</dt><dd>{{ activePostmark.province || '待考' }}</dd></div>
          <div><dt>使用年代</dt><dd>{{ activePostmark.yearFrom }}-{{ activePostmark.yearTo }}（{{ toGanzhi(activePostmark.yearFrom) }}）</dd></div>
          <div><dt>戳径/墨色</dt><dd>{{ activePostmark.diameter }}mm / {{ activePostmark.inkColor }}</dd></div>
        </dl>
        <ScarceTag :level="activePostmark.scarceLevel" />
        <p class="search-view__note">{{ activePostmark.note || '暂无备注' }}</p>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.search-view__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.search-view__hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--gb-muted);
}
.search-view__pm img {
  max-width: 100%;
  border-radius: 8px;
  margin-bottom: 10px;
}
.search-view__note {
  font-size: 13px;
  color: var(--gb-muted);
  line-height: 1.6;
}
</style>
