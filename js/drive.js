// drive.js — завантаження файлу з Google Drive через Drive API v3
// публічним API-ключем (без OAuth), за тим самим принципом, що й
// sheets.js (Sheets API). Працює лише якщо файл на Drive відкритий
// "за посиланням" (Anyone with the link can view) — так само, як Google
// Sheets у цьому проєкті. Ключ (js/config.js, GOOGLE_API_KEY) має мати
// увімкнений Google Drive API в списку дозволених API (Cloud Console →
// Credentials → API restrictions).

(function () {
  // Приймає посилання на Drive у будь-якому з типових форматів:
  //   https://drive.google.com/file/d/FILE_ID/view?usp=sharing
  //   https://drive.google.com/open?id=FILE_ID
  //   https://docs.google.com/.../d/FILE_ID/edit
  // або вже готовий FILE_ID.
  function extractDriveFileId(urlOrId) {
    const s = String(urlOrId || "").trim();
    let m = s.match(/\/d\/([a-zA-Z0-9_-]{15,})/);
    if (m) return m[1];
    m = s.match(/[?&]id=([a-zA-Z0-9_-]{15,})/);
    if (m) return m[1];
    return s;
  }

  async function fetchDriveFileArrayBuffer(urlOrId) {
    const id = extractDriveFileId(urlOrId);
    if (!id) throw new Error("Не вдалось розпізнати ID файлу в посиланні на Google Drive.");
    const key = window.KP_CONFIG.GOOGLE_API_KEY;
    const url = `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${key}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Не вдалось завантажити файл з Google Drive (HTTP ${res.status}). ` +
        `Перевір: 1) файл відкритий "за посиланням", 2) посилання правильне, ` +
        `3) у ключі GOOGLE_API_KEY (js/config.js) увімкнено Google Drive API. ${body.slice(0, 200)}`
      );
    }
    return res.arrayBuffer();
  }

  window.KpDrive = { extractDriveFileId, fetchDriveFileArrayBuffer };
})();
