/**
 * Google Apps Script — PPL Quiz Trainer sync backend
 *
 * Deploy:
 *   1. Otevřít script.google.com → Nový projekt
 *   2. Vložit tento kód do Code.gs
 *   3. Nastavit SHEET_ID na ID tvého Google Sheetu
 *   4. Deploy → Web app → Execute as: Me, Who has access: Anyone
 *   5. Zkopírovat URL a dát do .env.local jako GOOGLE_SCRIPT_URL
 *
 * Sheet musí mít 2 taby (listy):
 *   - "questions" (sloupce: questionId, correct, wrong, last)
 *   - "sessions" (sloupce: date, categoryId, total, correct)
 */

const SHEET_ID = "1EES0mMTvaz6Awo-L1GohhYeUhHpaAOjftqARIUrbANk";

function getSheet(name) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
}

// GET → vrátí všechna data
function doGet() {
  try {
    const questions = readQuestions();
    const sessions = readSessions();
    return ContentService.createTextOutput(
      JSON.stringify({ questions, sessions })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(
      JSON.stringify({ error: e.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// POST → zapíše data
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    if (payload.questions) writeQuestions(payload.questions);
    if (payload.sessions) writeSessions(payload.sessions);
    return ContentService.createTextOutput(
      JSON.stringify({ ok: true })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(
      JSON.stringify({ error: e.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function readQuestions() {
  const sheet = getSheet("questions");
  if (!sheet) return {};
  const rows = sheet.getDataRange().getValues();
  const questions = {};
  // Skip header row
  for (let i = 1; i < rows.length; i++) {
    const [questionId, correct, wrong, last] = rows[i];
    if (questionId) {
      questions[questionId] = {
        correct: Number(correct) || 0,
        wrong: Number(wrong) || 0,
        last: last || "",
      };
    }
  }
  return questions;
}

function readSessions() {
  const sheet = getSheet("sessions");
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  const sessions = [];
  // Skip header row
  for (let i = 1; i < rows.length; i++) {
    const [date, categoryId, total, correct] = rows[i];
    if (date) {
      let catId = categoryId;
      if (typeof catId === "number" || !isNaN(Number(catId))) {
        catId = Number(catId);
      }
      sessions.push({
        date: date,
        categoryId: catId,
        total: Number(total) || 0,
        correct: Number(correct) || 0,
      });
    }
  }
  return sessions;
}

function writeQuestions(questions) {
  const sheet = getSheet("questions");
  if (!sheet) return;
  // Clear existing data (keep header)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 4).clearContent();
  }
  // Write new data
  const entries = Object.entries(questions);
  if (entries.length === 0) return;
  const rows = entries.map(([qId, stats]) => [
    qId,
    stats.correct,
    stats.wrong,
    stats.last,
  ]);
  sheet.getRange(2, 1, rows.length, 4).setValues(rows);
}

function writeSessions(sessions) {
  const sheet = getSheet("sessions");
  if (!sheet) return;
  // Clear existing data (keep header)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 4).clearContent();
  }
  // Write new data
  if (sessions.length === 0) return;
  const rows = sessions.map((s) => [s.date, s.categoryId, s.total, s.correct]);
  sheet.getRange(2, 1, rows.length, 4).setValues(rows);
}
