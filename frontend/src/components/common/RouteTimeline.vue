<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TimelineNode } from '@/types/route'
import { isValidDate } from '@/utils/dateRange'

const props = withDefaults(
  defineProps<{
    nodes: TimelineNode[]
    /** 可拖拽排序 / 删除（邮路编辑器） */
    editable?: boolean
    /** 允许在节点之间插入新节点 */
    insertable?: boolean
    title?: string
  }>(),
  { editable: false, insertable: false, title: '' }
)

const emit = defineEmits<{
  select: [node: TimelineNode, index: number]
  reorder: [payload: { from: number; to: number }]
  remove: [index: number]
  insert: [index: number]
}>()

const dragIndex = ref<number | null>(null)
const overIndex = ref<number | null>(null)

const missingDates = computed(() => props.nodes.filter((n) => !isValidDate(n.date)))
const hasNodes = computed(() => props.nodes.length > 0)

function onDragStart(index: number, event: DragEvent): void {
  dragIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOver(index: number): void {
  if (props.editable) overIndex.value = index
}

function onDrop(index: number): void {
  const from = dragIndex.value
  dragIndex.value = null
  overIndex.value = null
  if (from == null || from === index) return
  emit('reorder', { from, to: index })
}

function onDragEnd(): void {
  dragIndex.value = null
  overIndex.value = null
}

function kindClass(node: TimelineNode): string {
  return `route-timeline__node--${node.kind}`
}
</script>

<template>
  <section class="route-timeline">
    <header class="route-timeline__head">
      <h3 v-if="title" class="route-timeline__title">{{ title }}</h3>
      <div class="route-timeline__flags">
        <el-tag size="small" type="info" effect="plain">节点 {{ nodes.length }} 站</el-tag>
        <el-tag v-if="editable" size="small" type="success" effect="plain">可拖拽排序</el-tag>
        <el-tag v-if="missingDates.length" size="small" type="warning" effect="plain">
          缺日警示 {{ missingDates.length }} 站
        </el-tag>
      </div>
    </header>

    <p v-if="!hasNodes" class="route-timeline__empty">尚无节点，请在下方补录寄递过程。</p>

    <div class="route-timeline__track">
      <template v-for="(node, index) in nodes" :key="node.key">
        <button
          v-if="insertable"
          class="route-timeline__insert"
          type="button"
          title="在此处插入节点"
          @click="emit('insert', index)"
        >
          +
        </button>
        <div
          class="route-timeline__node"
          :class="[
            kindClass(node),
            { 'is-missing': !isValidDate(node.date), 'is-over': overIndex === index }
          ]"
          :draggable="editable"
          @dragstart="onDragStart(index, $event)"
          @dragover.prevent="onDragOver(index)"
          @drop.prevent="onDrop(index)"
          @dragend="onDragEnd"
          @click="emit('select', node, index)"
        >
          <span class="route-timeline__label">{{ node.label }}</span>
          <strong class="route-timeline__office">{{ node.office }}</strong>
          <span class="route-timeline__date">{{ isValidDate(node.date) ? node.date : '日期待考' }}</span>
          <span class="route-timeline__mark">{{ node.mark }}</span>
          <el-button
            v-if="editable"
            class="route-timeline__remove"
            size="small"
            type="danger"
            link
            @click.stop="emit('remove', index)"
          >
            移除
          </el-button>
        </div>
        <span v-if="index < nodes.length - 1" class="route-timeline__arrow">→</span>
      </template>
      <button
        v-if="insertable"
        class="route-timeline__insert"
        type="button"
        title="在末尾追加节点"
        @click="emit('insert', nodes.length)"
      >
        +
      </button>
    </div>
  </section>
</template>

<style scoped>
.route-timeline {
  border: 1px solid var(--gb-line, #e4d9c8);
  border-radius: 12px;
  background: #fffdf8;
  padding: 14px 16px;
}
.route-timeline__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.route-timeline__title {
  margin: 0;
  font-size: 15px;
  color: #5d3325;
}
.route-timeline__flags {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}
.route-timeline__empty {
  margin: 0;
  color: #8a7860;
  font-size: 13px;
}
.route-timeline__track {
  display: flex;
  align-items: stretch;
  gap: 8px;
  overflow-x: auto;
  padding: 6px 2px 10px;
}
.route-timeline__node {
  position: relative;
  flex: 0 0 168px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px dashed #cbb99b;
  border-radius: 10px;
  background: #f9f4ea;
  cursor: pointer;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}
.route-timeline__node[draggable='true'] {
  cursor: grab;
}
.route-timeline__node.is-over {
  border-color: #8c3b2e;
  box-shadow: 0 0 0 2px rgba(140, 59, 46, 0.18);
}
.route-timeline__node.is-missing {
  background: #fdf1e2;
  border-color: #d8a24a;
}
.route-timeline__node--sent {
  background: #eef4ec;
  border-color: #9dbb92;
}
.route-timeline__node--arrive {
  background: #f6ece9;
  border-color: #c98f80;
}
.route-timeline__label {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #8a7860;
}
.route-timeline__office {
  font-size: 15px;
  color: #3f3226;
}
.route-timeline__date {
  font-size: 12px;
  color: #6f5f49;
}
.route-timeline__mark {
  font-size: 11px;
  color: #8a7860;
}
.route-timeline__remove {
  align-self: flex-start;
  padding: 0;
}
.route-timeline__arrow {
  align-self: center;
  color: #b9a480;
  font-size: 16px;
}
.route-timeline__insert {
  align-self: center;
  flex: 0 0 28px;
  height: 28px;
  border-radius: 14px;
  border: 1px dashed #cbb99b;
  background: #fff;
  color: #8c3b2e;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}
.route-timeline__insert:hover {
  border-color: #8c3b2e;
  background: #f8efe8;
}
</style>
