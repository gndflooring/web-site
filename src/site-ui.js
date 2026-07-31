// Behaviour shared by the live site (src/main.js) and the full-page preview
// (src/preview.js). Everything here is presentation only — the quote form
// stays in main.js so a preview can never create a real lead.
import { initCarousels } from './components/carousel.js'
import { initLightbox } from './components/lightbox.js'

/** Wire a rendered page. Safe to call again after re-rendering. */
export function initSiteUi(root = document) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /* Scroll-reveal: fade + rise as elements enter the viewport */
  const revealEls = root.querySelectorAll('.reveal')
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach((el) => el.classList.add('is-in'))
  } else {
    const io = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          entry.target.classList.add('is-in')
          observer.unobserve(entry.target)
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    )
    revealEls.forEach((el) => io.observe(el))
  }

  /* Sticky header: solidify once scrolled past the hero edge */
  const header = root.querySelector('.site-header')
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
  }

  /* Mobile menu */
  const menuToggle = root.querySelector('#menuToggle')
  const mobileMenu = root.querySelector('#mobileMenu')
  if (menuToggle && mobileMenu) {
    const setMenu = (open) => {
      mobileMenu.dataset.open = String(open)
      menuToggle.setAttribute('aria-expanded', String(open))
      menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu')
    }
    menuToggle.addEventListener('click', () => setMenu(mobileMenu.dataset.open !== 'true'))
    mobileMenu.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenu(false)))
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setMenu(false)
    })
  }

  /* Active nav link, driven by which section is in view */
  const sections = root.querySelectorAll('main section[id]')
  const navLinks = root.querySelectorAll('.nav-link')
  if ('IntersectionObserver' in window && sections.length) {
    const navIo = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          navLinks.forEach((link) => link.classList.toggle('is-active', link.getAttribute('href') === `#${entry.target.id}`))
        })
      },
      { rootMargin: '-45% 0px -50% 0px' }
    )
    sections.forEach((section) => navIo.observe(section))
  }

  /* Subtle hero parallax */
  const heroBg = root.querySelector('.hero-bg')
  if (heroBg && !reduceMotion) {
    let ticking = false
    window.addEventListener(
      'scroll',
      () => {
        if (ticking) return
        ticking = true
        requestAnimationFrame(() => {
          heroBg.style.transform = `translateY(${Math.min(window.scrollY * 0.22, 160)}px) scale(1.1)`
          ticking = false
        })
      },
      { passive: true }
    )
  }

  /* Footer year */
  const yearEl = root.querySelector('#year')
  if (yearEl) yearEl.textContent = new Date().getFullYear()

  /* Carousels + the shared image viewer */
  initCarousels(root)
  initLightbox()
}
