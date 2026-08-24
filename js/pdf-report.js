// pdf-report.js — робота із PDF-звітом по генерації (наприклад, експорт з
// PVsyst/PVGIS чи іншої програми моделювання).
//
// Свідоме рішення: цифри для розрахунків (річна генерація, економія,
// окупність) беруться з вкладки "Моделювання" в Google Sheets — там вони
// вже пораховані й надійні. PDF-звіт використовується як картинка-
// підтвердження: конкретна сторінка (і, за потреби, лише її фрагмент)
// рендериться в зображення і вставляється в КП (сторінка "04", джерело
// файлу — Google Drive-посилання, див. js/drive.js і app.js).
//
// Використовує pdf.js (CDN, підключено в index.html).

(function () {
  // Рендерить одну вже завантажену (pdf.js) сторінку документа в
  // dataURL-картинку, за потреби вирізаючи лише прямокутник crop
  // (частки 0..1 від розмірів відрендереної сторінки). Спільна логіка
  // для renderPdfPageToDataUrl() і renderPvsystShadingPage() нижче, щоб
  // не парсити той самий PDF двічі.
  //
  // timeoutMs (опційно): РЕАЛЬНИЙ ІНЦИДЕНТ (2026-07-15) — після виправлення
  // автопошуку сторінки (renderPvsystShadingPage тепер коректно знаходить
  // сторінку 7 у файлі "314 FC Chornomorec"), генерація КП почала повністю
  // "зависати" на кнопці "Сформувати КП" без жодної помилки в консолі.
  // Причина виявилась НЕ в пошуку сторінки (він відпрацьовує за мілісекунди),
  // а в САМОМУ рендерингу цієї конкретної сторінки: вона містить складну
  // 3D-векторну діаграму (сама "Perspective view"), і pdf.js's page.render()
  // на ній зависає на десятки секунд і довше (перевірено напряму: не
  // завершився навіть за 20+ секунд, і на scale:2, і на scale:1 — розмір
  // полотна не є причиною, справа в кількості векторних операцій малювання
  // на цій сторінці). Це відома категорія проблем продуктивності pdf.js на
  // "важкому" векторному контенті, а не баг у коді цього проєкту. Щоб один
  // такий "важкий" файл більше ніколи не підвішував всю генерацію КП,
  // рендеринг PvSyst-сторінки (виклик з renderPvsystShadingPage нижче)
  // тепер обмежений таймаутом: якщо page.render() не встигає за
  // timeoutMs, рендер-таск скасовується (renderTask.cancel()) і функція
  // кидає помилку — яку app.js вже ловить у try/catch навколо всього
  // PvSyst-блоку (fail-soft: сторінка "04" просто не додається до КП,
  // решта документа формується як завжди, замість того щоб зависнути
  // назавжди). renderPdfPageToDataUrl() (старий публічний API, викликається
  // без таймауту деінде) поведінку не змінює — timeoutMs завжди undefined
  // там, де його явно не передали.
  async function renderPageFromDoc(pdf, pageNum, crop, timeoutMs) {
    const n = Math.min(Math.max(pageNum || 1, 1), pdf.numPages);
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    const renderTask = page.render({ canvasContext: ctx, viewport });
    // Скасований renderTask.promise все одно колись відхилиться сам по собі
    // (RenderingCancelledException) — без цього .catch(()=>{}) це виглядало
    // б як "Uncaught (in promise)" у консолі вже ПІСЛЯ того, як ми самі
    // кинули зрозумілу помилку про таймаут нижче. Приглушуємо саме цю,
    // окрему від основного потоку помилок, "хвостову" відмову.
    renderTask.promise.catch(() => {});
    if (timeoutMs) {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          try { renderTask.cancel(); } catch (e) { /* вже завершився/скасований — ігноруємо */ }
          reject(new Error(`Рендеринг сторінки ${n} перевищив ліміт часу (${timeoutMs} мс) — ймовірно, складна векторна графіка на цій сторінці`));
        }, timeoutMs);
      });
      try {
        await Promise.race([renderTask.promise, timeout]);
      } finally {
        clearTimeout(timer);
      }
    } else {
      await renderTask.promise;
    }
    if (!crop) return canvas.toDataURL("image/png");

    const sx = Math.round((crop.left || 0) * canvas.width);
    const sy = Math.round((crop.top || 0) * canvas.height);
    const sw = Math.round((crop.width != null ? crop.width : 1) * canvas.width);
    const sh = Math.round((crop.height != null ? crop.height : 1) * canvas.height);
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = sw;
    cropCanvas.height = sh;
    cropCanvas.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return cropCanvas.toDataURL("image/png");
  }

  // source: ArrayBuffer (напр. з Google Drive) або File (з <input type=file>).
  // pageNum: 1-based номер сторінки; якщо виходить за межі документа —
  // береться найближча існуюча сторінка (не кидає помилку).
  // crop (опційно): {top,left,width,height} у частках 0..1 від розмірів
  // відрендереної сторінки — якщо задано, повертається не вся сторінка,
  // а лише цей прямокутник (напр. щоб вирізати конкретну діаграму зі
  // звіту PVsyst, ігноруючи шапку/підпис навколо неї — див.
  // KP_CONFIG.PVSYST_CROP у config.js).
  async function renderPdfPageToDataUrl(source, pageNum, crop) {
    const buf = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    return renderPageFromDoc(pdf, pageNum, crop);
  }

  // Лишено для сумісності зі старим API (файл із <input type=file>,
  // раніше використовувалось на сторінці "Технічне рішення").
  async function renderFirstPageToDataUrl(file) {
    return renderPdfPageToDataUrl(file, 1);
  }

  // ---------- Автопошук сторінки з діаграмою затінення PVsyst ----------
  // Проблема (Анна, 2026-07-15): номер сторінки з 3D-діаграмою затінення
  // РІЗНИЙ у різних файлах PvSyst.pdf (залежить від кількості попередніх
  // розділів звіту в конкретному проєкті) — тому жорстко зашитий
  // KP_CONFIG.PVSYST_PAGE (=5) підходив лише для одного конкретного файлу.
  //
  // РЕАЛЬНИЙ ІНЦИДЕНТ (2026-07-15): перша версія цієї функції шукала підпис
  // "Near shading: perspective view" (здогадка за старим коментарем у
  // config.js, ніким не звірена з фактичним файлом) — і не знаходила його
  // взагалі, бо PVsyst V7.4.8 підписує цю сторінку інакше (див. нижче).
  // Функція тоді скочувалась до останнього резервного патерну — просто
  // "near shading" без уточнень — а це словосполучення ("Near Shadings")
  // вже трапляється РАНІШЕ в документі: і в "Table of contents" (пункт
  // "Near shading definition - Iso-shadings diagram"), і в "System
  // summary"/"General parameters" (рядок "Near Shadings / Detailed
  // electrical calculation"). Через це автопошук детерміновано, але
  // НЕПРАВИЛЬНО зупинявся на сторінці 2 замість реальної сторінки 7 —
  // виглядало як "рандомний" вибір, хоча насправді просто ловив перший-
  // ліпший зі "хибних" збігів. Анна прислала реальний файл ("314 FC
  // Chornomorec"), і фактичний текст на сторінці з діаграмою виявився:
  // заголовок розділу "Near shadings parameter" + підпис під самою
  // 3D-картинкою "Perspective of the PV-field and surrounding shading
  // scene". Це стандартний текст, який PVsyst сам генерує в звіт (не
  // редагується користувачем), тому має бути стабільним і в інших файлах.
  //
  // Патерни впорядковані від найспецифічнішого до найзагальнішого — перші
  // два — це фрагменти РЕАЛЬНО перевіреного підпису під діаграмою (майже
  // нульовий ризик хибного спрацювання в іншому місці звіту), третій —
  // заголовок розділу над діаграмою (теж перевірений, унікальний — на
  // відміну від "Near Shadings" без "parameter", яке зустрічається у
  // змісті/резюме раніше). Четвертий — м'який резерв на випадок іншої
  // версії/локалізації PVsyst, де текст може відрізнятись. Навмисно НЕ
  // лишаємо голий "near shading" як резерв — саме він і спричинив баг
  // вище.
  const PVSYST_SHADING_PATTERNS = [
    /perspective\s+of\s+the\s+pv[-\s]?field\s+and\s+surrounding\s+shading\s+scene/i, // повний підпис під діаграмою (перевірено на реальному файлі)
    /surrounding\s+shading\s+scene/i, // коротший унікальний фрагмент того ж підпису
    /near\s*shadings?\s*parameter/i, // заголовок розділу над діаграмою (перевірено, унікальний — на відміну від просто "Near Shadings")
    /perspective\s*view/i, // м'який резерв на випадок іншої версії/локалізації PVsyst з іншим текстом підпису
  ];

  // Ліміт часу на рендеринг ОДНІЄЇ сторінки PvSyst у картинку. Див. великий
  // коментар над renderPageFromDoc() — деякі сторінки (та сама 3D-діаграма
  // затінення) мають настільки важку векторну графіку, що pdf.js може
  // рендерити її десятки секунд і довше. 15с — досить, щоб не відсікати
  // звичайні "важкуваті" сторінки завчасно, і досить коротко, щоб кнопка
  // "Сформувати КП" не виглядала "завислою" для Анни, якщо трапиться ще
  // один такий файл.
  const PVSYST_RENDER_TIMEOUT_MS = 15000;

  // Повертає {dataUrl, pageNum, autoDetected}. Якщо жоден патерн не
  // знайдено на жодній сторінці — використовує fallbackPage (типово
  // KP_CONFIG.PVSYST_PAGE) і autoDetected:false, щоб виклик міг про це
  // попередити (fail-soft: сторінка все одно рендериться, просто,
  // можливо, не та — це видно і виправляється вручну, а не мовчки ламає
  // всю генерацію КП). Якщо сам рендеринг обраної сторінки перевищить
  // PVSYST_RENDER_TIMEOUT_MS — функція кидає помилку (замість того щоб
  // зависнути назавжди); викликати код (app.js) вже обгортає весь виклик у
  // try/catch і трактує це як "не критично" — сторінка "04" просто не
  // додається до КП.
  async function renderPvsystShadingPage(source, crop, fallbackPage) {
    const buf = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

    const pageTexts = new Array(pdf.numPages + 1); // 1-based, кешуємо — кожна сторінка читається лише раз
    async function textOf(p) {
      if (pageTexts[p] == null) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        pageTexts[p] = content.items.map((it) => it.str).join(" ");
      }
      return pageTexts[p];
    }

    let foundPage = null;
    for (const pattern of PVSYST_SHADING_PATTERNS) {
      for (let p = 1; p <= pdf.numPages; p++) {
        const text = await textOf(p);
        if (pattern.test(text)) { foundPage = p; break; }
      }
      if (foundPage) break;
    }

    const pageNum = foundPage || Math.min(Math.max(fallbackPage || 1, 1), pdf.numPages);
    const dataUrl = await renderPageFromDoc(pdf, pageNum, crop, PVSYST_RENDER_TIMEOUT_MS);
    return { dataUrl, pageNum, autoDetected: !!foundPage };
  }

  async function tryExtractAnnualGenerationKwh(file) {
    try {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      let text = "";
      for (let p = 1; p <= Math.min(pdf.numPages, 3); p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        text += " " + content.items.map((it) => it.str).join(" ");
      }
      // Шаблони на кшталт "164 362 кВт·год" / "164362 kWh" поруч зі словом
      // "рік"/"річн"/"year". Це м'яка евристика, не гарантія.
      const m =
        text.match(/([\d\s.,]{4,12})\s*кВт[·*]?год[^.]{0,20}(рік|річн)/i) ||
        text.match(/(рік|річн)[^.]{0,20}?([\d\s.,]{4,12})\s*кВт[·*]?год/i) ||
        text.match(/([\d,.\s]{4,12})\s*kWh\s*\/?\s*year/i);
      if (!m) return null;
      const raw = (m[1].match(/[\d.,\s]+/) ? m[1] : m[2]).replace(/[^\d]/g, "");
      const n = parseInt(raw, 10);
      return isNaN(n) ? null : n;
    } catch (e) {
      console.warn("PDF text extraction failed (non-fatal):", e);
      return null;
    }
  }

  window.KpPdfReport = {
    renderPdfPageToDataUrl,
    renderFirstPageToDataUrl,
    renderPvsystShadingPage,
    tryExtractAnnualGenerationKwh,
  };
})();
