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

function doGet(e) {
  var p = (e && e.parameter) || {}
  var cb = p.callback
  var gh = p.gh

  if (gh !== 'device_code' && gh !== 'poll') {
    return jsonp_(cb, { ok: true, service: 'gnd github device relay' })
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
