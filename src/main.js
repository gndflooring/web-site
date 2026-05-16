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
   Quote form → Google Apps Script (Sheets) with reCAPTCHA v3

   __SHEETS_URL__ and __RECAPTCHA_SITE_KEY__ are inlined at build time
   by Vite (vite.config.js `define`), sourced from the github-pages
   environment variables in CI or .env locally.
----------------------------------------------------------- */
const SHEETS_URL = __SHEETS_URL__
const RECAPTCHA_SITE_KEY = __RECAPTCHA_SITE_KEY__

const form = document.getElementById('quoteForm')

if (form) {
  const submitBtn = document.getElementById('quoteSubmit')
  const statusEl = document.getElementById('quoteStatus')
  const defaultBtnText = submitBtn.textContent

  // Load reCAPTCHA v3 once, only if a site key is configured
  if (RECAPTCHA_SITE_KEY) {
    const s = document.createElement('script')
    s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(RECAPTCHA_SITE_KEY)}`
    s.async = true
    s.defer = true
    document.head.appendChild(s)
  }

  const setStatus = (msg, ok) => {
    statusEl.textContent = msg
    statusEl.classList.remove('text-emerald-600', 'text-red-600')
    if (msg) statusEl.classList.add(ok ? 'text-emerald-600' : 'text-red-600')
  }

  const setBusy = (busy) => {
    submitBtn.disabled = busy
    submitBtn.classList.toggle('opacity-60', busy)
    submitBtn.classList.toggle('pointer-events-none', busy)
    submitBtn.textContent = busy ? 'Sending…' : defaultBtnText
  }

  const getRecaptchaToken = () =>
    new Promise((resolve, reject) => {
      if (!RECAPTCHA_SITE_KEY || typeof grecaptcha === 'undefined') {
        resolve('')
        return
      }
      grecaptcha.ready(() => {
        grecaptcha
          .execute(RECAPTCHA_SITE_KEY, { action: 'submit' })
          .then(resolve)
          .catch(reject)
      })
    })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!form.reportValidity()) return

    setBusy(true)
    setStatus('')

    try {
      if (!SHEETS_URL) throw new Error('Form endpoint not configured')

      const token = await getRecaptchaToken()
      const fd = new FormData(form)
      const payload = {
        name: (fd.get('name') || '').trim(),
        phone: (fd.get('phone') || '').trim(),
        email: (fd.get('email') || '').trim(),
        service: fd.get('service') || '',
        message: (fd.get('message') || '').trim(),
        recaptchaToken: token,
        source: 'gnd-flooring.com',
        submittedAt: new Date().toISOString(),
      }

      // Google Apps Script web apps cannot return CORS headers, so we POST
      // in no-cors mode: a "simple" text/plain request still reaches the
      // script (the row is saved and the reCAPTCHA token is verified
      // server-side), but the response is opaque and unreadable. We
      // therefore optimistically confirm success. Note: server-side
      // reCAPTCHA rejections can't be surfaced to the user this way.
      await fetch(SHEETS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      })

      setStatus(
        "Thanks! Your request has been sent — we'll be in touch within one business day.",
        true
      )
      form.reset()
    } catch (err) {
      console.error('Quote form error:', err)
      setStatus(
        "We couldn't send your request. Please call (555) 123-4567 or email hello@gnd-flooring.com.",
        false
      )
    } finally {
      setBusy(false)
    }
  })
}

/* -----------------------------------------------------------
   Footer year
----------------------------------------------------------- */
const yearEl = document.getElementById('year')
if (yearEl) yearEl.textContent = new Date().getFullYear()
