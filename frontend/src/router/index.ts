import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/postmarks' },
  {
    path: '/postmarks',
    name: 'postmarks',
    component: () => import('@/pages/PostmarkList.vue'),
    meta: { title: '邮戳目录' }
  },
  {
    path: '/covers',
    name: 'covers',
    component: () => import('@/pages/CoverList.vue'),
    meta: { title: '实寄封目录' }
  },
  {
    path: '/covers/:id',
    name: 'cover-detail',
    component: () => import('@/pages/CoverDetail.vue'),
    props: true,
    meta: { title: '实寄封详情' }
  },
  {
    path: '/routes/:id',
    name: 'route-editor',
    component: () => import('@/pages/RouteEditor.vue'),
    props: true,
    meta: { title: '邮路编辑器' }
  },
  {
    path: '/search',
    name: 'search',
    component: () => import('@/pages/SearchView.vue'),
    meta: { title: '综合检索' }
  },
  { path: '/:pathMatch(.*)*', redirect: '/postmarks' }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

router.afterEach((to) => {
  const title = (to.meta.title as string | undefined) ?? ''
  document.title = title ? `${title} · 邮戳与实寄封编目台` : '邮戳与实寄封编目台'
})

export default router
