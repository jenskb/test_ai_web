import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 构建配置：base 使用相对路径（'./'），产物不引用任何 CDN / 远程资源。
// 相对 base 同时满足两点，且无需为部署目标硬编码子路径：
//   1. 本地离线：python3 -m http.server dist 等任意静态服务直接可用；
//   2. GitHub Pages 子路径：部署到 /test_ai_web/ethercat-analyzer/ 时，
//      JS / CSS / Web Worker 均相对页面目录解析，正确加载。
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
