import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Dev only: Vite serves index.html (the landing) at "/", but "/room/:id" must
// load the app shell (app.html). Rewrite those requests before Vite's HTML
// middleware so the editor boots in dev exactly as it does in prod.
function roomRewrite() {
  return {
    name: 'collabjs-room-rewrite',
    configureServer(server: any) {
      server.middlewares.use((req: any, _res: any, next: any) => {
        if (req.url && /^\/room\/[a-zA-Z0-9-]+(?:[?#].*)?$/.test(req.url)) {
          req.url = '/app.html';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [roomRewrite()],
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
    rollupOptions: {
      input: {
        // "/" — lightweight landing (no editor bundle)
        main: r('./index.html'),
        // "/room/:id" — full collaborative editor
        app: r('./app.html'),
      },
    },
  },
});
