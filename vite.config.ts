import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ['index.html'] },
  server: {
    watch: {
      ignored: [
        '**/test-results/**',
        '**/playwright-report/**',
        '**/dist/**',
        '**/dist-server/**',
        '**/docs/**',
      ],
    },
    proxy: {
      '/socket.io': { target: process.env.VITE_BACKEND_URL || 'http://127.0.0.1:3001', ws: true },
      '/api': 'http://127.0.0.1:3001',
    },
  },
  build: {
    rollupOptions: {
      output: { manualChunks: { three: ['three'], react: ['react', 'react-dom'] } },
    },
  },
});
