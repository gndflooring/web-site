import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// Custom domain (www.gnd-flooring.com) serves from the root, so base stays '/'.
export default defineConfig(({ mode }) => {
  // Only PUBLIC client-side values are inlined into the bundle. CI passes them
  // as env vars (from the github-pages environment variables); locally they
  // come from .env. Secrets in .env (GITHUB_PUSH_TOKEN, RECAPTCHA_SECRET_KEY)
  // are deliberately never referenced or defined here.
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const pick = (k) => process.env[k] ?? fileEnv[k] ?? ''

  const SHEETS_URL = pick('SHEETS_URL')
  const RECAPTCHA_SITE_KEY = pick('RECAPTCHA_SITE_KEY')
  const GOOGLE_OAUTH_CLIENT_ID = pick('GOOGLE_OAUTH_CLIENT_ID')
  const SHEETS_SPREADSHEET_ID = pick('SHEETS_SPREADSHEET_ID')
  const ADMIN_ALLOWED_EMAILS = pick('ADMIN_ALLOWED_EMAILS')

  return {
    base: '/',
    plugins: [tailwindcss()],
    define: {
      __SHEETS_URL__: JSON.stringify(SHEETS_URL),
      __RECAPTCHA_SITE_KEY__: JSON.stringify(RECAPTCHA_SITE_KEY),
      __GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(GOOGLE_OAUTH_CLIENT_ID),
      __SHEETS_SPREADSHEET_ID__: JSON.stringify(SHEETS_SPREADSHEET_ID),
      __ADMIN_ALLOWED_EMAILS__: JSON.stringify(ADMIN_ALLOWED_EMAILS),
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      rollupOptions: {
        input: {
          main: resolve(process.cwd(), 'index.html'),
          admin: resolve(process.cwd(), 'admin/index.html'),
        },
      },
    },
  }
})
