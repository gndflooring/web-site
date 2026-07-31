// Lightbox — full-screen image viewer with cursor-centred zoom, panning,
// prev/next and a contact sheet.
//
// Title and caption sit *on* the picture (top and bottom) on glassmorphic
// panels, so they are where the eye already is. Zoom is the scroll wheel or a
// double-click; there are no zoom buttons.
//
// Independent of the carousel: `openLightbox()` takes a plain image list, and
// `initLightbox()` only adds the delegated click that opens it from carousel
// markup. Both the public site and the CMS preview use this one instance.

import { parseMd } from '../content/render.js'
import { carouselImages, carouselIndex, pauseCarousels } from './carousel.js'

const MIN_SCALE = 1
const MAX_SCALE = 6

const state = {
  images: [],
  index: 0,
  scale: 1,
  x: 0,
  y: 0,
  dragging: false,
  startX: 0,
  startY: 0,
  root: null,
}

const icon = {
  prev: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  reset: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
}

function build() {
  if (state.root) return state.root
  const root = document.createElement('div')
  root.className = 'lb'
  root.setAttribute('hidden', '')
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.innerHTML = `
    <div class="lb-backdrop" data-lb-close></div>
    <div class="lb-stage" data-lb-stage>
      <img class="lb-image" alt="" draggable="false" />
      <div class="lb-overlay">
        <div class="lb-title"><span class="lb-title-text"></span><span class="lb-counter"></span></div>
        <figcaption class="lb-caption"></figcaption>
      </div>
    </div>
    <button class="lb-btn lb-btn--reset" type="button" data-lb-reset aria-label="Reset zoom">${icon.reset}</button>
    <button class="lb-btn lb-btn--close" type="button" data-lb-close aria-label="Close viewer">${icon.close}</button>
    <button class="lb-arrow lb-arrow--prev" type="button" data-lb-step="-1" aria-label="Previous image">${icon.prev}</button>
    <button class="lb-arrow lb-arrow--next" type="button" data-lb-step="1" aria-label="Next image">${icon.next}</button>
    <div class="lb-sheet"></div>`
  document.body.appendChild(root)
  state.root = root
  wire(root)
  return root
}

const $ = (sel) => state.root.querySelector(sel)

