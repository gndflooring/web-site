import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// Custom domain (www.gnd-flooring.com) serves from the root, so base stays '/'.
export default defineConfig({
  base: '/',
  plugins: [tailwindcss()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
