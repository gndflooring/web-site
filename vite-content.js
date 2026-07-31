// Build-time content injection. Replaces the marked regions in index.html with
// HTML generated from src/content/site.json. Runs in dev (serve) too, so
// editing site.json and reloading reflects changes locally.
//
// All markup lives in src/content/render.js — the same module the /draft
// preview and the CMS preview pane render with, so the three cannot drift.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gen, sectionPresent } from './src/content/render.js'

export default function contentInjection() {
  const file = resolve(process.cwd(), 'src/content/site.json')
  const load = () => JSON.parse(readFileSync(file, 'utf8'))

  const apply = (html) => {
    const c = load()

    // %%token%% — head/meta and a couple of attributes
    html = html.replace(/%%([\w.]+)%%/g, (m, key) => (gen[key] ? gen[key](c) : m))

    // <!--CMS:name-->…<!--/CMS:name--> — replace the region body
    html = html.replace(
      /<!--CMS:([\w.]+)-->[\s\S]*?<!--\/CMS:\1-->/g,
      (m, name) => (gen[name] ? `<!--CMS:${name}-->${gen[name](c)}<!--/CMS:${name}-->` : m)
    )

    // <!--CMSIF:name-->…<!--/CMSIF:name--> — drop the whole block when that
    // section has nothing to show (empty sections leave no trace).
    html = html.replace(/[ \t]*<!--CMSIF:(\w+)-->[\s\S]*?<!--\/CMSIF:\1-->\n?/g, (m, name) =>
      sectionPresent[name] && !sectionPresent[name](c) ? '' : m
    )

    return html
  }

  return {
    name: 'gnd-content-injection',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => apply(html),
    },
    // site.json and the renderer are build inputs: reload the page when they change.
    configureServer(server) {
      const watch = [file, resolve(process.cwd(), 'src/content/render.js')]
      watch.forEach((f) => server.watcher.add(f))
      server.watcher.on('change', (f) => {
        if (watch.includes(f)) server.ws.send({ type: 'full-reload' })
      })
    },
  }
}
