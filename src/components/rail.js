// Horizontal card rail — behaviour for the markup `cardRow()` emits in
// src/content/render.js once there are more cards than fit a row.
//
// Scrolling itself is native (overflow + scroll-snap), so the rail works with
// no JS at all: touch, trackpad and shift-wheel already scroll it, and the
// half-visible next card says there is more. This adds the parts a mouse-only
// visitor needs — arrows, and a progress bar that shows how much is left.

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Wire every rail inside `root`. Safe to call again after a re-render. */
export function initRails(root = document) {
  root.querySelectorAll('[data-rail]').forEach(setup)
}

function setup(rail) {
  if (rail.__rail) return
  rail.__rail = true

  const track = rail.querySelector('[data-rail-track]')
  const bar = rail.querySelector('[data-rail-bar]')
  if (!track) return

  const update = () => {
    const max = track.scrollWidth - track.clientWidth
    // The classes drive the edge fades and disable the arrow you cannot use,
    // so the affordance never lies about which way there is more to see.
    rail.classList.toggle('can-prev', track.scrollLeft > 4)
    rail.classList.toggle('can-next', track.scrollLeft < max - 4)
    rail.classList.toggle('is-scrollable', max > 4)
    if (bar) bar.style.setProperty('--rail-p', max > 0 ? track.scrollLeft / max : 0)
  }

  track.addEventListener('scroll', update, { passive: true })
  // Catches a resized window, a rotated phone and a card that grows after its
  // image decodes — all of which change how much is off-screen.
  if ('ResizeObserver' in window) new ResizeObserver(update).observe(track)

  rail.querySelectorAll('[data-rail-step]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const item = track.querySelector('.rail-item')
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0
      const stride = item ? item.getBoundingClientRect().width + gap : track.clientWidth * 0.8
      track.scrollBy({ left: Number(btn.dataset.railStep) * stride, behavior: reduceMotion() ? 'auto' : 'smooth' })
    })
  )

  update()
}
