<script setup lang="ts">
import { computed } from 'vue'

type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'

const props = withDefaults(
  defineProps<{
    /** 稀见度（常见/少见/罕见/孤品）或品相（上品/中品/下品） */
    level: string
    kind?: 'scarce' | 'grade'
    prefix?: string
  }>(),
  { kind: 'scarce', prefix: '' }
)

const tagType = computed<TagType>(() => {
  if (props.kind === 'grade') {
    if (props.level === '上品') return 'success'
    if (props.level === '中品') return 'warning'
    return 'danger'
  }
  if (props.level === '孤品') return 'danger'
  if (props.level === '罕见') return 'warning'
  if (props.level === '少见') return 'primary'
  return 'info'
})
</script>

<template>
  <el-tag class="scarce-tag" :type="tagType" size="small" effect="light" round>
    {{ prefix }}{{ level }}
  </el-tag>
</template>

<style scoped>
.scarce-tag {
  font-weight: 600;
  letter-spacing: 0.02em;
}
</style>
