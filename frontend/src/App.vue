<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCoverStore } from '@/stores/coverStore'
import { usePostmarkStore } from '@/stores/postmarkStore'
import { useRouteStore } from '@/stores/routeStore'

const current = useRoute()
const router = useRouter()
const postmarkStore = usePostmarkStore()
const coverStore = useCoverStore()
const routeStore = useRouteStore()

const activeMenu = computed(() => {
  const path = current.path
  if (path.startsWith('/covers')) return '/covers'
  if (path.startsWith('/postmarks')) return '/postmarks'
  if (path.startsWith('/search')) return '/search'
  return ''
})

const routeJump = computed({
  get: () => (current.path.startsWith('/routes/') ? current.path : ''),
  set: (value: string) => {
    if (value) void router.push(value)
  }
})

const routeOptions = computed(() =>
  routeStore.list.flatMap((rt) =>
    typeof rt.id === 'number'
      ? [{ label: `${rt.routeNo} ${rt.name}`, value: `/routes/${rt.id}` }]
      : []
  )
)

onMounted(async () => {
  await Promise.all([postmarkStore.load(), coverStore.load(), routeStore.load()])
})
</script>

<template>
  <el-container class="app-shell">
    <el-header class="app-header">
      <div class="app-brand">
        <img class="app-brand__mark" src="/favicon.svg" alt="编目台标志" />
        <span class="app-brand__text">
          <strong>邮戳与实寄封编目台</strong>
          <small>戳型 · 邮路 · 票戳组合 · 寄递时间轴</small>
        </span>
      </div>
      <el-menu :default-active="activeMenu" mode="horizontal" router :ellipsis="false" class="app-nav">
        <el-menu-item index="/postmarks">邮戳目录</el-menu-item>
        <el-menu-item index="/covers">实寄封目录</el-menu-item>
        <el-menu-item index="/search">综合检索</el-menu-item>
      </el-menu>
      <div class="app-aside">
        <el-select
          v-model="routeJump"
          placeholder="打开邮路编辑器"
          size="small"
          style="width: 200px"
          clearable
        >
          <el-option v-for="opt in routeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
        <span class="app-stat">
          邮戳 {{ postmarkStore.total }} · 实寄封 {{ coverStore.total }} · 邮路 {{ routeStore.total }}
        </span>
      </div>
    </el-header>
    <el-main class="app-main">
      <router-view v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </el-main>
    <el-footer class="app-footer">
      数据全部保存在浏览器本地（IndexedDB 存编目数据、localStorage 存表单草稿），无后端与外部接口。
    </el-footer>
  </el-container>
</template>

<style scoped>
.app-shell {
  min-height: 100%;
  background: var(--gb-paper);
}
.app-header {
  display: flex;
  align-items: center;
  gap: 18px;
  height: auto;
  min-height: 68px;
  padding: 8px 22px;
  background: #fffdf8;
  border-bottom: 1px solid var(--gb-line);
  flex-wrap: wrap;
}
.app-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.app-brand__mark {
  width: 34px;
  height: 34px;
}
.app-brand__text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.app-brand__text strong {
  font-size: 17px;
  color: var(--gb-brown);
  font-family: Georgia, 'Songti SC', serif;
}
.app-brand__text small {
  font-size: 11px;
  color: var(--gb-muted);
}
.app-nav {
  border-bottom: none !important;
  flex: 1;
  min-width: 280px;
}
.app-aside {
  display: flex;
  align-items: center;
  gap: 12px;
}
.app-stat {
  font-size: 12px;
  color: var(--gb-muted);
  white-space: nowrap;
}
.app-main {
  padding: 0;
}
.app-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--gb-muted);
  border-top: 1px solid var(--gb-line);
  background: #fffdf8;
  height: auto;
  padding: 10px 16px;
}
</style>
