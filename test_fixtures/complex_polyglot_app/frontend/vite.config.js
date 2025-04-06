import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [preact()],
  server: {
    proxy: {
      // Proxy /api/deno requests to Deno backend
      '/api/deno': {
        target: 'http://localhost:8000', // Deno backend address
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/deno/, ''),
      },
      // Proxy /api/python requests to Python backend
      '/api/python': {
        target: 'http://localhost:5001', // Python backend address (adjust if needed)
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/python/, ''),
      }
    }
  }
});