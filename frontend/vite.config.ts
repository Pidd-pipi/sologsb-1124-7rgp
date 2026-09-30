import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 21824,
    host: true
  },
  preview: {
    port: 21824
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    // 样式合成单文件：避免路由级 CSS 预加载在部分浏览器上抛出 preload 报错
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          return id.includes('node_modules') ? 'vendor' : undefined
        }
      }
    }
  }
})
