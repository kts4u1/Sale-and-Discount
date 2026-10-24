import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.API_URL ?? 'http://localhost:8787';

export default defineConfig({
  // 상대 경로: GitHub Pages(https://계정.github.io/저장소/)처럼 하위 폴더에 올려도 동작
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
