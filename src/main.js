import './style.css'
import { initSiteUi } from './site-ui.js'

initSiteUi()

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
