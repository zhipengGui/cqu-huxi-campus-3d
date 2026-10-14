import { defineConfig } from 'vite';

export default defineConfig({
  // 本地开发/预览默认根路径；部署到 GitHub Pages 时由 CI 传入子路径
  base: process.env.BASE_PATH || '/',
  server: { host: true },
});
