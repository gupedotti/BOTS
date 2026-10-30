import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const target = 'http://127.0.0.1:8787'

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./web/src', import.meta.url)) } },
  // .mjs (worker do pdf.js) sai como .js: servido como JavaScript em qualquer servidor/cache
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { output: { assetFileNames: (a) => (a.names?.[0] ?? '').endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]' } } },
  // versão do build no URL do service worker: cada build vira URL nova e nenhum cache (Cloudflare/navegador) segura o antigo
  define: { __BUILD__: JSON.stringify(Date.now().toString(36)) },
  server: { proxy: { '/api': target, '/ws': { target, ws: true } } },
})
