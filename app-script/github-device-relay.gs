/**
 * G&D Flooring — GitHub Device-Flow relay (JSONP)
 * =================================================
 * Add this doGet to your EXISTING Apps Script project (the one that already
 * has the contact-form doPost). It is a STATELESS passthrough so the static
 * admin can complete GitHub's OAuth Device Flow, which is otherwise blocked
 * for browsers (no CORS on GitHub's device/token endpoints).
 *
 * - Stores NO secret and NO token. Device Flow needs no client secret.
 * - Returns JSONP (Content-Type: application/javascript) so the browser can
 *   read it via a <script> tag (CORS does not apply to <script> loads).
 *
 * If your project already has a doGet (e.g. a health check), merge the
 * `if (action === ...)` branches into it instead of adding a second doGet.
 *
 * Endpoints (all GET, JSONP via &callback=):
 *   ?gh=device_code&callback=cb
 *       -> proxies POST https://github.com/login/device/code
 *          body: client_id, scope=repo
 *   ?gh=poll&device_code=XXX&callback=cb
 *       -> proxies POST https://github.com/login/oauth/access_token
 *          body: client_id, device_code, grant_type=device_code
 *
 * The GitHub OAuth App client_id is PUBLIC and passed by the browser; it is
 * not a secret. Nothing here needs Script Properties.
 */

/**
 * Guards, and why they are not a CAPTCHA.
 *
 * There is nothing here to steal: no secret, no token, no data, and the two
 * GitHub endpoints behind it are public and unauthenticated. What a CAPTCHA
 * would defend is the Apps Script quota this deployment shares with the
 * contact form — and it would defend it badly, because the poll runs every
 * five seconds for up to fifteen minutes, so each authorisation would need
 * ~180 single-use reCAPTCHA tokens and ~180 extra UrlFetch calls to verify
 * them. That spends more of the quota than the abuse it prevents.
 *
 * These two cost nothing per request and address the actual risk:
 *   1. the relay only ever speaks for our own OAuth app, so it cannot be
 *      borrowed as a free proxy for someone else's device flow;
 *   2. a global ceiling per minute, so a burst cannot starve the form.
 * Set GITHUB_CLIENT_ID in Script Properties to arm the first one.
 */
var RELAY_MAX_PER_MIN = 150

function relayWithinBudget_() {
  try {
    var cache = CacheService.getScriptCache()
    var key = 'ghrelay-' + Math.floor(Date.now() / 60000)
    var n = Number(cache.get(key) || 0) + 1
    cache.put(key, String(n), 120)
    return n <= RELAY_MAX_PER_MIN
  } catch (err) {
    return true // never let the limiter itself break a legitimate sign-in
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {}
  var cb = p.callback
  var gh = p.gh

  if (gh !== 'device_code' && gh !== 'poll') {
    return jsonp_(cb, { ok: true, service: 'gnd github device relay' })
  }

  var expected = PropertiesService.getScriptProperties().getProperty('GITHUB_CLIENT_ID')
  if (expected && p.client_id !== expected) {
    return jsonp_(cb, { error: 'forbidden_client', error_description: 'This relay only serves its own OAuth app.' })
  }
  if (!relayWithinBudget_()) {
    // slow_down is part of the device-flow spec, so the client already knows
    // to back off rather than to give up.
    return jsonp_(cb, { error: 'slow_down', error_description: 'Relay busy — retrying shortly.' })
  }

  try {
    var url, payload
    if (gh === 'device_code') {
      url = 'https://github.com/login/device/code'
      payload = { client_id: p.client_id, scope: p.scope || 'repo' }
    } else {
      url = 'https://github.com/login/oauth/access_token'
      payload = {
        client_id: p.client_id,
        device_code: p.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }
    }
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      payload: payload,
      headers: { Accept: 'application/json' },
      muteHttpExceptions: true,
    })
    var data = JSON.parse(resp.getContentText() || '{}')
    return jsonp_(cb, data)
  } catch (err) {
    return jsonp_(cb, { error: 'relay_error', error_description: String(err) })
  }
}

function jsonp_(cb, obj) {
  var callbackName = (cb && /^[\w$.]{1,64}$/.test(cb)) ? cb : 'callback'
  return ContentService.createTextOutput(
    callbackName + '(' + JSON.stringify(obj) + ');'
  ).setMimeType(ContentService.MimeType.JAVASCRIPT)
}

/** Helper function to run in Apps Script editor to trigger OAuth authorization dialog */
function testPermissions() {
  UrlFetchApp.fetch('https://github.com/login/device/code', {
    method: 'post',
    payload: { client_id: 'test' },
    muteHttpExceptions: true,
  })
  Logger.log('Permissions verified!')
}
