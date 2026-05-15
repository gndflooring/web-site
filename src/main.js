import './style.css'

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* -----------------------------------------------------------
   Scroll-reveal: fade + rise elements as they enter the viewport
----------------------------------------------------------- */
const revealEls = document.querySelectorAll('.reveal')

if (reduceMotion || !('IntersectionObserver' in window)) {
  revealEls.forEach((el) => el.classList.add('is-in'))
} else {
  const io = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in')
          observer.unobserve(entry.target)
        }
      })
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
  )
  revealEls.forEach((el) => io.observe(el))
}

/* -----------------------------------------------------------
   Sticky header: solidify after scrolling past the hero edge
----------------------------------------------------------- */
const header = document.querySelector('.site-header')
const onScroll = () => {
  header.classList.toggle('is-scrolled', window.scrollY > 24)
}
onScroll()
window.addEventListener('scroll', onScroll, { passive: true })

/* -----------------------------------------------------------
   Mobile menu toggle
----------------------------------------------------------- */
const menuToggle = document.getElementById('menuToggle')
const mobileMenu = document.getElementById('mobileMenu')

const setMenu = (open) => {
  mobileMenu.dataset.open = String(open)
  menuToggle.setAttribute('aria-expanded', String(open))
  menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu')
}

menuToggle.addEventListener('click', () => {
  setMenu(mobileMenu.dataset.open !== 'true')
})

mobileMenu.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => setMenu(false))
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setMenu(false)
})

/* -----------------------------------------------------------
   Active nav link highlighting via section observation
----------------------------------------------------------- */
const sections = document.querySelectorAll('main section[id]')
const navLinks = document.querySelectorAll('.nav-link')

if ('IntersectionObserver' in window) {
  const navIo = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const id = entry.target.id
        navLinks.forEach((link) =>
          link.classList.toggle('is-active', link.getAttribute('href') === `#${id}`)
        )
      })
    },
    { rootMargin: '-45% 0px -50% 0px' }
  )
  sections.forEach((section) => navIo.observe(section))
}

/* -----------------------------------------------------------
   Subtle hero parallax (skipped when reduced motion is set)
----------------------------------------------------------- */
const heroBg = document.querySelector('.hero-bg')
if (heroBg && !reduceMotion) {
  let ticking = false
  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const offset = Math.min(window.scrollY * 0.22, 160)
        heroBg.style.transform = `translateY(${offset}px) scale(1.1)`
        ticking = false
      })
    },
    { passive: true }
  )
}

/* -----------------------------------------------------------
   Footer year
----------------------------------------------------------- */
const yearEl = document.getElementById('year')
if (yearEl) yearEl.textContent = new Date().getFullYear()
