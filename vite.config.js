import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, copyFileSync } from 'fs'

export default defineConfig({
  plugins: [
    react(),
    // GitHub Pages SPA fallback: copy index.html → 404.html so direct URL navigation works
    {
      name: 'gh-pages-spa',
      closeBundle() {
        if (existsSync('dist/index.html')) {
          copyFileSync('dist/index.html', 'dist/404.html')
          console.log('✅ Copied index.html → 404.html for GitHub Pages SPA routing')
        }
      },
    },
  ],
  base: '/Flashloan-XXX/',
  server: {
    port: 3000,
    open: true,
    allowedHosts: [
      '09d5-85-48-46-86.ngrok-free.app',
      '.ngrok-free.app',  // allow all ngrok subdomains
    ],
  },
})
