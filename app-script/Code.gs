/**
 * G&D Flooring — Contact Form Submission Handler (doPost)
 * =======================================================
 * Appends public quote form submissions into the Google Sheet.
 */

function getTargetSpreadsheet_() {
  // 1. Script Property configured in Apps Script (Project Settings -> Script Properties)
  try {
    var propId = PropertiesService.getScriptProperties().getProperty('SHEETS_SPREADSHEET_ID')
    if (propId) return SpreadsheetApp.openById(propId)
  } catch (e) {
    throw new Error('Failed opening spreadsheet from Script Properties: ' + e.message)
  }

  // 2. Fallback to active container spreadsheet (if container-bound)
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  if (ss) return ss

  throw new Error('SHEETS_SPREADSHEET_ID property not configured in Script Properties.')
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
    var leadId = data.id || ('lead_' + Date.now() + '_' + Math.floor(Math.random() * 10000))

    sheet.appendRow([
      timestamp, // Col A: submittedAt
      name,      // Col B: name
      phone,     // Col C: phone
      email,     // Col D: email
      service,   // Col E: service
      message,   // Col F: message
      source,    // Col G: source
      timestamp, // Col H: timestamp
      leadId     // Col I: id
    ])

    return ContentService.createTextOutput(JSON.stringify({ ok: true, status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON)
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON)
  }
}
