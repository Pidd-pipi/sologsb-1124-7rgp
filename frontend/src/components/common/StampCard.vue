<script setup lang="ts">
import type { Postmark } from '@/types/postmark'
import ScarceTag from './ScarceTag.vue'

const props = withDefaults(
  defineProps<{
    postmark: Postmark
    active?: boolean
  }>(),
  { active: false }
)

const emit = defineEmits<{ select: [postmark: Postmark] }>()

function onSelect(): void {
  emit('select', props.postmark)
}
</script>

<template>
  <article class="stamp-card" :class="{ 'is-active': active }" @click="onSelect">
    <div class="stamp-card__figure">
      <img v-if="postmark.imageDataUrl" :src="postmark.imageDataUrl" :alt="`${postmark.pmNo} 戳样`" />
      <span v-else class="stamp-card__figure-empty">暂无戳样</span>
    </div>
    <div class="stamp-card__body">
      <header class="stamp-card__head">
        <span class="stamp-card__no">{{ postmark.pmNo }}</span>
        <ScarceTag :level="postmark.scarceLevel" />
      </header>
      <div class="stamp-card__tags">
        <el-tag size="small" effect="plain">{{ postmark.type }}</el-tag>
        <el-tag v-if="postmark.bilingual" size="small" type="success" effect="plain">中英双文</el-tag>
      </div>
      <p class="stamp-card__office">
        {{ postmark.office || '局所待考' }}
        <span v-if="postmark.province" class="stamp-card__province">· {{ postmark.province }}</span>
      </p>
      <p class="stamp-card__meta">
        年代 {{ postmark.yearFrom }}–{{ postmark.yearTo }} · 戳径 {{ postmark.diameter }}mm ·
        {{ postmark.inkColor }}墨
      </p>
      <p class="stamp-card__lettering">
        {{ postmark.lettering.top || '上格缺' }} / {{ postmark.lettering.middle || '中格缺' }} /
        {{ postmark.lettering.bottom || '下格缺' }}
      </p>
    </div>
  </article>
</template>

<style scoped>
.stamp-card {
  display: flex;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--gb-line, #e4d9c8);
  border-radius: 12px;
  background: #fffdf8;
  cursor: pointer;
  transition: box-shadow 0.18s ease, transform 0.18s ease, border-color 0.18s ease;
}
.stamp-card:hover,
.stamp-card.is-active {
  border-color: #8c3b2e;
  box-shadow: 0 6px 18px rgba(140, 59, 46, 0.14);
  transform: translateY(-2px);
}
.stamp-card__figure {
  flex: 0 0 96px;
  height: 96px;
  border-radius: 8px;
  overflow: hidden;
  background: #f6efe3;
  display: flex;
  align-items: center;
  justify-content: center;
}
.stamp-card__figure img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.stamp-card__figure-empty {
  font-size: 12px;
  color: #a89578;
}
.stamp-card__body {
  flex: 1;
  min-width: 0;
}
.stamp-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.stamp-card__no {
  font-weight: 700;
  color: #5d3325;
  letter-spacing: 0.04em;
}
.stamp-card__tags {
  display: flex;
  gap: 6px;
  margin: 6px 0;
}
.stamp-card__office {
  margin: 2px 0;
  font-size: 14px;
  color: #3f3226;
  font-weight: 600;
}
.stamp-card__province {
  color: #8a7860;
  font-weight: 400;
}
.stamp-card__meta,
.stamp-card__lettering {
  margin: 2px 0 0;
  font-size: 12px;
  color: #7c6a54;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
