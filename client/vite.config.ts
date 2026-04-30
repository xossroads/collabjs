import { defineConfig } from 'vite';

export default defineConfig({
  // Resolve .ts/.tsx before .js so extension-less imports of our source files
  // hit the TypeScript sources directly. Vite's default order puts .js first,
  // which previously caused stale compiled .js files (now deleted) to shadow
  // the .ts sources in dev.
  resolve: {
    extensions: ['.mjs', '.ts', '.tsx', '.mts', '.js', '.jsx', '.json'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
