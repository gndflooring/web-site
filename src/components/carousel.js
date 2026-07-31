// Carousel — progressive enhancement over the markup emitted by
// src/content/render.js `carousel()`. Autoplays, pauses on hover/focus, and
// hands off to the lightbox when clicked.
//
// A single global ticker drives every instance and prunes the ones whose
// element has left the DOM, so the CMS preview can re-render as often as it
// likes without leaking timers.

const AUTOPLAY_MS = 5000
const TICK_MS = 250

const instances = new Set()
let ticker = null
let paused = false // set while the lightbox is open

const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function startTicker() {
  if (ticker) return
  ticker = setInterval(() => {
    for (const c of instances) {
      if (!c.el.isConnected) {
        instances.delete(c)
        continue
      }
      if (paused || c.hold || c.count < 2 || reduceMotion()) continue
      c.elapsed += TICK_MS
      if (c.elapsed >= AUTOPLAY_MS) {
        c.elapsed = 0
        go(c, c.index + 1)
      }
    }
    if (!instances.size) {
      clearInterval(ticker)
      ticker = null
    }
  }, TICK_MS)
}

function go(c, next) {
  c.index = (next + c.count) % c.count
  c.track.style.transform = `translate3d(${-c.index * 100}%, 0, 0)`
  c.slides.forEach((s, i) => s.toggleAttribute('aria-hidden', i !== c.index))
  c.dots.forEach((d, i) => d.classList.toggle('is-active', i === c.index))
  c.elapsed = 0
}

function setup(el) {
  if (el.dataset.carouselReady === '1') return
  el.dataset.carouselReady = '1'

  const track = el.querySelector('.carousel-track')
  const slides = [...el.querySelectorAll('.carousel-slide')]
  if (!track || !slides.length) return

  const c = {
    el,
    track,
    slides,
    dots: [...el.querySelectorAll('.carousel-dot')],
    count: slides.length,
    index: 0,
    elapsed: Math.floor(Math.random() * AUTOPLAY_MS * 0.6), // stagger neighbours
    hold: false,
  }

  el.addEventListener('pointerenter', () => (c.hold = true))
  el.addEventListener('pointerleave', () => (c.hold = false))
  el.addEventListener('focusin', () => (c.hold = true))
  el.addEventListener('focusout', () => (c.hold = false))

  el.addEventListener('click', (e) => {
    const prev = e.target.closest('[data-carousel-prev]')
    const next = e.target.closest('[data-carousel-next]')
    const dot = e.target.closest('[data-carousel-go]')
    if (!prev && !next && !dot) return
    e.preventDefault()
    e.stopPropagation() // never let a control open the lightbox
    if (prev) go(c, c.index - 1)
    else if (next) go(c, c.index + 1)
    else go(c, Number(dot.dataset.carouselGo))
  })

  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      go(c, c.index - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      go(c, c.index + 1)
    }
  })

  // Horizontal swipe on touch/pen; the mouse keeps click-to-open.
  let sx = 0
  let sy = 0
  let swiping = false
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return
    sx = e.clientX
    sy = e.clientY
    swiping = true
  })
  el.addEventListener('pointerup', (e) => {
    if (!swiping) return
    swiping = false
    const dx = e.clientX - sx
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - sy)) {
      e.stopPropagation()
      go(c, c.index + (dx < 0 ? 1 : -1))
    }
  })

  instances.add(c)
  startTicker()
}

/** Wire every carousel inside `root` (safe to call repeatedly). */
export function initCarousels(root = document) {
  if (!root) return
  const scope = root.querySelectorAll ? root : document
  scope.querySelectorAll('[data-carousel]').forEach(setup)
}

/** Freeze/resume autoplay everywhere — used while the lightbox is open. */
export function pauseCarousels(v) {
  paused = !!v
}

/** Images of one carousel, in DOM order, for the lightbox. */
export function carouselImages(el) {
  return [...el.querySelectorAll('.carousel-slide img')].map((img) => ({
    src: img.currentSrc || img.src,
    alt: img.alt || '',
    caption: img.dataset.caption || '',
    blur: Number(img.dataset.blur) || 0,
  }))
}

/** Index of the slide currently shown, so the lightbox opens on it. */
export function carouselIndex(el) {
  const slides = [...el.querySelectorAll('.carousel-slide')]
  const i = slides.findIndex((s) => !s.hasAttribute('aria-hidden'))
  return i < 0 ? 0 : i
}
