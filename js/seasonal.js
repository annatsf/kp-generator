// seasonal.js — читання файлу із сезонними погодинними графіками
// генерації (Google Sheets, публічним API-ключем, без OAuth — той самий
// підхід, що й у sheets.js/drive.js). Джерело — окремий файл-розрахунок
// (напр. вивантаження з PVsyst) з таблицею "Monthly Hourly averages for
// E_Grid [kW]" (24 колонки 0H..23H, рядки-місяці), з якого для сторінки
// "05 Порівняння погодинної генерації" беремо 4 місяці-приклади: січень,
// квітень, липень, жовтень (фіксований набір, запит Анни, 2026-07-13).
//
// На відміну від sheets.js, назва вкладки в цьому файлі НЕ фіксована в
// конфізі — різні файли-розрахунки можуть називати вкладку по-різному
// (у референсному файлі вкладка називалась "график"). Тому шукаємо
// потрібну таблицю за текстом заголовків (клітинка "0H", а через 23
// колонки — "23H"), перебираючи всі вкладки файлу по черзі, а не за
// фіксованою назвою вкладки.

(function () {
  function extractSpreadsheetId(urlOrId) {
    const m = String(urlOrId).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : String(urlOrId).trim();
  }

  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, "").trim();
  }

  function numeric(v) {
    if (v == null) return null;
    let s = String(v).replace(/[^0-9,.\-]/g, "");
    if (s === "" || s === "-") return null;
    // У цьому файлі кома — десятковий роздільник (напр. "2,8"), на
    // відміну від sheets.js (де кома — тисячний роздільник у грошових
    // сумах). Тут чисел з тисячними роздільниками не буває — генерація в
    // кВт, завжди значно менша за 1000.
    s = s.replace(",", ".");
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  async function fetchSheetTitles(spreadsheetId) {
    const key = window.KP_CONFIG.GOOGLE_API_KEY;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?key=${key}&fields=sheets.properties.title`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Не вдалось прочитати список вкладок файлу із сезонними графіками (HTTP ${res.status}). ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    return (json.sheets || []).map((s) => s.properties.title);
  }

  async function fetchSheetValues(spreadsheetId, sheetName) {
    const key = window.KP_CONFIG.GOOGLE_API_KEY;
    const range = encodeURIComponent(`'${sheetName}'!A1:AZ60`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?key=${key}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return json.values || [];
  }

  // Фіксований набір із 4 місяців-прикладів (запит Анни, 2026-07-13).
  // Регулярки перевіряють ПОЧАТОК підпису (не крапне включення), щоб
  // "жовтень" не спрацював на щось на кшталт "листопад" — розпізнають і
  // англійські (January...), і українські (Січень...) підписи, бо файли
  // з різних розрахунків можуть відрізнятись мовою.
  const MONTHS = [
    { key: "jan", label: "Січень", re: /^(jan|січ)/i },
    { key: "apr", label: "Квітень", re: /^(apr|кв[іi]т)/i },
    { key: "jul", label: "Липень", re: /^(jul|лип)/i },
    { key: "oct", label: "Жовтень", re: /^(oct|жовт)/i },
  ];

  // Шукає в масиві рядків комірку "0H" таку, що через 23 колонки далі
  // стоїть "23H" (страховка від випадкового збігу деінде в таблиці).
  // Повертає {headerRowIdx, hourColStart} або null, якщо в цій вкладці
  // такої таблиці нема.
  function findHourHeader(rows) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++) {
        if (norm(row[c]) === "0h" && norm(row[c + 23]) === "23h") {
          return { headerRowIdx: r, hourColStart: c };
        }
      }
    }
    return null;
  }

  function extractSeries(rows, headerRowIdx, hourColStart) {
    const found = {};
    for (let r = headerRowIdx + 1; r < rows.length && Object.keys(found).length < MONTHS.length; r++) {
      const row = rows[r] || [];
      // Підпис місяця — останній непорожній стовпець перед початком
      // погодинних колонок (робастно до того, скільки саме колонок
      // відведено під підпис зліва — в референсному файлі це 1 колонка,
      // але не покладаємось на це жорстко).
      let label = "";
      for (let c = Math.min(hourColStart - 1, row.length - 1); c >= 0; c--) {
        if (row[c] != null && String(row[c]).trim() !== "") { label = String(row[c]).trim(); break; }
      }
      if (!label) continue;
      const month = MONTHS.find((m) => !found[m.key] && m.re.test(label));
      if (!month) continue;
      const data = [];
      for (let i = 0; i < 24; i++) data.push(numeric(row[hourColStart + i]) || 0);
      found[month.key] = { key: month.key, label: month.label, data };
    }
    return found;
  }

  // Повертає {hours:[0..23], series:[{key,label,data[24]}, ...]} — лише ті
  // з 4 місяців, які вдалось знайти (у фіксованому порядку Січень/Квітень/
  // Липень/Жовтень) — або null, якщо жодна вкладка файлу не містить
  // очікуваної таблиці "0H..23H" з бодай одним із цих місяців.
  async function fetchSeasonalHourly(sheetUrlOrId) {
    const id = extractSpreadsheetId(sheetUrlOrId);
    const titles = await fetchSheetTitles(id);
    if (!titles.length) throw new Error("Не вдалось знайти жодної вкладки у файлі із сезонними графіками.");

    for (const title of titles) {
      const rows = await fetchSheetValues(id, title);
      const header = findHourHeader(rows);
      if (!header) continue;
      const found = extractSeries(rows, header.headerRowIdx, header.hourColStart);
      const series = MONTHS.map((m) => found[m.key]).filter(Boolean);
      if (series.length) {
        return { hours: Array.from({ length: 24 }, (_, i) => i), series };
      }
    }
    return null;
  }

  window.KpSeasonal = { fetchSeasonalHourly, extractSpreadsheetId };
})();
