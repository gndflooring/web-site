// Rotating words — behaviour for the `<A, B, C>` markdown rule in
// src/content/render.js.
//
// The markup renders fine on its own: every option sits in the same grid cell,
// so the box is as wide as the longest option and the first one shows. This
// module makes them take turns, and narrows the box to whatever word is on
// screen so the rest of the sentence closes up around it.
//
// Nothing animates when the visitor asks for reduced motion — they keep the
// first option, which is why the first option should be the important one.

const running = new Set()
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Typewriter speeds, per character.
const ERASE_MS = 28
const TYPE_MS = 58

/** Start every rotator inside `root`. Safe to call again after a re-render. */
export function initWordCycles(root = document) {
  // The CMS repaints its preview on every keystroke: drop the timers whose
  // element is no longer on the page before adding more.
  for (const inst of running)
    if (!inst.el.isConnected) {
      clearTimeout(inst.timer)
      running.delete(inst)
    }

  root.querySelectorAll('[data-word-cycle]').forEach(start)
  if (running.size && !initWordCycles._resize) {
    // Font size is responsive, so a measured width is only true for one layout.
    initWordCycles._resize = true
    window.addEventListener('resize', () => running.forEach((i) => i.remeasure()), { passive: true })
  }
}

function start(el) {
  if (el.__wc) return
  const items = Array.from(el.querySelectorAll('.wc-item'))
  if (items.length < 2 || reduceMotion()) return

  const anim = el.dataset.anim || 'slide'
  const hold = Math.max(600, Number(el.dataset.hold) || 2600)
  const typing = anim === 'type'
  el.classList.add('is-live', `wc--${anim}`)

  let i = 0
  const inst = { el, timer: 0, remeasure: () => sizeTo(items[i]) }
  el.__wc = inst
  running.add(inst)

  // The typewriter's width follows the text it is typing (the other options are
  // display:none), so only the cross-fading styles need a measured box.
  const sizeTo = (node) => {
    if (typing) return
    const w = node.getBoundingClientRect().width
    if (w) el.style.width = `${w}px`
  }
  sizeTo(items[0])
  if (document.fonts?.ready) document.fonts.ready.then(() => inst.remeasure()).catch(() => {})

  const show = (node, on) => {
    node.classList.toggle('is-in', on)
    if (on) node.removeAttribute('aria-hidden')
    else node.setAttribute('aria-hidden', 'true')
  }

  const crossFade = (next) => {
    const cur = items[i]
    cur.classList.add('is-out')
    show(cur, false)
    setTimeout(() => cur.classList.remove('is-out'), 600)
    next.classList.remove('is-out')
    show(next, true)
    sizeTo(next)
  }

  // Erase the current word a character at a time, then type the next one. The
  // erased word gets its text back before it is hidden, so the DOM always
  // carries the full list.
  const typewriter = (next, done) => {
    const cur = items[i]
    const full = cur.textContent
    const target = next.textContent
    const erase = () => {
      if (cur.textContent.length) {
        cur.textContent = cur.textContent.slice(0, -1)
        return (inst.timer = setTimeout(erase, ERASE_MS))
      }
      cur.textContent = full
      show(cur, false)
      next.textContent = ''
      show(next, true)
      type()
    }
    const type = () => {
      if (next.textContent.length < target.length) {
        next.textContent = target.slice(0, next.textContent.length + 1)
        return (inst.timer = setTimeout(type, TYPE_MS))
      }
      done()
    }
    erase()
  }

  const tick = () => {
    inst.timer = setTimeout(() => {
      if (!el.isConnected) return running.delete(inst)
      // A background tab gets no frames; skip the turn rather than queue them up.
      if (document.hidden) return tick()
      const next = items[(i + 1) % items.length]
      const advance = () => {
        i = (i + 1) % items.length
        tick()
      }
      if (typing) typewriter(next, advance)
      else {
        crossFade(next)
        advance()
      }
    }, hold)
  }
  tick()
}
