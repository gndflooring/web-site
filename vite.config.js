import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// Custom domain (www.gnd-flooring.com) serves from the root, so base stays '/'.
export default defineConfig(({ mode }) => {
  // Only these two PUBLIC client-side values are inlined into the bundle.
  // CI passes them as env vars (from the github-pages environment variables);
  // locally they come from .env. Secrets in .env (GITHUB_PUSH_TOKEN,
  // RECAPTCHA_SECRET_KEY) are deliberately never referenced or defined here,
  // so they can never leak into the client build.
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const SHEETS_URL = process.env.SHEETS_URL ?? fileEnv.SHEETS_URL ?? ''
  const RECAPTCHA_SITE_KEY =
    process.env.RECAPTCHA_SITE_KEY ?? fileEnv.RECAPTCHA_SITE_KEY ?? ''

  return {
    base: '/',
    plugins: [tailwindcss()],
    define: {
      __SHEETS_URL__: JSON.stringify(SHEETS_URL),
      __RECAPTCHA_SITE_KEY__: JSON.stringify(RECAPTCHA_SITE_KEY),
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
    },
  }
})
