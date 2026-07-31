/**
 * G&D Flooring — Contact Form Submission Handler (doPost)
 * =======================================================
 * Appends public quote form submissions into the Google Sheet.
 */

function getTargetSpreadsheet_() {
  // 1. Container-bound active spreadsheet
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  if (ss) return ss

  // 2. Script Property configured in Apps Script Project Settings
  try {
    var propId = PropertiesService.getScriptProperties().getProperty('SHEETS_SPREADSHEET_ID')
    if (propId) return SpreadsheetApp.openById(propId)
  } catch (e) {}

  // 3. Injected SPREADSHEET_ID_INJECTED (from .env during clasp deployment) or fallback
  var injectedId = typeof SPREADSHEET_ID_INJECTED !== 'undefined' ? SPREADSHEET_ID_INJECTED : '18qjPt3IIn_Wtpj25OwNbV4atd3jgHjy7eVprU6rous8'
  if (injectedId) return SpreadsheetApp.openById(injectedId)

  throw new Error('Spreadsheet ID not configured.')
}

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '{}'
    var data = {}
    try {
      data = JSON.parse(raw)
    } catch (parseErr) {
      data = (e && e.parameter) || {}
    }

    var ss = getTargetSpreadsheet_()
    var sheet = ss.getSheetByName('FormResponses') || ss.getSheetByName('Leads') || ss.getSheets()[0]

    var timestamp = data.submittedAt || new Date().toISOString()
    var name = data.name || ''
    var phone = data.phone || ''
    var email = data.email || ''
    var service = data.service || ''
    var message = data.message || ''
    var source = data.source || 'gnd-flooring.com'

    sheet.appendRow([
      timestamp,
      name,
      phone,
      email,
      service,
      message,
      source,
      'New'
    ])

    return ContentService.createTextOutput(JSON.stringify({ ok: true, status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON)
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON)
  }
}