function applyTransform() {
  const img = $('.lb-image')
  img.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale})`
  state.root.classList.toggle('is-zoomed', state.scale > 1)
}

function resetView() {
  state.scale = 1
  state.x = 0
  state.y = 0
  applyTransform()
}

// Keeps the point under the cursor pinned while the scale changes:
// p' = d - k(d - p), where d is the cursor offset from the stage centre.
function zoomAt(nextScale, clientX, clientY) {
  const stage = $('.lb-stage').getBoundingClientRect()
  const target = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale))
  const k = target / state.scale
  const dx = (clientX ?? stage.left + stage.width / 2) - (stage.left + stage.width / 2)
  const dy = (clientY ?? stage.top + stage.height / 2) - (stage.top + stage.height / 2)
  state.x = dx - k * (dx - state.x)
  state.y = dy - k * (dy - state.y)
  state.scale = target
  if (state.scale === 1) {
    state.x = 0
    state.y = 0
  }
  applyTransform()
}

function paint() {
  const im = state.images[state.index]
  if (!im) return
  const img = $('.lb-image')
  img.src = im.src
  img.alt = im.alt || ''
  img.style.filter = Number(im.blur) > 0 ? `blur(${Number(im.blur)}px)` : ''

  const title = im.title || state.title || ''
  $('.lb-title-text').textContent = title
  $('.lb-counter').textContent = state.images.length > 1 ? `${state.index + 1} / ${state.images.length}` : ''
  $('.lb-title').classList.toggle('is-empty', !title && state.images.length < 2)
  $('.lb-caption').innerHTML = parseMd(im.caption, 'dark')
  $('.lb-caption').classList.toggle('is-empty', !im.caption)
  state.root.classList.toggle('has-many', state.images.length > 1)

  $('.lb-sheet').innerHTML =
    state.images.length > 1
      ? state.images
          .map(
            (s, i) =>
              `<button class="lb-thumb${i === state.index ? ' is-active' : ''}" type="button" data-lb-go="${i}" aria-label="${(s.title || 'Image') + ' ' + (i + 1)}">
                 <img src="${s.src}" alt="" loading="lazy" /></button>`
          )
          .join('')
      : ''
  const active = $('.lb-thumb.is-active')
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' })
  resetView()
}

function step(delta) {
  if (state.images.length < 2) return
  state.index = (state.index + delta + state.images.length) % state.images.length
  paint()
}

function wire(root) {
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-lb-close]')) return closeLightbox()
    if (e.target.closest('[data-lb-reset]')) return resetView()
    const stepBtn = e.target.closest('[data-lb-step]')
    if (stepBtn) return step(Number(stepBtn.dataset.lbStep))
    const goBtn = e.target.closest('[data-lb-go]')
    if (goBtn) {
      state.index = Number(goBtn.dataset.lbGo)
      return paint()
    }
  })

  const stage = root.querySelector('.lb-stage')
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      zoomAt(state.scale * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX, e.clientY)
    },
    { passive: false }
  )
  stage.addEventListener('dblclick', (e) => zoomAt(state.scale > 1 ? 1 : 2.5, e.clientX, e.clientY))
  stage.addEventListener('pointerdown', (e) => {
    if (state.scale <= 1) return
    state.dragging = true
    state.startX = e.clientX - state.x
    state.startY = e.clientY - state.y
    stage.setPointerCapture(e.pointerId)
  })
  stage.addEventListener('pointermove', (e) => {
    if (!state.dragging) return
    state.x = e.clientX - state.startX
    state.y = e.clientY - state.startY
    applyTransform()
  })
  const endDrag = () => (state.dragging = false)
  stage.addEventListener('pointerup', endDrag)
  stage.addEventListener('pointercancel', endDrag)

  document.addEventListener('keydown', (e) => {
    if (root.hasAttribute('hidden')) return
    if (e.key === 'Escape') closeLightbox()
    else if (e.key === 'ArrowLeft') step(-1)
    else if (e.key === 'ArrowRight') step(1)
    else if (e.key === '0') resetView()
  })
}

/** Open the viewer on a list of `{ src, alt, caption, blur?, title? }`. */
export function openLightbox({ title = '', images = [], index = 0 } = {}) {
  const list = images.filter((i) => i && i.src)
  if (!list.length) return
  build()
  state.images = list
  state.title = title
  state.index = Math.min(Math.max(0, index), list.length - 1)
  paint()
  state.root.removeAttribute('hidden')
  document.documentElement.classList.add('lb-open')
  pauseCarousels(true)
  $('.lb-btn--close').focus({ preventScroll: true })
}

export function closeLightbox() {
  if (!state.root) return
  state.root.setAttribute('hidden', '')
  document.documentElement.classList.remove('lb-open')
  pauseCarousels(false)
}

/**
 * Everything the clicked carousel should show. A carousel tagged with
 * data-lb-group opens the whole group — clicking one gallery project gives
 * you a strip of every project's photos, not just its own.
 */
function setFor(car) {
  const group = car.dataset.lbGroup
  const title = car.dataset.lbTitle || ''
  const own = carouselImages(car).map((im) => ({ ...im, title }))
  if (!group) return { title, images: own, index: carouselIndex(car) }

  let images = []
  let index = 0
  for (const el of document.querySelectorAll(`[data-carousel][data-lb-group="${group}"]`)) {
    const t = el.dataset.lbTitle || ''
    const imgs = carouselImages(el).map((im) => ({ ...im, title: t }))
    if (el === car) index = images.length + carouselIndex(el)
    images = images.concat(imgs)
  }
  return { title, images, index }
}

/** Delegated opener: any carousel on the page becomes a trigger. */
export function initLightbox() {
  if (initLightbox._done) return
  initLightbox._done = true
  const open = (car) => openLightbox(setFor(car))
  document.addEventListener('click', (e) => {
    const car = e.target.closest('[data-carousel]')
    if (!car) return
    e.preventDefault()
    open(car)
  })
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const car = e.target.closest?.('[data-carousel]')
    if (!car) return
    e.preventDefault()
    open(car)
  })
}
