import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Output goes to apps/uc_browser/static/ — NOT inside frontend/
    // This keeps package.json out of the uploaded source (the .databricksignore
    // excludes frontend/ entirely, preventing npm install from running at startup)
    outDir: '../static',
    emptyOutDir: true,
  },
  server: {
    // Proxy /api calls to FastAPI during local development
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
