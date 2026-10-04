import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.API_PROXY_TARGET || 'http://127.0.0.1:8080';
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: Object.fromEntries(['/auth/', '/catalog/', '/circulation/', '/recommendations/'].map(path => [path, { target, changeOrigin: true }])),
  },
});
