import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 完全离线的构建配置：base 使用相对路径，产物不引用任何 CDN / 远程资源。
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
