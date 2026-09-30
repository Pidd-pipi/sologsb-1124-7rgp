<script setup lang="ts">
import type { Cover } from '@/types/cover'
import { joinCn } from '@/utils/id'
import ScarceTag from './ScarceTag.vue'

const props = withDefaults(
  defineProps<{
    cover: Cover
    /** 贴票枚数，行内展示 */
    stampCount?: number
    /** 关联邮戳数，行内展示 */
    pmCount?: number
    active?: boolean
  }>(),
  { stampCount: 0, pmCount: 0, active: false }
)

const emit = defineEmits<{ select: [cover: Cover] }>()

function onSelect(): void {
  emit('select', props.cover)
}

function routeText(cover: Cover): string {
  return `${cover.sentFrom || '寄出地待考'} → ${cover.sentTo || '收件地待考'}`
}
</script>

<template>
  <article class="cover-card" :class="{ 'is-active': active }" @click="onSelect">
    <div class="cover-card__figure">
      <img v-if="cover.frontImage" :src="cover.frontImage" :alt="`${cover.coverNo} 封图`" />
      <span v-else class="cover-card__figure-empty">暂无封图</span>
    </div>
    <div class="cover-card__body">
      <header class="cover-card__head">
        <span class="cover-card__no">{{ cover.coverNo }}</span>
        <span class="cover-card__tags">
          <el-tag v-if="cover.registered" size="small" type="danger" effect="plain">给据</el-tag>
          <ScarceTag :level="cover.conditionGrade" kind="grade" />
        </span>
      </header>
      <p class="cover-card__route">{{ routeText(cover) }}</p>
      <p class="cover-card__meta">
        寄出 {{ cover.postDate || '待考' }} · 到达 {{ cover.arriveDate || '待考' }}
      </p>
      <p class="cover-card__meta">
        贴票 {{ stampCount }} 枚 · 关联邮戳 {{ pmCount }} 枚
      </p>
      <p class="cover-card__via">中转：{{ joinCn(cover.viaPoints, '直封') }}</p>
    </div>
  </article>
</template>

<style scoped>
.cover-card {
  display: flex;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--gb-line, #e4d9c8);
  border-radius: 12px;
  background: #fffdf8;
  cursor: pointer;
  transition: box-shadow 0.18s ease, transform 0.18s ease, border-color 0.18s ease;
}
.cover-card:hover,
.cover-card.is-active {
  border-color: #8c3b2e;
  box-shadow: 0 6px 18px rgba(140, 59, 46, 0.14);
  transform: translateY(-2px);
}
.cover-card__figure {
  flex: 0 0 128px;
  height: 88px;
  border-radius: 8px;
  overflow: hidden;
  background: #f6efe3;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cover-card__figure img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-card__figure-empty {
  font-size: 12px;
  color: #a89578;
}
.cover-card__body {
  flex: 1;
  min-width: 0;
}
.cover-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.cover-card__no {
  font-weight: 700;
  color: #5d3325;
  letter-spacing: 0.04em;
}
.cover-card__tags {
  display: inline-flex;
  gap: 6px;
}
.cover-card__route {
  margin: 6px 0 2px;
  font-size: 15px;
  font-weight: 600;
  color: #3f3226;
}
.cover-card__meta,
.cover-card__via {
  margin: 2px 0 0;
  font-size: 12px;
  color: #7c6a54;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
