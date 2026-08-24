// app.js — зшиває форму, парсинг Google Sheets / зображень і рендер.
(function () {
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  function setStatus(msg, isError) {
    const el = document.getElementById("status");
    el.textContent = msg || "";
    el.classList.toggle("error", !!isError);
  }

  // ===== Ручне редагування КП (запит Анни, 2026-07-27) =====
  // Кнопка "Редагувати" (#btn-edit) вмикає/вимикає режим правки: у ньому
  // КОЖНЕ текстове поле (і число, і рядок) в обох форматах — "Презентація"
  // і "Документ" — стає contenteditable, тож менеджер може вручну виправити
  // будь-який запис перед друком. Нічого НЕ перераховується (домовленість
  // з Анною 2026-07-27): правка — це чисте ручне перевизначення того, що
  // показано; якщо треба змінити і залежну суму/підсумок — їх правлять
  // окремо так само вручну. Поза режимом правки документ захищений від
  // випадкових кліків (contenteditable знімається з УСІХ полів, зокрема із
  // зашитих у розмітку kp-render.js таблиць бюджету/гарантії). PDF-експорт
  // (і html2canvas для "Презентації", і window.print() для "Документа")
  // малює живий DOM, тож ручні правки самі потрапляють у підсумковий файл;
  // режим правки автоматично вимикається на старті експорту, щоб рамки
  // підсвічування полів не потрапили в PDF.
  const EDIT_TARGET_SEL =
    "p,span,strong,em,b,i,td,th,li,h1,h2,h3,h4,h5,h6,small,figcaption,dt,dd,div,caption,a";

  // Описові блоки, які треба редагувати ЦІЛКОМ, як одне поле (запит Анни,
  // 2026-07-29): розділ "Про проєкт" (Презентація — .kp-body) і "Технічне
  // рішення" (Документ / Документ з малюнками — .doc-preamble). Це абзаци з
  // автозгенерованим описом, усередині яких є жирні вставки (<b> — моделі/
  // потужність). Через ці вкладені <b> звичайна "листкова" логіка нижче
  // пропускала абзаци (робила редагованими лише самі <b>, а не описовий
  // текст навколо). Тепер увесь такий блок стає редагованим повністю, а його
  // нащадків із загального переліку виключаємо, щоб не було вкладених
  // contenteditable. (.kp-body сторінки "Фінансові показники" теж підпадає —
  // це нешкідливо: той вступний абзац і так був редагований.)
  const RICH_EDIT_SEL = ".doc-preamble, .kp-body";

  function editableLeaves(root) {
    const richBlocks = Array.from(root.querySelectorAll(RICH_EDIT_SEL)).filter(
      (el) => el.textContent && el.textContent.trim() && !el.closest(".no-print")
    );
    const leaves = Array.from(root.querySelectorAll(EDIT_TARGET_SEL)).filter((el) => {
      // Елементи всередині "багатого" блоку (та й сам блок) — не чіпаємо тут:
      // блок редагується цілком, окремо (див. richBlocks вище).
      if (el.closest(RICH_EDIT_SEL)) return false;
      // Лише "листя" — елементи, у яких із вкладених елементів хіба що <br>
      // (перенос рядка). Так кожне окреме число/рядок редагується точково,
      // без вкладених contenteditable один в одному, але заголовки з <br>
      // (напр. .hero-title на 1-му слайді "Презентації": "... сонячна<br/>
      // електростанція<br/>30 кВт") теж стають редагованими цілком.
      if (Array.from(el.children).some((c) => c.tagName !== "BR")) return false;
      if (!el.textContent || !el.textContent.trim()) return false;
      // Ховані елементи форми всередині документа (напр. <select> вибору
      // місяця на сторінці "Фінансові показники") не чіпаємо.
      if (el.closest(".no-print")) return false;
      return true;
    });
    return leaves.concat(richBlocks);
  }

  function isEditing() {
    const d = document.getElementById("kp-doc");
    return !!(d && d.classList.contains("kp-editing"));
  }

  function setEditMode(on) {
    const doc = document.getElementById("kp-doc");
    if (!doc) return;
    doc.classList.toggle("kp-editing", !!on);
    if (on) {
      editableLeaves(doc).forEach((el) => el.setAttribute("contenteditable", "true"));
      // Порожня плашка коментаря ("Заміри") — editableLeaves пропускає
      // порожні елементи, тож вмикаємо їй правку окремо (запит Анни, 2026-08-04;
      // відновлено 2026-08-07 після того, як паста rich-edit випадково прибрала цей блок).
      doc.querySelectorAll(".doc-budget-comment").forEach((el) =>
        el.setAttribute("contenteditable", "true")
      );
    } else {
      // Знімаємо редагування з усіх полів (зокрема зашитих у розмітці).
      doc.querySelectorAll("[contenteditable]").forEach((el) =>
        el.setAttribute("contenteditable", "false")
      );
    }
    const btn = document.getElementById("btn-edit");
    if (btn) {
      btn.classList.toggle("active", !!on);
      btn.textContent = on ? "✓ Завершити редагування" : "✏ Редагувати";
    }
  }

  // "Розділи КП" (запит Анни, 2026-07-20) — 4 чекбокси на формі
  // (index.html #in-sec-*), наразі впливають ЛИШЕ на формат "Документ"
  // (kp-render.js renderDocument() читає model.sections; формат
  // "Презентація" поки не чіпаємо — домовленість "потім подивимось").
  //
  // "Розумний дефолт": якщо менеджер конкретний чекбокс жодного разу не
  // чіпав руками (немає data-touched, виставляється у wireSectionCheckboxes()
  // нижче), app.js сам знімає з нього позначку в момент генерації, коли у
  // щойно завантаженому файлі-розрахунку немає відповідних даних — напр.
  // "Фінансові показники", коли клієнту рахували лише обладнання без
  // тарифу/моделі (усі 5 полів вкладки "Моделювання" порожні). Будь-який
  // чекбокс, який менеджер сам поставив/зняв, "розумний дефолт" більше НЕ
  // чіпає при наступних генераціях у цій самій сесії форми.
  const SECTION_CHECKBOX_IDS = {
    tech: "in-sec-tech",
    finance: "in-sec-finance",
    budget: "in-sec-budget",
    warranty: "in-sec-warranty",
  };

  function wireSectionCheckboxes() {
    Object.values(SECTION_CHECKBOX_IDS).forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => { el.dataset.touched = "1"; });
    });
  }

  // Сигнал "чи є дані для цього розділу" — рахується з уже завантаженого
  // data (result of KpSheets.loadCalcFromSheet), ДО побудови m.tech
  // (buildTechSpec рахується всередині kp-render.js, тут для "tech" досить
  // грубішого сигналу — чи взагалі є хоч якась номенклатура на вкладці).
  function sectionHasData(key, data) {
    const modelData = data.model || {};
    const budget = data.budget || {};
    if (key === "tech") {
      return !!(data.pdv && data.pdv.categories && data.pdv.categories.length);
    }
    if (key === "finance") {
      return modelData.annualSavings100 != null || modelData.paybackAtTariff != null ||
        modelData.totalEffect30y != null || modelData.lcoe30Uah != null ||
        !!(modelData.monthlySavings && modelData.monthlySavings.length);
    }
    if (key === "budget") {
      return !!(budget.nettoTotal || budget.grossTotal || budget.equipmentCost);
    }
    // "warranty" — статична таблиця, не залежить від файлу-розрахунку:
    // сигналу "нема даних" тут просто не існує, тож розумний дефолт завжди
    // лишає розділ увімкненим (менеджер все одно може зняти позначку
    // вручну, якщо для конкретної угоди гарантія не потрібна).
    return true;
  }

  function resolveSections(data) {
    const sections = {};
    Object.keys(SECTION_CHECKBOX_IDS).forEach((key) => {
      const el = document.getElementById(SECTION_CHECKBOX_IDS[key]);
      if (!el) { sections[key] = true; return; }
      if (el.dataset.touched !== "1") {
        el.checked = sectionHasData(key, data);
      }
      sections[key] = el.checked;
    });
    return sections;
  }

  // ---------- Доп. сторінка: PDF → картинки (запит Анни, 2026-08-14) ----------
  // Рендеримо PDF через pdfjsLib, що вже підключено в index.html (для PVsyst).
  // Кожна сторінка PDF стає окремою картинкою (= окрема сторінка/слайд КП);
  // для мініатюри рендеримо лише 1-шу сторінку (opts.onlyFirst).
  function isPdfFile(f) {
    return !!f && (f.type === "application/pdf" || /\.pdf$/i.test(f.name || ""));
  }
  async function renderPdfPages(file, opts) {
    opts = opts || {};
    const scale = opts.scale || 2;
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const last = opts.onlyFirst ? 1 : pdf.numPages;
    const urls = [];
    for (let p = 1; p <= last; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      urls.push(canvas.toDataURL("image/jpeg", 0.9));
    }
    return urls;
  }
  // Розгортає накопичені файли доп. сторінки у плоский список картинок
  // {name,url}: зображення читаємо як data-URL, PDF рендеримо посторінково.
  // Помилка на одному файлі не валить решту (fail-soft, лише попередження).
  async function expandExtraFiles(fileList) {
    const out = [];
    for (const f of Array.from(fileList || [])) {
      try {
        if (isPdfFile(f) && window.pdfjsLib) {
          const urls = await renderPdfPages(f, { scale: 2 });
          urls.forEach((url, i) => out.push({ name: `${f.name} (стор. ${i + 1})`, url }));
        } else {
          out.push({ name: f.name, url: await KpImages.readAsDataUrl(f) });
        }
      } catch (e) {
        console.warn("Доп. сторінка: не вдалось обробити файл (пропущено):", f.name, e);
      }
    }
    return out;
  }

  async function handleGenerate() {
    const btn = document.getElementById("btn-generate");
    btn.disabled = true;
    setStatus("Обробка...");
    try {
      const sheetUrl = document.getElementById("in-sheet-url").value.trim();
      if (!sheetUrl) {
        throw new Error("Вкажіть посилання на Google Sheet з розрахунком.");
      }

      // Тип розрахунку — тумблер "ПДВ" / "C" на формі (запит Анни,
      // 2026-07-18). Внутрішньо "C" відповідає вкладці KP_CONFIG.SHEET_TAB_CASH
      // (Готівка_ФОП, без ПДВ) — але саму назву вкладки й слова
      // "готівка"/"ФОП" ніде користувачу не показуємо, навіть у повідомленнях
      // про помилку нижче.
      const modeInput = document.querySelector('input[name="in-mode"]:checked');
      const mode = modeInput ? modeInput.value : "pdv";
      // "Документ" (запит Анни, 2026-07-19) — незалежний від тумблера ПДВ/C
      // і від "Розширеного бюджету" перемикач формату виводу: "presentation"
      // (нинішні слайди, render()) або "document" (компактний портретний
      // документ, renderDocument()) — обидва читають той самий model нижче.
      // Зберігаємо обраний формат у data-атрибут #kp-doc (не просто читаємо
      // радіо-кнопку знову в handleSavePdf), щоб кнопка друку завжди
      // друкувала саме те, що ЗАРАЗ відображено, навіть якщо менеджер
      // перемкнув тумблер формату ПІСЛЯ генерації, не натиснувши "Сформувати
      // КП" повторно.
      const formatInput = document.querySelector('input[name="in-format"]:checked');
      const format = formatInput ? formatInput.value : "presentation";
      // "Розширений бюджет" (запит Анни, 2026-07-18) — незалежний чекбокс,
      // не пов'язаний з тумблером ПДВ/C вище. Якщо увімкнено, sheets.js
      // додатково читає вкладку "Кошторис_Наявність обладнання" й повертає
      // data.budgetDetail (fail-soft: null, якщо вкладка не читається/не
      // має очікуваної структури — сторінка "03" тоді сама впаде назад на
      // стандартний хардкод-список, див. kp-render.js).
      const budgetDetailOn = document.getElementById("in-budget-detail").checked;
      // "Без сонячних панелей" (запит Анни, 2026-07-22) — див. коментар
      // над полем #in-no-panels в index.html. За замовчуванням (чекбокс
      // вимкнено) hasPanels = true, тобто нинішня поведінка не міняється.
      const hasPanels = !document.getElementById("in-no-panels").checked;
      // "Заміри / Немає замірів" (запит Анни, 2026-07-27) — впливає лише на
      // пояснювальну плашку під бюджетом у форматі "Документ" (kp-render.js
      // docBudgetDisclaimer). "yes" (заміри вже зроблено) → лишається тільки
      // рядок про оплату; "no" (за замовчуванням) → повний блок із переліком
      // коригувань. Нинішню поведінку не змінює.
      const measuredInput = document.querySelector('input[name="in-measured"]:checked');
      const measured = measuredInput ? measuredInput.value === "yes" : false;

      setStatus("Читаємо Google Sheet...");
      const data = await KpSheets.loadCalcFromSheet(sheetUrl, mode, { budgetDetail: budgetDetailOn });
      const pdv = data.pdv, modelData = data.model;
      if (!pdv.categories.length) {
        const modeLabel = mode === "cash" ? "C" : "ПДВ";
        throw new Error('У вкладці варіанту "' + modeLabel + '" не знайдено жодного рядка з даними. Перевір файл-розрахунок.');
      }

      // "Розділи КП" — розв'язуємо фінальний стан 4 чекбоксів (з урахуванням
      // "розумного дефолту" для нечіпаних вручну) ЗАРАЗ, одразу після
      // завантаження даних, — щоб і сам чекбокс на екрані показав те, що
      // реально піде в документ, а не лишався розсинхронізованим.
      const sections = resolveSections(data);

      // Зображення розкладки/візуалізації
      const imgFiles = document.getElementById("in-images").files;
      const images = await KpImages.readAll(imgFiles);

      // "Додаткова сторінка" (запит Анни, 2026-08-14) — довільні скріншоти/
      // зображення для окремої сторінки в кінці КП (перед контактами
      // менеджера, у всіх трьох форматах). Показуються ЛИШЕ якщо увімкнено
      // чекбокс "Додаткова сторінка" І завантажено хоч один файл.
      const extraPageOn = document.getElementById("in-extra-page").checked;
      const extraFiles = document.getElementById("in-extra-images").files;
      // expandExtraFiles: зображення → одна картинка; PDF → по картинці на
      // кожну сторінку (запит Анни, 2026-08-14).
      const extraImages = extraPageOn ? await expandExtraFiles(extraFiles) : [];

      // Звіт PvSyst.pdf з Google Drive (опційно) — сторінка "04" КП.
      // Якщо поле порожнє або файл не вдалось завантажити/відрендерити,
      // сторінка просто не додається до документа (не критична помилка,
      // решта КП формується як завжди).
      //
      // Сторінка з діаграмою "Near shading: perspective view" шукається
      // АВТОМАТИЧНО за текстовим шаром PDF (renderPvsystShadingPage,
      // js/pdf-report.js) — номер цієї сторінки різний у різних файлах
      // PVsyst, тому більше не покладаємось лише на фіксований
      // KP_CONFIG.PVSYST_PAGE. Той конфіг лишається як РЕЗЕРВНИЙ номер на
      // випадок, якщо автопошук нічого не знайде (нетиповий звіт/інша
      // мова експорту) — про це попереджаємо в консоль, щоб було видно,
      // що варто перевірити сторінку вручну.
      let pvsystImage = null;
      const pvsystUrl = document.getElementById("in-pvsyst-url").value.trim();
      if (pvsystUrl) {
        try {
          setStatus("Завантажуємо звіт PVsyst.pdf з Google Drive...");
          const buf = await KpDrive.fetchDriveFileArrayBuffer(pvsystUrl);
          const shading = await KpPdfReport.renderPvsystShadingPage(buf, KP_CONFIG.PVSYST_CROP, KP_CONFIG.PVSYST_PAGE || 5);
          pvsystImage = shading.dataUrl;
          if (shading.autoDetected) {
            console.info(`PVsyst.pdf: сторінку з діаграмою затінення знайдено автоматично (стор. ${shading.pageNum}).`);
          } else {
            console.warn(`PVsyst.pdf: не вдалось автоматично знайти сторінку з діаграмою затінення — використано резервну сторінку ${shading.pageNum} з config.js (KP_CONFIG.PVSYST_PAGE). Перевір сторінку "04" вручну.`);
          }
        } catch (e) {
          console.warn("PVsyst.pdf: не вдалось завантажити/відрендерити (не критично):", e);
        }
      }

      // Сезонні погодинні графіки (Google Sheets, опційно) — сторінка "05"
      // КП. Той самий "необов'язково, fail-soft" підхід, що й у PvSyst.pdf
      // вище: якщо поле порожнє або файл не вдалось завантажити/розпарсити
      // (не знайдено таблиці "0H..23H" на жодній вкладці) — сторінка просто
      // не додається до документа.
      let seasonalHourly = null;
      const seasonalUrl = document.getElementById("in-seasonal-url").value.trim();
      if (seasonalUrl) {
        try {
          setStatus("Завантажуємо сезонні погодинні графіки...");
          seasonalHourly = await KpSeasonal.fetchSeasonalHourly(seasonalUrl);
        } catch (e) {
          console.warn("Сезонні графіки: не вдалось завантажити/розпарсити (не критично):", e);
        }
      }

      // Назва об'єкта (запит Анни, 2026-07-19) — тепер показується в КП
      // ЛИШЕ якщо менеджер сам вписав її в поле "Об'єкт" на формі. Раніше
      // тут був fallback на автоматичне читання комірки A1 вкладки
      // "Кошторис_Наявність обладнання" (KpSheets.getObjectNameFromSheet),
      // а якщо і там було порожньо — на плейсхолдер "[Назва об'єкта]" — обидва
      // прибрані навмисно: порожній objectName ("") тепер означає "нічого не
      // писати", а не "підстав щось замість". kp-render.js (objectLabel/
      // objectClause) сам ховає всі місця, де мала б бути назва (заголовки,
      // речення "для об'єкта «...»"), коли m.meta.object порожній.
      const objectName = document.getElementById("in-object").value.trim();

      const model = {
        meta: {
          object: objectName,
          address: document.getElementById("in-address").value.trim(),
          client: document.getElementById("in-client").value.trim(),
          kpNumber: document.getElementById("in-kpnum").value.trim(),
          validDays: Number(document.getElementById("in-validdays").value) || KP_CONFIG.DEFAULTS.validDays,
        },
        overrides: {
          vatRate: (Number(document.getElementById("in-vat").value) || 20) / 100,
          prepaymentPct: Number(document.getElementById("in-prepay").value) || KP_CONFIG.DEFAULTS.prepaymentPct,
          tariffUsdPerKwh: Number(document.getElementById("in-tariff").value) || KP_CONFIG.DEFAULTS.tariffUsdPerKwh,
          leadTimeWeeks: KP_CONFIG.DEFAULTS.leadTimeWeeks,
          warrantyMonths: KP_CONFIG.DEFAULTS.warrantyMonths,
        },
        images,
        pdv,
        model: modelData,
        budget: data.budget,
        // Ємність акумуляторної групи, кВт·год (запит Анни, 2026-07-23) —
        // фіксована комірка з файлу-розрахунку (L39 на вкладці "ПДВ" / O40
        // на вкладці "Готівка_ФОП", залежно від режиму — див. sheets.js
        // parseAccumulatorCapacityKwh). Показується на обкладинці КП
        // (kp-render.js pageCover) замість кількості акумуляторів.
        accumulatorCapacityKwh: data.accumulatorCapacityKwh,
        budgetDetail: data.budgetDetail || null,
        pvsystImage,
        seasonalHourly,
        clientMode: mode,
        sections,
        hasPanels,
        measured,
        extraImages,
      };

      const docHolder = document.getElementById("kp-doc");
      docHolder.dataset.format = format;
      if (format === "document") {
        KpRender.renderDocument(model);
      } else if (format === "document-images") {
        // "Документ з малюнками" (запит Анни, 2026-07-29) — той самий
        // портретний renderDocument, лише з фото + діаграмою в "Технічному
        // рішенні" й колонкою "Од. виміру" в бюджеті.
        KpRender.renderDocument(model, { withImages: true });
      } else {
        KpRender.render(model);
      }
      // Щойно згенерований документ — показуємо кнопку "Редагувати" і
      // приводимо його в захищений (нередагований) стан: setEditMode(false)
      // знімає contenteditable, зашитий у розмітці kp-render.js.
      const editBtn = document.getElementById("btn-edit");
      if (editBtn) editBtn.style.display = "";
      setEditMode(false);
      docHolder.scrollIntoView({ behavior: "smooth" });
      setStatus("Готово. Перевірте документ нижче, за потреби натисніть «Редагувати», далі — «Друк / зберегти як PDF».");
    } catch (err) {
      console.error(err);
      setStatus(err.message || String(err), true);
    } finally {
      btn.disabled = false;
    }
  }

  // Чекаємо, поки всі <img> усередині кореня довантажаться (важливо перед
  // html2canvas-рендером у handleSavePdf() нижче — незавантажене/недекодоване
  // зображення може вийти порожнім на знімку).
  async function waitForImages(root) {
    const imgs = Array.from(root.querySelectorAll("img"));
    await Promise.all(
      imgs.map((img) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        });
      })
    );
  }

  // Формування PDF через html2canvas + jsPDF (запит Анни, 2026-07-13,
  // після двох невдалих спроб полагодити нативний друк браузера —
  // window.print()/@media print: перша сторінка друкувалась суцільно
  // білою (position:absolute-елементи не дають .kp-page висоти, коли
  // @media print скидає min-height у auto — сторінка "схлопується" в 0),
  // а сторінка "Бюджет реалізації" (використовує display:grid для
  // колонки таблиці + колонки приміток) "перетікала" на сирітську
  // сторінку без заголовка, бо Chrome під час друку часто не вміє
  // розбивати grid-контейнери по межі сторінки — переносить їх цілком.
  // Замість того щоб ганятись за кожним новим сюрпризом @media print
  // окремо, кожна .kp-page тепер рендериться html2canvas() у картинку
  // ТОЧНО як показано на екрані (жодні правила друку не задіяні), і
  // картинки вставляються в PDF одна на сторінку через jsPDF — це
  // гарантує, що PDF завжди виглядає так само, як прев'ю на екрані,
  // незалежно від браузера користувача.
  // "Документ" (запит Анни, 2026-07-19) — друк НАТИВНИМ window.print(), а не
  // html2canvas+jsPDF: контент документа природно переливається між
  // сторінками (немає фіксованих "слайдів"), із чим браузер сам добре
  // справляється через @page doc-page + page-break-inside:avoid у
  // style.css — саме той сценарій, у якому html2canvas-скріншот кожної
  // "сторінки" окремо не має сенсу (сторінок як дискретних елементів DOM
  // тут просто немає, є один безперервний .doc-root). Див. коментар над
  // тумблером формату в index.html і план у пам'яті
  // kp_generator_document_mode_plan.
  async function handleSavePdfDocument(doc, btn) {
    btn.disabled = true;
    // Вимикаємо режим правки перед друком, щоб рамки підсвічування
    // редагованих полів не потрапили в PDF (самі ж правки лишаються — вони
    // вже в DOM).
    setEditMode(false);
    try {
      await waitForImages(doc);
      window.print();
      setStatus("Відкрито діалог друку — оберіть «Зберегти як PDF».");
    } catch (err) {
      console.error(err);
      setStatus("Не вдалось відкрити діалог друку: " + (err.message || err), true);
    } finally {
      btn.disabled = false;
    }
  }

  async function handleSavePdf() {
    const btn = document.getElementById("btn-print");
    const doc = document.getElementById("kp-doc");
    const format = doc.dataset.format || "presentation";

    if (format === "document" || format === "document-images") {
      if (!doc.querySelector(".doc-root")) {
        setStatus("Спочатку сформуйте КП.", true);
        return;
      }
      await handleSavePdfDocument(doc, btn);
      return;
    }

    const pages = doc.querySelectorAll(".kp-page");
    if (!pages.length) {
      setStatus("Спочатку сформуйте КП.", true);
      return;
    }
    btn.disabled = true;
    // Вимикаємо режим правки перед знімком (рамки полів у PDF не потрібні;
    // самі правки вже застосовані в DOM).
    setEditMode(false);
    // Ховаємо елементи, які не мають потрапити на знімок (напр. <select>
    // вибору місяця на сторінці "Фінансові показники") — раніше це робив
    // клас .no-print через @media print, але html2canvas рендерить живий
    // DOM, а не print-версію, тому ховаємо вручну на час знімку.
    const hidden = doc.querySelectorAll(".no-print");
    hidden.forEach((el) => {
      el.dataset.__prevDisplay = el.style.display;
      el.style.display = "none";
    });
    try {
      await waitForImages(doc);
      const { jsPDF } = window.jspdf;
      let pdf = null;
      for (let i = 0; i < pages.length; i++) {
        setStatus(`Формуємо PDF... сторінка ${i + 1} з ${pages.length}`);
        const canvas = await html2canvas(pages[i], {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
          logging: false,
          // Порожню плашку коментаря ("Заміри"/"Немає замірів") не тягнемо в
          // PDF Презентації: @media print тут не діє (html2canvas малює живий
          // DOM), тож ховаємо її в клоні перед знімком (запит Анни, 2026-08-14).
          onclone: (cd) => cd.querySelectorAll(".doc-budget-comment:empty").forEach((el) => { el.style.display = "none"; }),
        });
        const imgData = canvas.toDataURL("image/jpeg", 0.92);
        if (!pdf) {
          pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
        } else {
          pdf.addPage("a4", "landscape");
        }
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        pdf.addImage(imgData, "JPEG", 0, 0, pageW, pageH);
      }
      let filename = "KP.pdf";
      const metaEl = doc.querySelector(".doc-meta");
      if (metaEl) {
        const m = metaEl.textContent.match(/№\s*([^\s·]+)/);
        if (m) filename = "KP-" + m[1] + ".pdf";
      }
      pdf.save(filename);
      setStatus("PDF збережено.");
    } catch (err) {
      console.error(err);
      setStatus("Не вдалось сформувати PDF: " + (err.message || err), true);
    } finally {
      hidden.forEach((el) => {
        el.style.display = el.dataset.__prevDisplay || "";
        delete el.dataset.__prevDisplay;
      });
      btn.disabled = false;
    }
  }

  // Перетягування файлу прямо на звичайний <input type="file"> у Chrome
  // не завжди спрацьовує надійно — якщо не влучити точно у вузьке поле,
  // браузер за замовчуванням просто відкриє файл замість завантаження.
  // Тому робимо всю картку "зоною скидання": ловимо dragover/drop на
  // ній, підміняємо .files інпута через DataTransfer і самі стріляємо
  // подію "change", щоб спрацював наявний обробник перегляду.
  function wireDropzone(zoneId, inputId, onDrop) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    if (!zone || !input) return;
    ["dragenter", "dragover"].forEach((evt) =>
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add("drag");
      })
    );
    ["dragleave", "dragend"].forEach((evt) =>
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        zone.classList.remove("drag");
      })
    );
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove("drag");
      const dropped = e.dataTransfer && e.dataTransfer.files;
      if (!dropped || !dropped.length) return;
      const dt = new DataTransfer();
      Array.from(dropped).forEach((f) => dt.items.add(f));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      if (onDrop) onDrop(input.files);
    });
  }

  ready(() => {
    document.getElementById("btn-generate").addEventListener("click", handleGenerate);
    document.getElementById("btn-print").addEventListener("click", handleSavePdf);
    document.getElementById("btn-edit").addEventListener("click", () => setEditMode(!isEditing()));
    wireSectionCheckboxes();

    document.getElementById("in-images").addEventListener("change", async (e) => {
      const list = document.getElementById("img-thumbs");
      list.innerHTML = "";
      const imgs = await KpImages.readAll(e.target.files);
      imgs.forEach((im) => {
        const i = document.createElement("img");
        i.src = im.url;
        list.appendChild(i);
      });
    });

    wireDropzone("drop-images", "in-images");

    // "Додаткова сторінка" (запит Анни, 2026-08-14; НАКОПИЧЕННЯ файлів —
    // 2026-08-14): звичайний <input type=file> при КОЖНОМУ виборі ЗАМІНЮЄ
    // .files (останній файл витісняв попередній — баг, який знайшла Анна).
    // Тож ведемо власний накопичувач extraAccum і після кожного додавання
    // (через діалог або drag&drop) переписуємо input.files ним — так файли
    // додаються, а не заміщаються. Клік по мініатюрі прибирає конкретний файл.
    const extraInput = document.getElementById("in-extra-images");
    const extraList = document.getElementById("extra-thumbs");
    const extraAccum = [];
    function refreshExtra() {
      const dt = new DataTransfer();
      extraAccum.forEach((f) => dt.items.add(f));
      extraInput.files = dt.files; // тримаємо input у синхроні (звідси читає генерація)
      extraList.innerHTML = "";
      extraAccum.forEach((f, idx) => {
        const i = document.createElement("img");
        if (isPdfFile(f) && window.pdfjsLib) {
          // Мініатюра PDF — 1-ша сторінка (запит Анни, 2026-08-14). Рендер
          // асинхронний; поки триває — img порожній, потім проставляємо src.
          renderPdfPages(f, { onlyFirst: true, scale: 1 })
            .then((urls) => { if (urls[0]) i.src = urls[0]; })
            .catch(() => {});
        } else {
          i.src = URL.createObjectURL(f);
        }
        i.title = "Натисніть, щоб прибрати цей файл";
        i.style.cursor = "pointer";
        i.addEventListener("click", () => { extraAccum.splice(idx, 1); refreshExtra(); });
        extraList.appendChild(i);
      });
    }
    // Програмна зміна input.files (у refreshExtra) НЕ стріляє "change", тож
    // додаємо лише реально вибрані/перетягнуті файли — без повторного обліку.
    extraInput.addEventListener("change", (e) => {
      Array.from(e.target.files || []).forEach((f) => {
        // Дедуп: той самий файл (ім'я+розмір+дата) двічі не додаємо.
        if (!extraAccum.some((g) => g.name === f.name && g.size === f.size && g.lastModified === f.lastModified)) {
          extraAccum.push(f);
        }
      });
      refreshExtra();
    });
    wireDropzone("drop-extra", "in-extra-images");

    // Запобіжник: якщо файл випадково впустили повз обидві зони скидання,
    // не даємо браузеру замінити сторінку цим файлом.
    ["dragover", "drop"].forEach((evt) =>
      window.addEventListener(evt, (e) => {
        if (!e.target.closest || !e.target.closest(".dropzone")) e.preventDefault();
      })
    );
  });
})();
