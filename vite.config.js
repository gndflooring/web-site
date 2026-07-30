import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import contentInjection from './vite-content.js'

// Custom domain (www.gnd-flooring.com) serves from the root, so base stays '/'.
export default defineConfig(({ mode }) => {
  // Only PUBLIC client-side values are inlined into the bundle. CI passes them
  // as env vars (from the github-pages environment variables); locally they
  // come from .env. Secrets in .env (GITHUB_PUSH_TOKEN, RECAPTCHA_SECRET_KEY)
  // are deliberately never referenced or defined here.
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const pick = (k) => process.env[k] ?? fileEnv[k] ?? ''

  const SHEETS_DEPLOYMENT_ID = pick('SHEETS_DEPLOYMENT_ID')
  const SHEETS_URL = pick('SHEETS_URL') || (SHEETS_DEPLOYMENT_ID ? `https://script.google.com/macros/s/${SHEETS_DEPLOYMENT_ID}/exec` : '')
  const RECAPTCHA_SITE_KEY = pick('RECAPTCHA_SITE_KEY')
  const GOOGLE_OAUTH_CLIENT_ID = pick('GOOGLE_OAUTH_CLIENT_ID')
  const SHEETS_SPREADSHEET_ID = pick('SHEETS_SPREADSHEET_ID')
  const ADMIN_ALLOWED_EMAILS = pick('ADMIN_ALLOWED_EMAILS')
  const GITHUB_CLIENT_ID = pick('SITE_GITHUB_CLIENT_ID') || pick('GH_CMS_CLIENT_ID') || pick('GH_CLIENT_ID') || pick('GITHUB_CLIENT_ID')
  const GITHUB_REPO = pick('SITE_GITHUB_REPO') || pick('GH_CMS_REPO') || pick('GH_REPO') || pick('GITHUB_REPO') || process.env.GITHUB_REPOSITORY || 'gndflooring/web-site'

  return {
    base: '/',
    plugins: [
      tailwindcss(),
      contentInjection(),
      {
        // Dev only: GitHub Pages resolves /admin → admin/index.html, but the
        // Vite dev server does not. Rewrite bare /admin to /admin/ so local
        // testing matches production.
        name: 'admin-dev-route',
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            const [p, q] = (req.url || '').split('?')
            if (p === '/admin') req.url = '/admin/' + (q ? '?' + q : '')
            next()
          })
        },
      },
    ],
    define: {
      __SHEETS_URL__: JSON.stringify(SHEETS_URL),
      __RECAPTCHA_SITE_KEY__: JSON.stringify(RECAPTCHA_SITE_KEY),
      __GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(GOOGLE_OAUTH_CLIENT_ID),
      __SHEETS_SPREADSHEET_ID__: JSON.stringify(SHEETS_SPREADSHEET_ID),
      __ADMIN_ALLOWED_EMAILS__: JSON.stringify(ADMIN_ALLOWED_EMAILS),
      __GITHUB_CLIENT_ID__: JSON.stringify(GITHUB_CLIENT_ID),
      __GITHUB_REPO__: JSON.stringify(GITHUB_REPO),
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
