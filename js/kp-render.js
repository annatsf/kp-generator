// kp-render.js — будує розмітку комерційної пропозиції (до 11 сторінок
// А4, альбомна орієнтація — сторінки "04" (PvSyst) і "05" (сезонні
// погодинні графіки) опційні й з'являються лише якщо вказано відповідне
// посилання; останні дві сторінки — "Гарантійний термін..." і контакти
// менеджера — фіксовані, без КП-номера/бейджа, завжди останні)
// з даних, зібраних у app.js (таблиця розрахунків + PDF генерації +
// зображення), і малює діаграми помісячної/погодинної генерації через
// Chart.js.

(function () {
  const fmtUsd = (n) =>
    n === null || n === undefined || isNaN(n) ? "—" : "$" + Math.round(n).toLocaleString("en-US");
  // Формат ціни за одиницю в бюджеті (запит Анни, 2026-07-30): зазвичай цілі
  // долари, як і всюди (fmtUsd). АЛЕ після рознесення доставки ціна за
  // одиницю = Вартість / Кількість може стати ДРОБОВОЮ — тоді показуємо з
  // копійками (2 знаки), щоб "Кількість × Ціна = Вартість" сходилось. Для
  // позицій, де ціна ціла (доставки немає або ділиться націло), вигляд не
  // змінюється.
  const fmtUsdCents = (n) =>
    n === null || n === undefined || isNaN(n) ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtUsdSmart = (n) =>
    n === null || n === undefined || isNaN(n) ? "—" : (Number.isInteger(Math.round(Number(n) * 100) / 100) ? fmtUsd(n) : fmtUsdCents(n));
  // Ціна округлюється до цілих, АЛЕ якщо округлення дало б $0 (дешева
  // позиція < $0.5) — показуємо з копійками, щоб не було "$0" (запит Анни
  // 2026-08-20).
  const fmtUsdRound = (n) =>
    n !== null && n !== undefined && !isNaN(n) && Number(n) !== 0 && Math.round(Number(n)) < 1 ? fmtUsdCents(n) : fmtUsd(n);
  const fmtNum = (n, d = 0) =>
    n === null || n === undefined || isNaN(n) ? "—" : Number(n).toLocaleString("uk-UA", { maximumFractionDigits: d });
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  // Назва об'єкта (напр. «Швейні виробництва») тепер показується ЛИШЕ якщо
  // її вписано вручну в поле "Об'єкт" на формі (запит Анни, 2026-07-19) —
  // раніше, коли поле лишалось порожнім, app.js підставляв назву,
  // автоматично прочитану з комірки A1 вкладки "Кошторис_Наявність
  // обладнання", а якщо і там було порожньо — плейсхолдер "[Назва об'єкта]".
  // Тепер app.js більше НІЧОГО туди не підставляє (m.meta.object лишається
  // порожнім рядком, якщо поле форми порожнє) — обидва хелпери нижче
  // повертають "", коли m.meta.object порожній, щоб жоден заголовок/речення
  // з назвою об'єкта не "ламався" на порожніх лапках «».
  function objectLabel(m) { return m.meta.object ? ` «${esc(m.meta.object)}»` : ""; }
  function objectClause(m) { return m.meta.object ? ` для об'єкта «${esc(m.meta.object)}»` : ""; }

  function pad2(n) { return String(n).padStart(2, "0"); }
  function defaultKpNumber(d) {
    return "КП-" + String(d.getFullYear()).slice(2) + pad2(d.getMonth() + 1) + pad2(d.getDate()) + "-" + pad2(d.getHours()) + pad2(d.getMinutes());
  }
  function fmtDate(d) { return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1) + "." + d.getFullYear(); }

  function pageHeader(meta, pageLabel) {
    return `
      <div class="kp-header">
        <img class="logo" src="data:image/png;base64,${ESCORE_LOGO_B64}" alt="escore" />
        <div class="doc-meta">
          <strong>КОМЕРЦІЙНА ПРОПОЗИЦІЯ</strong><br/>
          № ${esc(meta.kpNumber)} · від ${esc(meta.kpDateStr)}<br/>
          Дійсна ${esc(meta.validDays)} календарних днів
        </div>
      </div>`;
  }

  // ---------- Сторінка 1 — титульний слайд ----------
  // Взято з референсної презентації (запит Анни, 2026-07-07): фото заходу
  // на СЕС завжди фіксоване (assets/hero-bg.jpg), а не фото завантаженого
  // об'єкта. Напис під фото складається з типу станції (мережева/гібридна)
  // і потужності — тих самих даних, що вже рахує buildTechSpec, тому він
  // сам оновлюється під кожен новий файл-розрахунок.
  function pageHero(m) {
    return `
    <section class="kp-page hero-page">
      <div class="hero-bg" style="background-image:url('assets/hero-bg.jpg')"></div>
      <div class="hero-overlay"></div>
      <img class="hero-logo" src="assets/logo-white.png" alt="escore" />
      <div class="hero-title">${m.hasPanels === false ? "Джерело безперебійного<br/>живлення" : `${cap(m.tech.stationType)} сонячна<br/>електростанція`}${(m.model.capacityKwByPanels || m.tech.stationCapacityKw) ? `<br/>${fmtNum((m.model.capacityKwByPanels || m.tech.stationCapacityKw), 2)} кВт` : ""}</div>
    </section>`;
  }

  // ---------- Сторінка 2 — "Чому саме ESCORE?" ----------
  // Контент (сертифікат + асоціації) — 1:1 з референсної презентації,
  // не залежить від даних розрахунку. Перекладено з альбомної презентації
  // під наш (тепер теж альбомний) формат сторінки — сертифікат зліва,
  // пункти й сітка логотипів справа (запит Анни, 2026-07-07).
  // Оновлено 2026-07-13 (запит Анни): сітка логотипів тепер 2 колонки x
  // 3 рядки (було 3x2) — плашки виходять більшими й краще заповнюють
  // сторінку. Кожен логотип обгорнуто в .logo-tile — однакова
  // фіксована висота-рамка для всіх плашок, щоб вони виглядали
  // однакового розміру незалежно від пропорцій вихідного файлу.
  // "СУП" (Спілка Українських Підприємців) — єдина плашка, що раніше
  // була темно-синім/чорним фото з блакитними літерами (погано читалась,
  // не пасувала до решти білих плашок). Замінено на зображення з білим
  // фоном assets/logo-sup-white.jpg (запит Анни, 2026-07-14).
  function pageWhyEscore() {
    return `
    <section class="kp-page why-page">
      <div class="why-banner">Чому саме ESCORE?</div>
      <div class="why-body">
        <div class="why-cert"><img src="assets/cert.jpg" alt="Сертифікат ISO 9001"/></div>
        <div class="why-content">
          <div class="why-point"><span class="chk">✓</span> Ми маємо СЕРТИФІКАТ на систему управління якістю</div>
          <div class="why-point"><span class="chk">✓</span> Ми є членами таких асоціацій:</div>
          <div class="why-logos">
            <div class="logo-tile"><img src="assets/logo-women.jpg" alt="Жіночий енергоклуб України"/></div>
            <div class="logo-tile"><img src="assets/logo-sup-white.jpg" alt="Спілка Українських Підприємців"/></div>
            <div class="logo-tile"><img src="assets/logo-asau.jpg" alt="Асоціація сонячної енергетики України"/></div>
            <div class="logo-tile"><img src="assets/logo-tpp.jpg" alt="Торгово-Промислова палата України"/></div>
            <div class="logo-tile"><img src="assets/logo-onpu.jpg" alt="Одеська політехніка"/></div>
            <div class="logo-tile"><img src="assets/logo-employers.jpg" alt="Об'єднання організацій роботодавців Одеської області"/></div>
          </div>
        </div>
      </div>
    </section>`;
  }

  // ---------- Сторінка 3 — обкладинка (дані по проєкту) ----------
  // Клас "cover-page" (фікс переповнення при друку, 2026-07-13, див.
  // однойменний коментар у style.css): фіксує висоту сторінки на
  // --page-h і масштабує фото розташування панелей через object-fit,
  // щоб контент завжди вміщувався в одну фізичну сторінку PDF, а не
  // "перетікав" на сторінку без заголовка.
  function pageCover(m) {
    const hero = m.images[0];
    // Картки-показники (запит Анни, 2026-07-28): показуємо ЛИШЕ ті, де є
    // реальне значення — картки з "—"/0 (напр. інверторна група чи ємність
    // акумуляторів, коли їх нема у файлі) не виводимо взагалі. Кількість
    // колонок сітки = кількості карток (cols-1..4, див. style.css).
    const cards = [];
    if (m.tech.stationCapacityKw || m.tech.invertersQty) {
      cards.push(`<div class="stat-card"><div class="num">${m.tech.stationCapacityKw ? fmtNum(m.tech.stationCapacityKw, 2) : "—"} кВт</div><div class="lbl">Потужність інверторної групи, ${m.tech.invertersQty || "—"} шт</div></div>`);
    }
    if (m.hasPanels !== false && m.tech.panelsQty) {
      cards.push(`<div class="stat-card"><div class="num">${fmtNum(m.tech.panelsQty)} шт</div><div class="lbl">Сонячні панелі</div></div>`);
    }
    if (m.hasPanels !== false && m.model.capacityKw) {
      cards.push(`<div class="stat-card"><div class="num">${fmtNum(m.model.capacityKw, 2)} кВт</div><div class="lbl">Потужність масиву фотомодулів</div></div>`);
    }
    if (m.accumulatorCapacityKwh != null && !isNaN(m.accumulatorCapacityKwh) && Number(m.accumulatorCapacityKwh) !== 0) {
      cards.push(`<div class="stat-card"><div class="num">${fmtNum(m.accumulatorCapacityKwh, 2)} кВт·год</div><div class="lbl">Ємність акумуляторної групи</div></div>`);
    }
    const statCardsHtml = cards.length ? `<div class="stat-cards cols-${cards.length}">${cards.join("")}</div>` : "";
    return `
    <section class="kp-page cover-page">
      ${pageHeader(m.meta, "cover")}
      <div class="kp-eyebrow">Сонячна електростанція під ключ</div>
      <div class="kp-title">${m.hasPanels === false ? "Джерело безперебійного живлення" : `${cap(m.tech.stationType)} СЕС`}${objectLabel(m)}${(m.model.capacityKwByPanels || m.tech.stationCapacityKw) ? " — " + fmtNum((m.model.capacityKwByPanels || m.tech.stationCapacityKw), 2) + " кВт" : ""}</div>
      <div class="kp-desc">
        Тип рішення: <b>${esc(stationNameNom(m))}</b>${m.hasPanels !== false && m.tech.hasBattery ? " та акумуляторна система (автономія / резерв)" : ""} — ${m.hasPanels === false ? "автономне резервне живлення об'єкта на акумуляторах, без сонячної генерації." : "генерація власної електроенергії для потреб об'єкта зі зниженням витрат на електропостачання."}
      </div>
      <!-- Плашки "Об'єкт"/"Виконавець" (.meta-grid) прибрано повністю
           (запит Анни, 2026-07-23) — раніше тут стояли дві картки з
           назвою об'єкта й компанією-виконавцем. -->
      <!-- Підпис над фото замість підпису під фото з назвою файлу (запит
           Анни, 2026-07-07): великий заголовок "Розташування панелей на
           об'єкті" без імені файлу зображення. -->
      ${hero ? `<div class="hero-caption-title">Розташування панелей на об'єкті</div><div class="hero-img"><img src="${hero.url}"/></div>` : ""}
      <!-- "Без панелей" (запит Анни, 2026-07-22, див. #in-no-panels в
           index.html/app.js): ховає картки "Панелі" й "Потужність масиву
           фотомодулів" (обидві стосуються генерації), лишаючи тільки
           інвертор + акумулятори — тоді картки на 2 колонки (cols-2,
           той самий клас, що вже є в style.css для fin-page), а не на 4,
           щоб не лишати порожній простір у сітці. m.hasPanels typeof
           перевіряється явно на false, а не просто falsy — старі виклики
           без цього поля (якщо колись з'являться) мають лишати нинішню
           поведінку (з панелями), а не ламатись.
           Картки "Сонячні панелі" (2-га) й "Ємність акумуляторної групи"
           (4-та, запит Анни, 2026-07-23): 2-га картка тепер завжди показує
           статичний підпис "Сонячні панелі" замість назви конкретної
           моделі панелі (число — та сама кількість панелей); 4-та картка
           замінена з "кількість + модель акумулятора" на ємність
           акумуляторної групи в кВт·год — фіксована комірка з файлу-
           розрахунку (L39 на вкладці ПДВ / O40 на вкладці Готівка_ФОП,
           залежно від режиму — див. sheets.js parseAccumulatorCapacityKwh),
           а не з назви позиції в номенклатурі. -->
      ${statCardsHtml}
    </section>`;
  }

  // ---------- Сторінка 2 — про проєкт + технічні показники генерації + галерея ----------
  // Технічні показники генерації (річна генерація, генерація 1 кВт, за 30
  // років) і стовпчикова діаграма помісячної генерації навмисно живуть тут,
  // а не на сторінці "Економічна вигода" — там лишились тільки грошові
  // показники (тариф, економія, окупність, дохід, LCOE). Розділення
  // технічних і фінансових даних — свідоме рішення (запит Анни, 2026-07-07).
  //
  // Оновлено 2026-07-13 (запит Анни): (1) назва панелі показується БЕЗ
  // технічного префіксу "PV модуль"/"Фотомодуль" — він потрібен лише для
  // розпізнавання рядка як панелі в buildTechSpec (regex isPanel вище),
  // але в тексті виглядає зайвим/канцелярським; (2) одразу після інформації
  // про сонячні панелі додано аналогічний блок про інвертор (модель +
  // кількість), якого тут раніше не було зовсім (інвертор фігурував лише
  // на сторінці-обкладинці як кВт потужності, без назви моделі).
  function stripEquipPrefix(name) {
    return String(name || "").replace(/^\s*(PV\s*модул[ья]?|фотомодул[ья]?)\s*/i, "").trim();
  }

  // Прибирає провідні слова "Сонячні панелі" з НАЗВИ моделі — лише для
  // таблиці "Технічні характеристики", де перша колонка вже містить підпис
  // "Сонячні панелі", тож у другій колонці ці слова дублювались (запит
  // Анни, 2026-08-04). У "Технічному рішенні" та у джерелі (ПДВ/Готівка_ФОП)
  // назва лишається повною — там це не чіпаємо.
  function stripPanelLabel(name) {
    return String(name || "").replace(/^\s*сонячн[а-яіїєґ']*\s+панел[а-яіїєґ']*\s*/i, "").trim();
  }

  function pageAbout(m) {
    const gallery = m.images.slice(1);
    const chartId = "kp-gen-chart";
    // Опис обладнання формується з даних (панелі/інвертор/батарея), а не
    // хардкодиться, щоб при завантаженні нового файлу-розрахунку текст сам
    // оновлювався. Назва інвертора/батареї з файлу-розрахунку вже сама
    // містить слово "інвертор"/"акумуляторна батарея" (напр. "Мережевий
    // інвертор Solax X3-MGA-50KG2") — тому тут більше НЕ додаємо це слово
    // окремим текстовим лейблом попереду, щоб воно не повторювалось двічі
    // поспіль в одному реченні (запит Анни, 2026-07-14).
    const equipParts = [];
    // Назву панелей беремо як є з таблиці (вона вже містить "Сонячна панель…"),
    // БЕЗ хардкод-префікса "сонячні панелі" — інакше слова дублювались
    // (запит Анни, 2026-08-04). Так само, як інвертор/акумулятор нижче.
    const _panels = (m.tech.panels && m.tech.panels.length) ? m.tech.panels : (m.tech.panelModel ? [{ name: m.tech.panelModel, qty: m.tech.panelsQty }] : []);
    const _inverters = (m.tech.inverters && m.tech.inverters.length) ? m.tech.inverters : (m.tech.inverterModel ? [{ name: m.tech.inverterModel, qty: m.tech.invertersQty }] : []);
    const _batteries = m.tech.hasBattery ? ((m.tech.batteries && m.tech.batteries.length) ? m.tech.batteries : (m.tech.batteryModel ? [{ name: m.tech.batteryModel, qty: m.tech.batteryQty }] : [])) : [];
    _panels.forEach((p) => equipParts.push(`<b>${esc(stripEquipPrefix(p.name))}</b>${p.qty ? ` (${p.qty} шт)` : ""}`));
    _inverters.forEach((iv) => equipParts.push(`<b>${esc(iv.name)}</b>${iv.qty ? ` (${iv.qty} шт)` : ""}`));
    _batteries.forEach((b) => equipParts.push(`<b>${esc(b.name)}</b>${b.qty ? ` (${b.qty} шт)` : ""}`));
    const hasGenStats = m.model.annualGenKwh || m.model.annualGenPerKw || m.model.gen30y;
    return `
    <section class="kp-page">
      ${pageHeader(m.meta)}
      <div class="section-title"><span class="num-badge">01</span> Про проєкт</div>
      <div class="kp-body">
        <p>Пропонуємо будівництво ${esc(stationNameGen(m))}${(m.model.capacityKwByPanels || m.tech.stationCapacityKw) ? " потужністю <b>" + fmtNum((m.model.capacityKwByPanels || m.tech.stationCapacityKw), 2) + " кВт</b>" : ""}${objectClause(m)}. ${m.hasPanels === false
          ? "Рішення забезпечує безперебійне живлення критичних навантажень об'єкта від акумуляторної системи під час перебоїв електропостачання."
          : `Рішення забезпечує генерацію власної електроенергії у денні години, коли зазвичай споживання найактивніше, зі зниженням витрат на електропостачання.${m.tech.hasBattery ? " Станція комплектується акумуляторною батареєю для автономної роботи / резервного живлення." : ""}`}</p>
        ${equipParts.length ? `<p>Основне обладнання: ${equipParts.join(", ")}.</p>` : ""}
        <p>Повний цикл робіт «під ключ»: проєктування, постачання обладнання, монтаж, підключення, пусконалагодження та запуск.</p>
      </div>
      ${hasGenStats ? `
      <div class="stat-cards">
        <div class="stat-card"><div class="num">${m.model.annualGenKwh ? fmtNum(m.model.annualGenKwh) : "—"}</div><div class="lbl">Річна генерація, кВт·год</div></div>
        <div class="stat-card"><div class="num">${m.model.annualGenPerKw ? fmtNum(m.model.annualGenPerKw) : "—"}</div><div class="lbl">Річна генерація 1 кВт, кВт·год</div></div>
        <div class="stat-card"><div class="num">${m.model.gen30y ? fmtNum(m.model.gen30y) : "—"}</div><div class="lbl">Генерація за 30 років, кВт·год</div></div>
      </div>` : ""}
      <!-- "Без панелей" (2026-07-22): графік помісячної генерації ховаємо
           навіть якщо m.model.months технічно не порожній (рядки в файлі
           можуть бути з нульовими значеннями) — без панелей генерації
           нема, графік був би просто порожнім/пласким. -->
      ${(m.hasPanels !== false && m.model.months.length) ? `<div class="chart-wrap"><canvas id="${chartId}"></canvas></div>` : ""}
      ${gallery.length ? `<div class="gallery">${gallery.map((g, i) => `<figure><img src="${g.url}"/><figcaption>Зображення ${i + 2}${g.name ? " — " + esc(g.name) : ""}</figcaption></figure>`).join("")}</div>` : ""}
    </section>`;
  }

  // ---------- Сторінка 02 — фінансові показники ----------
  // Повністю перероблена сторінка (запит Анни, 2026-07-08): була "Технічне
  // рішення" (список обладнання), стала "Фінансові показники" — 5 цифр,
  // які читаються за ФІКСОВАНИМИ адресами комірок вкладки "Моделювання
  // Фін. показників роботи СЕС" (не за текстом підпису, як решта парсера —
  // так навмисно попросила Анна, бо верхня панель показників там завжди
  // однакової розкладки): H1, J1, B53, H2, і місячна економія A7:A18/D7:D18
  // (див. sheets.js parseModelSheet). Перемикач місяця — реальний <select>,
  // прихований на друку класом .no-print, значення підмінюється на клієнті
  // без повторного звернення до Google Sheets (див. wireFinMonthSelect()
  // нижче, викликається з render()).
  // Оновлено 2026-07-13 (запит Анни, "розподілити зміст на весь лист"):
  // додано клас "fin-page" (той самий фіксовано-висотний flex-стовпець,
  // що й у інших "особливих" сторінок) + внутрішня обгортка ".fin-content"
  // з flex:1 і justify-content:space-between, щоб блоки (текст-вступ,
  // benefit-strip, картка місячної економії, 2 фінансові картки)
  // рівномірно розтягувались на всю висоту сторінки, а не тулились угорі
  // з порожнечею знизу.
  const UK_MONTHS = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
    "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];

  function pageTech(m) {
    const monthly = m.model.monthlySavings || [];
    const nowMonthName = UK_MONTHS[new Date().getMonth()];
    let defaultIdx = monthly.findIndex((x) => x.month === nowMonthName);
    if (defaultIdx < 0) defaultIdx = 0;
    const year = new Date().getFullYear();
    const defaultItem = monthly[defaultIdx];
    const optionsHtml = monthly
      .map((x, i) => `<option value="${i}"${i === defaultIdx ? " selected" : ""}>${esc(x.month)}</option>`)
      .join("");
    return `
    <section class="kp-page fin-page">
      ${pageHeader(m.meta)}
      <div class="section-title"><span class="num-badge">02</span> Фінансові показники</div>
      <div class="fin-content">
        <div class="kp-body">
          <p>Нижче — ключові фінансові показники проєкту, розраховані на основі поточного тарифу на електроенергію
          та фактичних параметрів станції. Вони дозволяють оцінити реальну економічну вигоду від впровадження СЕС
          як у короткостроковій, так і в довгостроковій перспективі.</p>
        </div>
        <div class="benefit-strip">
          <div class="benefit-box green">
            <div class="cap">Річна економія, за умови 100% споживання згенерованої е/е</div>
            <div class="big">${m.model.annualSavings100 != null ? fmtUsd(m.model.annualSavings100) : "—"}</div>
          </div>
          <div class="benefit-box dark">
            <div class="cap">Строк окупності проєкту при діючому тарифі</div>
            <div class="big">${m.model.paybackAtTariff != null ? fmtNum(m.model.paybackAtTariff, 2) + " року" : "—"}</div>
          </div>
        </div>
        <div class="fin-month-card">
          <div>
            <div class="lbl">Потенційна місячна економія, за умови 100% споживання, у
            <span id="fin-month-label">${defaultItem ? esc(defaultItem.month) : "—"}</span> ${year} р.</div>
            <div class="val" id="fin-month-value">${defaultItem && defaultItem.amount != null ? fmtUsd(defaultItem.amount) : "—"}</div>
          </div>
          ${monthly.length ? `<select id="fin-month-select" class="no-print">${optionsHtml}</select>` : ""}
        </div>
        <div class="stat-cards cols-2">
          <div class="stat-card">
            <div class="num">${m.model.totalEffect30y != null ? fmtUsd(m.model.totalEffect30y) : "—"}</div>
            <div class="lbl">Загальний економічний ефект від впровадження СЕС за 30 років експлуатації</div>
          </div>
          <div class="stat-card">
            <div class="num">${m.model.lcoe30Uah != null ? fmtNum(m.model.lcoe30Uah, 2) + " грн / 1 кВт·г" : "—"}</div>
            <div class="lbl">LCOE30 — собівартість 1 кВт·год сонячної електроенергії від СЕС, з ПДВ</div>
          </div>
        </div>
      </div>
    </section>`;
  }

  // Підміна значення картки "Потенційна місячна економія" при виборі іншого
  // місяця у випадаючому списку — дані вже завантажені (monthlySavings),
  // повторний запит до Google Sheets не потрібен.
  function wireFinMonthSelect(model) {
    const sel = document.getElementById("fin-month-select");
    const monthly = model.model.monthlySavings || [];
    if (!sel || !monthly.length) return;
    sel.addEventListener("change", () => {
      const item = monthly[Number(sel.value)];
      const labelEl = document.getElementById("fin-month-label");
      const valEl = document.getElementById("fin-month-value");
      if (!item || !labelEl || !valEl) return;
      labelEl.textContent = item.month;
      valEl.textContent = item.amount != null ? fmtUsd(item.amount) : "—";
    });
  }

  // ---------- Сторінка 4 — бюджет реалізації ----------
  // Структура — 1:1 з референсного слайду "Бюджет реалізації" (запит
  // Анни, 2026-07-13): три групи (Обладнання / Витратні матеріали /
  // Роботи), кожна зі своєю мержованою колонкою підсумку. Позиції груп
  // "Обладнання" й "Роботи" читаються ДИНАМІЧНО з номенклатурної вкладки
  // (ПДВ або варіант "C") — "Обладнання" з категорії "Основне технічне
  // обладнання та система кріплення" (findBudgetEquipItems), "Роботи" з
  // категорії "Послуги МБР, ЕМР, ПНР та інше" (findBudgetWorksItems,
  // додано 2026-07-23 — раніше "Роботи" були фіксованим переліком назв
  // зі стандартного шаблону, кількість завжди 1; тепер, як і "Обладнання",
  // рядок потрапляє в таблицю лише якщо в файлі колонка "К-сть ввести
  // значення" не порожня й більша нуля — той самий фільтр, що вже
  // застосовується до ВСІХ категорій номенклатури на рівні парсера, див.
  // sheets.js parseNomenclatureSheet, виправлення 2026-07-22). "Обладнання"
  // додатково виключає службові нотатки менеджера (див.
  // findBudgetEquipItems() нижче — ВИПРАВЛЕНО 2026-07-22, раніше тут був
  // жорсткий діапазон рядків B3:B10, який відрізав реальні позиції в
  // файлах з більш ніж 8 позиціями обладнання). "Витратні матеріали" —
  // фіксований перелік найменувань зі стандартного шаблону (кількість
  // завжди 1, не з файлу — так попросила Анна; замінюється на 3 реальні
  // підрозділи лише в режимі "Розширений бюджет", див. нижче). Підсумкові
  // суми (Вартість без ПДВ по кожній групі, Разом без ПДВ, Загальна
  // вартість з ПДВ) РАХУЮТЬСЯ з уже розібраних категорій ПДВ-вкладки
  // (sheets.js, parseBudgetCells) — НЕ за фіксованими адресами комірок
  // (той підхід ламався, коли в файлі траплялись зайві/задвоєні рядки —
  // див. докладний коментар над parseBudgetCells у sheets.js).
  const BUDGET_MATERIALS = [
    "PV кабель для підключення фотомодулів, 6мм, Німеччина",
    "Автоматика захисту змінного струму",
    "Кабельно-провідникова продукція + конектори MC4",
    "Автоматика захисту фотоелектричних модулів (постійний струм)",
    "Витратні матеріали",
  ];

  // Розпізнає "службові" рядки-нотатки менеджера в категорії "Обладнання"
  // (напр. "Доставка до нас. Не робимо націнку! Вписати суму доставок по
  // усім позиціям") — не реальна позиція обладнання, не має потрапляти в
  // таблицю бюджету. ВИПРАВЛЕНО (2026-07-22): раніше для цього був
  // жорсткий діапазон рядків B3:B10 (KP_CONFIG.BUDGET_EQUIP_ROW_RANGE) —
  // ламалось, щойно РЕАЛЬНИХ позицій обладнання в файлі було більше 8
  // (нотатка зсувалась на рядок 11+, а фіксований діапазон замість неї
  // відрізав останню справжню позицію — реальний випадок: позиція
  // "Індивідуальне кріплення" $20,000 у рядку 11 зникала з бюджету).
  // Дублює однойменну функцію в sheets.js (окремі файли, спільного
  // модуля тут немає) — тримай в синхроні, якщо міняєш одну з них.
  function isStrayEquipNote(name) {
    const n = String(name || "").toLowerCase();
    return n.includes("не робимо націнку") || n.includes("вписати суму доставок");
  }

  function findBudgetEquipItems(pdv) {
    const cat = pdv.categories.find((c) => {
      const n = c.name.toLowerCase();
      return n.includes("техн") && n.includes("облад");
    });
    if (!cat) return [];
    return cat.items.filter((it) => !isStrayEquipNote(it.name));
  }

  // Розносить приховану доставку по позиціях обладнання (див. докладний
  // коментар у buildBudgetSections). deliveryAmount визначаємо як РІЗНИЦЮ
  // між підсумком обладнання (equipmentCost, уже містить доставку) і сумою
  // видимих рядків — тобто рівно та "нестача", про яку йдеться, незалежно від
  // того, в якій колонці менеджер вписав суму доставки. Повертає НОВІ об'єкти
  // позицій (оригінальні розпарсені дані не мутуємо), з полями unitNetto /
  // lineNetto, збільшеними на однаковий коефіцієнт. Якщо доставки немає
  // (різниця ≈ 0 або менша) — повертає вихідний список без змін.
  function distributeDeliveryOverEquip(equip, equipmentCost) {
    if (!equip || !equip.length) return equip || [];
    const linesSum = equip.reduce((s, it) => s + (Number(it.lineNetto) || 0), 0);
    const delivery = (Number(equipmentCost) || 0) - linesSum;
    if (!(linesSum > 0) || !(delivery > 0.005)) return equip;
    const f = delivery / linesSum;
    // Цільові цілі долари по кожній позиції + залишок у найбільшу позицію,
    // щоб сума показаних (округлених) вартостей точно збіглась з підсумком.
    const rounded = equip.map((it) => Math.round((Number(it.lineNetto) || 0) * (1 + f)));
    const target = Math.round(Number(equipmentCost) || 0);
    let residual = target - rounded.reduce((s, v) => s + v, 0);
    if (residual !== 0 && rounded.length) {
      let maxIdx = 0;
      for (let i = 1; i < rounded.length; i++) if (rounded[i] > rounded[maxIdx]) maxIdx = i;
      rounded[maxIdx] += residual;
    }
    return equip.map((it, i) => {
      const q = Number(it.qty);
      const newLine = rounded[i];
      const newUnit = q ? newLine / q : it.unitNetto;
      return Object.assign({}, it, { lineNetto: newLine, unitNetto: newUnit });
    });
  }

  // "Роботи" — додано 2026-07-23 (запит Анни): раніше фіксований
  // хардкод-перелік (BUDGET_WORKS), тепер, як і "Обладнання" вище,
  // читається ДИНАМІЧНО з категорії "3" номенклатурної вкладки (позиційно
  // — рівно через дві категорії після "Обладнання", той самий підхід, що
  // вже застосовується в sheets.js parseBudgetCells для worksCat). Рядки
  // з порожньою/нульовою кількістю тут вже не потрапляють — цей фільтр
  // застосовується для ВСІХ категорій одразу на рівні парсера (див.
  // sheets.js parseNomenclatureSheet, виправлення 2026-07-22), тому
  // додаткової фільтрації тут не потрібно.
  function findBudgetWorksItems(pdv) {
    const equipIdx = pdv.categories.findIndex((c) => {
      const n = c.name.toLowerCase();
      return n.includes("техн") && n.includes("облад");
    });
    const cat = equipIdx >= 0 ? pdv.categories[equipIdx + 2] : null;
    return cat ? cat.items : [];
  }

  // opts.showPrice (додано 2026-07-23, ПЕРЕРОБЛЕНО 2026-07-23 того ж дня
  // після повторного звіту Анни — "білий стовпчик") — за замовчуванням true.
  // Коли підрозділ розрізає між сторінками динамічна пагінація
  // (paginateBudgetSections нижче), кожен ФРАГМЕНТ підрозділу рендериться
  // окремим викликом budgetGroupRows; showPrice:false ставиться на всіх
  // фрагментах, КРІМ першого — так сума ціни підрозділу не дублюється.
  // КРИТИЧНО: сама комірка <td class="budget-price"> (пофарбована в колір
  // групи) рендериться ЗАВЖДИ на першому рядку будь-якого фрагмента,
  // незалежно від showPrice — лише її ВМІСТ (число) залежить від showPrice.
  // Раніше (перша версія фіксу) комірку взагалі не рендерили, коли
  // showPrice=false — а таблиця розбита на кілька <table> по сторінках, тож
  // rowspan не може "дотягнутись" через межу сторінки: рядок без цієї
  // комірки лишався коротшим за решту (3 <td> замість 4), і бракуючий
  // простір браузер малював прозорим/білим — не кольором фону рядка. Це і
  // був "білий стовпчик" на сторінці-продовженні. Тепер комірка з кольором
  // є завжди, порожня чи з числом — тож "дірки" в колонці ціни принципово
  // неможливі, незалежно від того, скільки разів і де саме розрізано
  // підрозділ.
  // Рядок-підзаголовок блоку бюджету (горизонтальний — замінив стару
  // вертикальну мержовану комірку .budget-cat, запит Анни 2026-07-27):
  // назва блоку ліворуч (colspan 2) + ціна блоку праворуч (колонка
  // "Вартість"). Колір фону — за групою (grp-equip / grp-mat / grp-works).
  // Без rowspan — тож весь клас багів "білого стовпчика"/розірваного
  // rowspan між сторінками більше неможливий.
  function budgetHeaderRow(label, price, groupClass) {
    return `<tr class="budget-cat-row ${groupClass}">
      <td colspan="3" class="budget-cat" contenteditable="true">${esc(label)}</td>
      <td class="num budget-price"><span contenteditable="true">${price != null ? fmtUsd(price) : ""}</span></td>
    </tr>`;
  }
  // Рядок-позиція блоку: назва + кількість + (лише для "Обладнання") ціна
  // за одиницю та вартість позиції. Ціна за одиницю (unit, стовпець K
  // вкладки ПДВ — "Ціна нетто без ПДВ за одиницю з націнкою") та вартість
  // позиції (line, стовпець L — "Сума продажу нетто без ПДВ з націнкою")
  // показуються ЛИШЕ в розділі "Обладнання" (запит менеджерів, 2026-07-27);
  // в інших блоках ці комірки порожні, а сума блоку стоїть на підзаголовку.
  function budgetItemRow(name, qty, unit, line, groupClass, keepCents) {
    const _pf = keepCents ? fmtUsdSmart : fmtUsdRound;
    return `<tr class="${groupClass}">
      <td contenteditable="true">${esc(name)}</td>
      <td class="num" contenteditable="true">${qty == null ? "—" : fmtNum(qty)}</td>
      <td class="num" contenteditable="true">${unit != null ? _pf(unit) : ""}</td>
      <td class="num" contenteditable="true">${line != null ? fmtUsd(line) : ""}</td>
    </tr>`;
  }

  // "Розширений бюджет" (запит Анни, 2026-07-18, обговорено окремо перед
  // кодом — детальний план збережено в пам'яті проєкту): коли увімкнено
  // чекбокс на формі (m.budgetDetail не null — заповнюється в app.js з
  // KpSheets.loadCalcFromSheet(..., {budgetDetail:true})), група
  // "Витратні матеріали" замінюється на 3 підрозділи з РЕАЛЬНИМИ назвами
  // комплектуючих (з вкладки "Кошторис_Наявність обладнання") замість
  // хардкод-переліку BUDGET_MATERIALS. Кожен підрозділ — той самий
  // budgetGroupRows(), просто без кількості (getQty завжди null, "—") і з
  // ціною, вже підрахованою в sheets.js findBudgetDetailPrices(). Якщо
  // чекбокс вимкнено АБО вкладку Кошторис не вдалось прочитати/розпарсити
  // (m.budgetDetail лишається null, fail-soft — див. sheets.js), сторінка
  // просто повертається до старого хардкод-списку — не ламається.
  // Кількість тепер реальна (запит Анни, 2026-07-19): collectKoshtorysItems
  // у sheets.js повертає {name, qty} замість голого рядка (qty — колонка
  // "Кіл-сть" вкладки Кошторис), тому й тут беремо поле, а не завжди "—".
  function budgetDetailNames(it) { return it.name; }
  function budgetDetailQty(it) { return it.qty; }

  // Нормалізація назви для зіставлення блоку бюджету (з ПДВ) із групою
  // Кошторису — та сама філософія, що й normForMatch у sheets.js: нижній
  // регістр, згорнуті пробіли, без лапок. Назви уніфіковані в шаблоні, тож
  // збіг точний.
  function budgetNorm(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/["'`]/g, "").replace(/\s+/g, " ").trim();
  }
  // Позиції середньої категорії бюджету ("Кабельна група та витратні
  // матеріали") з вкладки ПДВ/Готівка_ФОП — КОЖНА стає окремим блоком
  // (підзаголовок + ціна з ПДВ). Категорія — рівно наступна після
  // "Основне обладнання". Службові рядки-нотатки (доставка "не робимо
  // націнку") відкидаємо.
  function findBudgetMaterialItems(pdv) {
    const equipIdx = pdv.categories.findIndex((c) => {
      const n = c.name.toLowerCase();
      return n.includes("техн") && n.includes("облад");
    });
    const cat = equipIdx >= 0 ? pdv.categories[equipIdx + 1] : null;
    if (!cat) return [];
    return cat.items.filter((it) => !isStrayEquipNote(it.name) && (it.name || "").trim());
  }
  // Пошук групи Кошторису за назвою блоку (точний збіг нормалізованих назв).
  // Якщо групи з такою назвою нема — блок покажемо лише з ціною (без переліку).
  function findKoshtorysGroup(groups, blockName) {
    if (!groups) return null;
    const key = budgetNorm(blockName);
    return groups.find((g) => budgetNorm(g.label) === key) || null;
  }

  // Винесено окремо (2026-07-23, разом з динамічною пагінацією нижче) —
  // потрібен і тут (справжній рендер таблиці), і в measureAvailableHeight()
  // нижче (вимірювання "скільки місця лишається під рядки" на порожній
  // таблиці з тим самим заголовком).
  function budgetTheadHtml(priceHeader, unitHeader) {
    return `<tr>
        <th>Найменування</th>
        <th class="num">Кількість</th>
        <th class="num">${unitHeader}</th>
        <th class="num">${priceHeader}</th>
      </tr>`;
  }

  function budgetTable(bodyHtml, priceHeader, unitHeader, tfootHtml) {
    return `<table class="budget-table">
      <thead>${budgetTheadHtml(priceHeader, unitHeader)}</thead>
      <tbody>${bodyHtml}</tbody>
      ${tfootHtml ? `<tfoot>${tfootHtml}</tfoot>` : ""}
    </table>`;
  }

  // opts.detail (запит Анни, 2026-07-19) — у режимі "Розширений бюджет"
  // додає 4-ту примітку праворуч від таблиці: комплектуючі підбираються з
  // конкретної вкладки Кошторис на момент розрахунку, і якщо саме цієї
  // позиції вже нема в наявності, менеджер замінює її аналогом — тому
  // список підрядку може відрізнятись від фінальної поставки. У звичайному
  // (не розширеному) режимі ця примітка не показується — там і так немає
  // детального переліку комплектуючих, який вона пояснює.
  function budgetNotesAside(opts) {
    opts = opts || {};
    return `<aside class="budget-notes">
      <div class="note"><span class="chk">✓</span><div><b>Остаточна вартість</b> проєкту затверджується після узгодження технічних рішень</div></div>
      <div class="note"><span class="chk">✓</span><div><b>Оплата</b> здійснюється в національній валюті за комерційним курсом на дату виконання платежу</div></div>
      <div class="note"><span class="chk">✓</span><div>Пропозиція дійсна протягом <b>3 днів</b></div></div>
      ${opts.detail ? `<div class="note"><span class="chk">✓</span><div>У разі відсутності позиції підбирається аналог</div></div>` : ""}
      <!-- Порожня плашка коментаря менеджера у "Презентації" (запит Анни,
           2026-08-14) — та сама, що в Документах (.doc-budget-comment). Порожня
           заповнюється в режимі "Редагувати"; порожню перед html2canvas-
           експортом ховає app.js (у Презентації @media print не діє). -->
      <div class="doc-budget-comment"></div>
    </aside>`;
  }

  // ---------- Динамічна пагінація бюджету (переписано 2026-07-23) ----------
  // РАНІШЕ (2026-07-18/19) тут було ЖОРСТКО зашито рівно 2 сторінки:
  // 1-ша — Обладнання+AC+DC (2-колоночний .budget-layout з примітками
  // праворуч), 2-га — Кабельно-провідникова продукція+Роботи+підсумки (на
  // всю ширину). Розрахунок "скільки рядків влазить" був ЛЮДСЬКОЮ ОЦІНКОЮ
  // за попереднім тестовим файлом (~15 рядків на 1-й сторінці, ~18-20 на
  // 2-й) — і на реальному робочому файлі Анни (2026-07-23) ця оцінка
  // виявилась замалою: 2-га сторінка знову не вмістила Кабельну продукцію+
  // Роботи+підсумки повністю (частина знову обрізалась/зникала, той самий
  // клас багу, що й раніше). Замість того щоб знову підбирати числа "на
  // око" під ЦЕЙ конкретний файл (і знову зламатись на наступному, довшому
  // файлі), пагінація тепер рахується ДИНАМІЧНО — реальним вимірюванням
  // висоти в живому DOM (сторінки й так рендеряться в браузері, а не лише
  // в PDF-скріншот, тож можна дозволити собі один додатковий прохід
  // "виміряти, потім намалювати"):
  //   1) measureAvailableHeight() рендерить ПОРОЖНЮ сторінку (з реальним
  //      заголовком+назвою) у прихований (visibility:hidden,
  //      position:absolute; left:-99999px) вузол поза екраном і читає
  //      clientHeight області, що відводиться під таблицю (той самий
  //      flex:1-розтягнутий контейнер, що й у справжньому рендері) —
  //      окремо для 1-ї сторінки (2-колоночний layout+примітки) і для
  //      сторінок-продовжень (на всю ширину).
  //   2) measureRowsHtml()/measureTfootHtml() рендерять КОНКРЕТНИЙ HTML
  //      рядків (ту саму розмітку, що піде у фінальний документ, з
  //      правильною шириною колонок) і читають природну (не розтягнуту)
  //      висоту таблиці — так дізнаємось, скільки саме пікселів займе
  //      будь-який набір рядків.
  //   3) paginateBudgetSections() жадібно заповнює сторінки: бере
  //      підрозділи по черзі (Обладнання → AC/DC/Кабельна+Роботи або
  //      Матеріали+Роботи), і для кожного домірує, скільки позицій
  //      влазить у залишок місця на поточній сторінці; якщо підрозділ не
  //      влазить цілком — розрізає ЙОГО (не між підрозділами, а
  //      всередині, якщо треба) і переносить лишок на нову сторінку
  //      (з новою мержованою коміркою назви підрозділу, з припискою
  //      "(продовження)" для наочності). Підсумки (totalsHtml) теж
  //      перевіряються на "чи влазять" — якщо ні, отримують окрему
  //      сторінку. Кількість сторінок-продовжень тепер НЕ обмежена
  //      двома — стільки, скільки реально потрібно під конкретний файл.
  // Загальна нумерація наступних сторінок (04 PvSyst, 05 сезонні графіки)
  // як і раніше НЕ зсувається — сторінки-продовження бюджету навмисно без
  // власного номера, як і сторінки "Гарантія"/"Менеджер" наприкінці
  // документа.
  function getMeasureHost() {
    const host = document.createElement("div");
    host.style.position = "absolute";
    host.style.left = "-99999px";
    host.style.top = "0";
    host.style.visibility = "hidden";
    host.style.pointerEvents = "none";
    document.body.appendChild(host);
    return host;
  }

  function getPageContentWidth() {
    const cs = getComputedStyle(document.documentElement);
    const pageW = parseFloat(cs.getPropertyValue("--page-w")) || 1123;
    const pagePad = parseFloat(cs.getPropertyValue("--page-pad")) || 46;
    return pageW - pagePad * 2;
  }

  // Природна (нерозтягнута) висота набору <tr> — вимірюється через
  // style="height:auto" на самій таблиці, що перекриває CSS-правило
  // ".budget-table-wrap table.budget-table{height:100%}" (inline-стиль має
  // вищий пріоритет за клас) — інакше таблиця завжди повертала б повну
  // висоту сторінки незалежно від кількості рядків.
  function measureRowsHtml(rowsHtml, wide, host) {
    const width = getPageContentWidth();
    const markup = wide
      ? `<div style="width:${width}px"><table class="budget-table" style="height:auto"><tbody>${rowsHtml}</tbody></table></div>`
      : `<div class="budget-layout" style="width:${width}px;height:auto"><table class="budget-table" style="height:auto"><tbody>${rowsHtml}</tbody></table><aside class="budget-notes"></aside></div>`;
    host.innerHTML = markup;
    return host.querySelector("table.budget-table").offsetHeight;
  }

  function measureTfootHtml(tfootHtml, wide, host) {
    const width = getPageContentWidth();
    const markup = wide
      ? `<div style="width:${width}px"><table class="budget-table" style="height:auto"><tfoot>${tfootHtml}</tfoot></table></div>`
      : `<div class="budget-layout" style="width:${width}px;height:auto"><table class="budget-table" style="height:auto"><tfoot>${tfootHtml}</tfoot></table><aside class="budget-notes"></aside></div>`;
    host.innerHTML = markup;
    return host.querySelector("table.budget-table").offsetHeight;
  }

  // Однаковий нижній відступ під таблицею бюджету на КОЖНІЙ сторінці — щоб
  // останній рядок не впирався в самий низ і не обрізався (запит Анни,
  // 2026-07-28).
  const BUDGET_PAGE_BOTTOM_GAP = 16;

  // Реальна доступна висота під таблицю на сторінці бюджету — рендеримо
  // справжню структуру сторінки (заголовок+назва+обгортка) БЕЗ height:auto
  // перекриття, щоб .budget-layout/.budget-table-wrap природно розтягнулись
  // через flex:1 (той самий механізм, що й у справжньому документі) і
  // читаємо їхню clientHeight — це і є "скільки місця під рядки лишається".
  function measureAvailableHeight(m, wide, priceHeader, unitHeader, host) {
    const headerHtml = pageHeader(m.meta);
    const titleHtml = wide
      ? `<div class="section-title">Бюджет реалізації (продовження)</div>`
      : `<div class="section-title"><span class="num-badge">03</span> Бюджет реалізації</div>`;
    const theadHtml = `<thead>${budgetTheadHtml(priceHeader, unitHeader)}</thead>`;
    const bodyHtml = wide
      ? `<div class="budget-table-wrap"><table class="budget-table">${theadHtml}<tbody></tbody></table></div>`
      : `<div class="budget-layout"><table class="budget-table">${theadHtml}<tbody></tbody></table>${budgetNotesAside({ detail: true })}</div>`;
    host.innerHTML = `<section class="kp-page budget-page">${headerHtml}${titleHtml}${bodyHtml}</section>`;
    const wrap = host.querySelector(wide ? ".budget-table-wrap" : ".budget-layout");
    // wrap.clientHeight — це ПОВНА область під таблицю (контейнер), але шапка
    // (thead) стоїть ВСЕРЕДИНІ таблиці й теж займає місце. measureRowsHtml
    // нижче міряє лише рядки <tbody> (без шапки), тож якщо не відняти висоту
    // шапки — пагінатор думає, що має на цілу шапку більше місця, і кладе
    // зайвий рядок, який вилазить за низ сторінки (overflow:hidden на
    // .budget-page обрізає його). Стало помітно після додавання 4-ї колонки:
    // заголовки "Ціна/Вартість без ПДВ, $" переносяться у 2 рядки, і шапка
    // на вузькій 1-й сторінці ~55px (запит Анни, 2026-07-28: "перший лист без
    // нижнього поля, з'їдається рядок"). Додатково лишаємо однаковий нижній
    // відступ BUDGET_PAGE_BOTTOM_GAP на КОЖНІЙ сторінці — щоб рядки не
    // впиралися в самий низ і нижнє поле було консистентним між сторінками.
    const thead = host.querySelector("table.budget-table thead");
    const theadH = thead ? thead.offsetHeight : 0;
    return wrap.clientHeight - theadH - BUDGET_PAGE_BOTTOM_GAP;
  }

  // Найбільша к-сть позицій із початку items, чий рендер (buildHtmlFn)
  // влазить у freeHeight пікселів. buildHtmlFn(subset, isFinalSubset) сам
  // вирішує, чи показувати ціну підрозділу (isFinalSubset — це справді
  // остання позиція ВСЬОГО підрозділу, а не лише цього фрагмента).
  function fitItemsToHeight(items, buildHtmlFn, freeHeight, wide, host) {
    let best = { k: 0, html: "", height: 0 };
    if (freeHeight <= 0) return best;
    for (let k = 1; k <= items.length; k++) {
      const isFinal = k === items.length;
      const html = buildHtmlFn(items.slice(0, k), isFinal);
      const height = measureRowsHtml(html, wide, host);
      if (height <= freeHeight) {
        best = { k, html, height };
      } else {
        break;
      }
    }
    return best;
  }

  // Будує блоки сторінки "Бюджет реалізації" (переписано 2026-07-27, запит
  // Анни). Структура блоків ЗАВЖДИ однакова й береться з ПДВ/Готівка_ФОП:
  //   • "Обладнання" — завжди перелік позицій (з ПДВ) + ціна блоку;
  //   • середня категорія — КОЖНА позиція ПДВ ("PV кабель для підключення
  //     фотомодулів", "Автоматика захисту змінного струму", "Автоматика
  //     захисту фотоелектричних модулів", "Кабельно-провідникова
  //     продукція", "Заземлення...", "Витратні матеріали") стає окремим
  //     блоком: підзаголовок + ЦІНА З ПДВ. У РОЗШИРЕНОМУ режимі до блоку за
  //     збігом назви підтягується перелік комплектуючих із Кошторису
  //     (m.budgetDetail.groups); якщо групи з такою назвою нема — блок
  //     лишається лише з ціною;
  //   • "Роботи" — завжди перелік позицій (з ПДВ) + ціна блоку.
  // У звичайному (не розширеному) режимі середні блоки — лише підзаголовок
  // з ціною, без переліку.
  function buildBudgetSections(m, b) {
    const equip = findBudgetEquipItems(m.pdv);
    // Рознесення доставки по позиціях обладнання (запит Анни, 2026-07-30).
    // У категорії "Основне технічне обладнання та система кріплення" є
    // службовий рядок доставки ("Доставка до нас. Не робимо націнку! Вписати
    // суму доставок по усім позиціям"), який isStrayEquipNote прибирає з
    // таблиці, АЛЕ його сума входить у підсумок обладнання (b.equipmentCost
    // з parseBudgetCells). Тому видимі рядки без доставки в сумі дають менше
    // підсумку рівно на доставку. Розподіляємо цю доставку ПРОПОРЦІЙНО
    // вартості кожної позиції обладнання: і ціна за одиницю (unitNetto), і
    // вартість позиції (lineNetto) зростають на однаковий % так, що сума
    // рядків точно дорівнює підсумку. Залишок від округлення кладемо в
    // найбільшу позицію. Доставка ніде окремим рядком не показується, підсумки
    // не змінюються. Розподіл — ЛИШЕ по обладнанню (інші групи не чіпаємо).
    const equipDistributed = distributeDeliveryOverEquip(equip, b.equipmentCost);
    const equipRows = equipDistributed.length ? equipDistributed : [{ name: "—", qty: null }];
    const works = findBudgetWorksItems(m.pdv);
    const worksRows = works.length ? works : [{ name: "—", qty: null }];
    const materials = findBudgetMaterialItems(m.pdv);
    const groups = m.budgetDetail && m.budgetDetail.groups; // null у звичайному режимі / при збої читання Кошторису

    // "Од. виміру" на рівні категорії (запит Анни, 2026-07-29) — одиниця з
    // рядка-заголовка категорії ПДВ/Готівка_ФОП (sheets.js зберіг її як
    // cat.unitMeasure). Для "Обладнання" й "Роботи" це і є одиниця, яку
    // показує колонка "Од. виміру" у форматі "Документ з малюнками". Для
    // середніх підрозділів одиниця береться пер-позиційно з Кошторису
    // (it.unit), тож matUnit — лише запасний варіант, якщо в позиції Кошторису
    // одиниці нема.
    const cats = m.pdv.categories || [];
    const equipIdx = cats.findIndex((c) => {
      const n = c.name.toLowerCase();
      return n.includes("техн") && n.includes("облад");
    });
    const catUnit = (i) => (i >= 0 && cats[i] ? (cats[i].unitMeasure || "") : "");
    const equipUnit = catUnit(equipIdx);
    const matUnit = catUnit(equipIdx >= 0 ? equipIdx + 1 : -1);
    const worksUnit = catUnit(equipIdx >= 0 ? equipIdx + 2 : -1);

    const sections = [
      // "Обладнання" — єдиний блок, де на КОЖНІЙ позиції показуємо ціну за
      // одиницю (unitFn — стовпець K ПДВ, it.unitNetto) та вартість позиції
      // (lineFn — стовпець L ПДВ, it.lineNetto) (запит менеджерів, 2026-07-27).
      { items: equipRows, nameFn: (it) => it.name, qtyFn: (it) => it.qty, unitFn: (it) => it.unitNetto, lineFn: (it) => it.lineNetto, price: null, noHeader: true, label: "Обладнання", groupClass: "grp-equip", unitMeasure: equipUnit },
    ];

    materials.forEach((it) => {
      // Плашку середнього блоку показуємо ЛИШЕ якщо в ПДВ/Готівка_ФОП у нього
      // є ненульова сума (запит Анни, 2026-07-28: у режимі "С" на 3-й
      // сторінці лишались порожні/нульові плашки — блоки без значення не
      // показуємо взагалі).
      const price = it.lineNetto;
      const qty = Number(it.qty) || 0;
      if (qty <= 0 && (!price || price === 0)) return;
      const g = groups ? findKoshtorysGroup(groups, it.name) : null;
      const detail = g && g.items && g.items.length ? g.items : null;

      // Детальний режим (галочка "Детальні ціни за позиціями", m.detailedPrices,
      // запит Анни 2026-08-24) — за замовчуванням ВИМКНЕНО. Коли увімкнено, для
      // середніх блоків із переліком у Кошторисі показуємо КОЖНУ позицію з
      // обчисленою Ціною (Кошторис col G → $ × (1+націнка блоку)) та Вартістю
      // (=Ціна×к-сть). Заголовок+сума блоку прибираються (noHeader) — рядки
      // самі формують блок. Загальний підсумок КП НЕ змінюється (лишається
      // b.nettoTotal). Курс: G у гривнях ділимо на L2 (b.usdRate); "$..." — as-is.
      // Поза детальним режимом — звичайний push нижче (сума блоку + перелік
      // без цін, зі згортанням/бледним заголовком у docBudgetTable).
      if (m.detailedPrices && detail && /pv\s*кабел|автоматика\s+захисту|кабельно-?провідник|облік|заземленн/i.test(it.name)) {
        const rate = Number((b && b.usdRate) || m.usdRate) || 1;
        const mkRaw = Number(it.markup) || 0;
        const mkFrac = mkRaw > 1 ? mkRaw / 100 : mkRaw;
        const _pnum = (str) => parseFloat(String(str == null ? "" : str).replace(/[^0-9.,]/g, "").replace(/^\.+/, "").replace(/,/g, "")) || 0;
        const keepCents = /pv\s*кабел/i.test(String(it.name || ""));
        const priced = detail.map((d) => {
          const raw = String(d.price == null ? "" : d.price);
          const num = _pnum(raw);
          const usd = /\$/.test(raw) ? num : (rate ? num / rate : 0);
          const unit = usd * (1 + mkFrac);
          const q = Number(d.qty) || 0;
          const _lineDisp = (keepCents || Math.round(unit) < 1) ? Math.round(unit * q) : Math.round(unit) * q;
          return Object.assign({}, d, { _unit: unit, _lineDisp: _lineDisp, _costL2: usd * q, _h: _pnum(d.koshtH), _priceMissing: num === 0 });
        });
        sections.push({
          items: priced,
          nameFn: budgetDetailNames,
          qtyFn: budgetDetailQty,
          unitFn: (d) => d._unit,
          lineFn: (d) => d._lineDisp,
          price: null,
          noHeader: true,
          label: it.name,
          groupClass: "grp-mat",
          detailPriced: true,
          blockTotal: price,
          blockMarkup: mkFrac,
          unitMeasure: matUnit,
        });
        return;
      }

      sections.push({
        items: detail || [],
        nameFn: budgetDetailNames,
        qtyFn: budgetDetailQty,
        price,
        label: it.name,
        groupClass: "grp-mat",
        blockQty: it.qty,
        blockUnit: it.unit,
        unitMeasure: matUnit, // запасний варіант; основне джерело — it.unit з Кошторису
      });
    });

    sections.push({ items: worksRows, nameFn: (it) => it.name, qtyFn: (it) => it.qty, lineFn: (it) => it.lineNetto, price: null, noHeader: true, label: "Роботи", groupClass: "grp-works", unitMeasure: worksUnit });
    return sections;
  }

  function paginateBudgetSections(m, sections, priceHeader, unitHeader, totalsHtml) {
    const host = getMeasureHost();
    try {
      const availNarrow = measureAvailableHeight(m, false, priceHeader, unitHeader, host);
      const availWide = measureAvailableHeight(m, true, priceHeader, unitHeader, host);

      // Плоский список рядків (переписано 2026-07-27 разом із
      // горизонтальними підзаголовками): підзаголовок блоку + його позиції.
      // Оскільки rowspan більше нема — рядки незалежні, і весь клас багів
      // "білого стовпчика"/розірваного між сторінками rowspan відпадає.
      const units = [];
      sections.forEach((section) => {
        units.push({ html: budgetHeaderRow(section.label, section.price, section.groupClass), header: true, hasItems: !!(section.items && section.items.length) });
        (section.items || []).forEach((it) => {
          const unit = section.unitFn ? section.unitFn(it) : null;
          const line = section.lineFn ? section.lineFn(it) : null;
          units.push({ html: budgetItemRow(section.nameFn(it), section.qtyFn(it), unit, line, section.groupClass, /pv\s*кабел/i.test(String(section.label || ""))), header: false });
        });
      });

      const pages = [{ wide: false, rowsHtml: "", usedHeight: 0, availableHeight: availNarrow }];
      const currentPage = () => pages[pages.length - 1];
      const startNewPage = () => { pages.push({ wide: true, rowsHtml: "", usedHeight: 0, availableHeight: availWide }); };

      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        let page = currentPage();
        // Не лишаємо підзаголовок блоку "сиротою" внизу сторінки: якщо у
        // блоку є позиції — підзаголовок має влізти РАЗОМ хоча б із першою.
        if (u.header && u.hasItems && i + 1 < units.length && page.rowsHtml) {
          const together = measureRowsHtml(page.rowsHtml + u.html + units[i + 1].html, page.wide, host);
          if (together > page.availableHeight) { startNewPage(); page = currentPage(); }
        }
        let candH = measureRowsHtml(page.rowsHtml + u.html, page.wide, host);
        if (candH > page.availableHeight && page.rowsHtml) {
          startNewPage();
          page = currentPage();
          candH = measureRowsHtml(page.rowsHtml + u.html, page.wide, host);
        }
        page.rowsHtml += u.html;
        page.usedHeight = candH;
      }

      let page = currentPage();
      const freeHeight = page.availableHeight - page.usedHeight;
      const totalsHeight = measureTfootHtml(totalsHtml, page.wide, host);
      if (totalsHeight > freeHeight) {
        startNewPage();
        page = currentPage();
      }
      page.totalsHtml = totalsHtml;

      return pages.map((p) => {
        if (!p.wide) {
          return `
          <section class="kp-page budget-page">
            ${pageHeader(m.meta)}
            <div class="section-title"><span class="num-badge">03</span> Бюджет реалізації</div>
            <div class="budget-layout">
              ${budgetTable(p.rowsHtml, priceHeader, unitHeader, p.totalsHtml || null)}
              ${budgetNotesAside({ detail: true })}
            </div>
          </section>`;
        }
        return `
        <section class="kp-page budget-page">
          ${pageHeader(m.meta)}
          <div class="section-title">Бюджет реалізації (продовження)</div>
          <div class="budget-table-wrap">
            ${budgetTable(p.rowsHtml, priceHeader, unitHeader, p.totalsHtml || null)}
          </div>
        </section>`;
      }).join("");
    } finally {
      host.remove();
    }
  }

  function pageBudget(m) {
    const b = m.budget || {};
    // Режим "C" (без ПДВ, запит Анни 2026-07-18) — не показуємо ані рядок
    // податку, ані слово "ПДВ" в підписах підсумку/шапки таблиці взагалі.
    const noVat = m.clientMode === "cash";
    const priceHeader = noVat ? "Вартість, $" : "Вартість<br/>без ПДВ, $";
    // Нова колонка "Ціна без ПДВ, $" — ціна за одиницю (стовпець K ПДВ),
    // заповнюється лише в розділі "Обладнання" (запит менеджерів 2026-07-27).
    const unitHeader = noVat ? "Ціна, $" : "Ціна<br/>без ПДВ, $";
    // Підписи підсумків (запит Анни, 2026-07-19): раніше `colspan="3"`
    // об'єднував і мержовану колонку категорії (де, наприклад, і так уже
    // стоїть вертикальна назва останнього підрозділу над цим рядком), тому
    // текст-центрувався по всій ширині трьох колонок — виглядало як
    // "у повітрі", не під колонкою назв. Тепер — окрема порожня `<td>` для
    // колонки категорії (та сама ширина, що й у решти рядків, просто без
    // тексту — рядок підсумку сам собою не належить жодному підрозділу) +
    // `colspan="2"` лише на назву/кількість з `text-align:left` (клас
    // "sum-label", див. style.css) — тепер підпис починається точно під
    // колонкою "Найменування", як і просила Анна.
    const totalsHtml = noVat
      ? `<tr class="sum grand"><td colspan="3" class="sum-label">Загальна вартість:</td><td class="num" contenteditable="true">${fmtUsd(b.nettoTotal)}</td></tr>`
      : `<tr class="sum"><td colspan="3" class="sum-label">Разом без ПДВ:</td><td class="num" contenteditable="true">${fmtUsd(b.nettoTotal)}</td></tr>
            <tr class="sum"><td colspan="3" class="sum-label">ПДВ</td><td class="num" contenteditable="true">${fmtUsd(b.vat)}</td></tr>
            <tr class="sum grand"><td colspan="3" class="sum-label">Загальна вартість з ПДВ:</td><td class="num" contenteditable="true">${fmtUsd(b.grossTotal)}</td></tr>`;

    const sections = buildBudgetSections(m, b);
    return paginateBudgetSections(m, sections, priceHeader, unitHeader, totalsHtml);
  }

  // ---------- Сторінка 04 — імітаційна модель СЕС (PvSyst) ----------
  const SHADING_POINTS = [
    "Ваше обладнання та температурний режим його роботи",
    "Локальні затінення від оточуючих об'єктів",
    "Розташування сонячних панелей (кут нахилу, азимут)",
    "Метеодані за минулі 15 років на основі бази даних Meteonorm 8.1",
    "Втрати в кабельних лініях",
    "Втрати електроенергії через запилення панелей",
  ];

  function pageShading(m) {
    if (!m.pvsystImage) return "";
    return `
    <section class="kp-page shading-page">
      ${pageHeader(m.meta)}
      <div class="section-title"><span class="num-badge">04</span> Ми створили <b class="accent">імітаційну модель вашої СЕС</b> та врахували:</div>
      <div class="shading-layout">
        <div class="shading-timeline">
          ${SHADING_POINTS.map((p) => `<div class="shading-item"><span class="dot"></span>${esc(p)}</div>`).join("")}
        </div>
        <div class="shading-img"><img src="${m.pvsystImage}"/></div>
      </div>
    </section>`;
  }

  // ---------- Сторінка 05 — порівняння погодинної генерації ----------
  function pageSeasonal(m) {
    if (!m.seasonalHourly || !m.seasonalHourly.series.length) return "";
    return `
    <section class="kp-page seasonal-page">
      ${pageHeader(m.meta)}
      <div class="section-title"><span class="num-badge">05</span> Порівняння погодинної генерації СЕС на прикладі січня / квітня / липня / жовтня</div>
      <div class="seasonal-chart-wrap"><canvas id="kp-seasonal-chart"></canvas></div>
    </section>`;
  }

  const SEASONAL_COLORS = { jan: "#4C7A72", apr: "#05554B", jul: "#F5C518", oct: "#B3592E" };

  function wireSeasonalChart(model) {
    const seasonal = model.seasonalHourly;
    if (!seasonal || !seasonal.series.length || !window.Chart) return;
    const ctx = document.getElementById("kp-seasonal-chart");
    if (!ctx) return;
    new Chart(ctx, {
      type: "line",
      data: {
        labels: seasonal.hours.map((h) => h + "H"),
        datasets: seasonal.series.map((s) => ({
          label: s.label,
          data: s.data,
          borderColor: SEASONAL_COLORS[s.key] || "#05554B",
          backgroundColor: SEASONAL_COLORS[s.key] || "#05554B",
          borderWidth: 2.5,
          pointRadius: 0,
          tension: 0.35,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            labels: { color: "#1B1F1E", font: { size: 12, weight: "600" }, usePointStyle: true, boxWidth: 8 },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: "#5B6864", font: { size: 10 } } },
          y: {
            beginAtZero: true,
            grid: { color: "#E1E6E2" },
            border: { display: false },
            ticks: { color: "#5B6864", font: { size: 10 } },
            title: { display: true, text: "кВт", color: "#5B6864" },
          },
        },
      },
    });
  }

  // ---------- Сторінка — "Гарантійний термін та термін використання" ----------
  // Внутрішня розмітка таблиці винесена в окрему функцію (запит Анни,
  // 2026-07-19, разом з форматом "Документ") — та сама таблиця 1:1
  // переюзається і на слайді (pageWarranty нижче), і в docSectionWarranty()
  // (renderDocument), щоб не дублювати розмітку/дані в двох місцях.
  function warrantyTableHtml() {
    return `<table class="warranty-table">
      <thead>
        <tr><th>Компоненти СЕС</th><th>Гарантія</th><th>Термін використання*</th></tr>
      </thead>
      <tbody>
        <tr><td>Генерація фотоелектричних модулів</td><td contenteditable="true">30 років</td><td rowspan="5" class="wu" contenteditable="true">до 35 років</td></tr>
        <tr><td>Цілісність фотоелектричних модулів</td><td contenteditable="true">12 років</td></tr>
        <tr><td>Система кріплень</td><td contenteditable="true">5 років</td></tr>
        <tr><td>Монтажні роботи</td><td rowspan="2" contenteditable="true">3 роки</td></tr>
        <tr><td>Кабельно-провідникова продукція</td></tr>
        <tr><td>Захисні пристрої та автоматика</td><td rowspan="2" contenteditable="true">5 років</td><td rowspan="2" class="wu" contenteditable="true">до 20 років</td></tr>
        <tr><td>Інвертори</td></tr>
        <tr><td>Онлайн-моніторинг параметрів роботи сонячної електростанції</td><td colspan="2" class="wu-life" contenteditable="true">безстроково</td></tr>
      </tbody>
    </table>`;
  }

  function pageWarranty(m) {
    return `
    <section class="kp-page warranty-page">
      <img class="logo" src="data:image/png;base64,${ESCORE_LOGO_B64}" alt="escore" />
      <div class="warranty-banner">Гарантійний термін та термін використання</div>
      <div class="warranty-table-wrap">
        ${warrantyTableHtml()}
      </div>
    </section>`;
  }

  // ---------- Остання сторінка — контакти менеджера ----------
  function pageManager(m) {
    const mgr = window.KP_CONFIG.MANAGER;
    return `
    <section class="kp-page manager-page">
      <img class="logo" src="data:image/png;base64,${ESCORE_LOGO_B64}" alt="escore" />
      <div class="manager-body">
        <div class="manager-photo-col">
          <div class="manager-photo"><img src="${mgr.photo}" alt="${esc(mgr.name)}"/></div>
          <div class="manager-name">${esc(mgr.name)}</div>
          <div class="manager-role">${esc(mgr.position)}</div>
        </div>
        <div class="manager-contacts">
          <div class="mc-block">
            <div class="mc-title">Написати мені</div>
            <div class="mc-val"><a href="mailto:${esc(mgr.email)}">${esc(mgr.email)}</a></div>
          </div>
          <div class="mc-row">
            <div class="mc-block">
              <div class="mc-title">Подзвонити нам</div>
              <div class="mc-val">${esc(mgr.phone)}</div>
            </div>
            <div class="mc-block">
              <div class="mc-title">Адреса</div>
              <div class="mc-val">${esc(mgr.address).replace(/\n/g, "<br/>")}</div>
            </div>
          </div>
          <div class="mc-block">
            <div class="mc-title">Соціальні мережі</div>
            <div class="mc-val">instagram: ${esc(mgr.instagram)}</div>
            <div class="mc-val">facebook: ${esc(mgr.facebook)}</div>
          </div>
        </div>
      </div>
    </section>`;
  }

  function buildTechSpec(pdv) {
    const specItems = [];
    let panelModel = null, panelsQty = 0, inverterModel = null, invertersQty = 0;
    // Усі моделі кожного типу (панелі / інвертори / АКБ) так, як їх виписано в
    // розрахунковій таблиці — щоб КОЖНУ показати окремим рядком у "Технічних
    // характеристиках"/"Технічному рішенні" (запит Анни, 2026-08-16), а не лише
    // одну. Одиничні поля вище лишаються для зворотної сумісності (= перша
    // модель + сумарна кількість), тож КП з одним видом кожного виглядає як був.
    const panels = [], inverters = [];
    let isHybrid = false, inverterKwTotal = 0;
    // batteryMatches (запит Анни, 2026-07-20, другий баг того ж дня): усі
    // позиції, назва яких згадує акумулятор/АКБ/батарею, збираються сюди
    // замість того, щоб одразу перезаписувати batteryModel/сумувати
    // batteryQty по ходу циклу (як було раніше). Причина: розширення
    // регулярки для акб трохи вище (той самий день, попередній фікс) почало
    // заодно ловити аксесуари, які лише ЗГАДУЮТЬ АКБ у дужках — напр. "Шафа
    // 3U-H-RACK (12 АКБ)" (стійка ПІД акумулятори, сама акумулятором не є) —
    // і якщо такий рядок траплявся в Кошторисі ПІСЛЯ реальної позиції "АКБ
    // Deye BOS-G PRO...", він мовчки перезаписував і назву, і сумарну
    // кількість (стара логіка додавала qty кожного збігу до однієї
    // спільної суми) — картка "Акумулятор" показувала назву й кількість
    // шафи замість самого акумулятора. Див. sectionHasData нижче.
    const batteryMatches = [];
    // Розпізнаємо обладнання ТІЛЬКИ з першого розділу розрахункової таблиці —
    // "Основне технічне обладнання та система кріплення". Раніше цикл ішов по
    // ВСІХ категоріях, тож слова "інвертор"/"панел" із назв РОБІТ (напр.
    // "Монтаж інвертора, АКБ та пусконаладка") хибно розпізнавались як
    // обладнання й потрапляли в "Технічне рішення" (запит Анни, 2026-08-16).
    const equipCat = pdv.categories.find((c) => {
      const cn = (c.name || "").toLowerCase();
      return cn.includes("техн") && cn.includes("облад");
    });
    (equipCat ? equipCat.items : []).forEach((it) => {
        const n = it.name.toLowerCase();
        const looksLikeAccessory = /кабел|провід|конектор|мс4|mc4|кріпленн|стійк/.test(n);
        const isPanel = !looksLikeAccessory && (/^фем$/i.test(it.code || "") || /панел/.test(n) || /^pv\s*модул/.test(n) || /^фотомодул/.test(n));
        if (isPanel) { panels.push({ name: it.name, qty: it.qty }); panelModel = it.name; panelsQty += it.qty; }
        if (/інвертор/.test(n)) {
          inverters.push({ name: it.name, qty: it.qty });
          inverterModel = it.name; invertersQty += it.qty;
          if (/г[іи]брид/.test(n)) isHybrid = true;
          const kwMatch = it.name.match(/(\d+(?:[.,]\d+)?)\s*k(?!wh)/i);
          if (kwMatch) inverterKwTotal += parseFloat(kwMatch[1].replace(",", ".")) * (it.qty || 1);
        }
        // Було: /акумулятор|акб\b|batter/ — \b (межа слова) у JS визначається
        // лише через ASCII-літери ([A-Za-z0-9_]), тому вона НІКОЛИ не
        // спрацьовує навколо кириличного тексту: "акб" в кінці рядка/перед
        // пробілом не вважається "межею", і ця альтернатива мовчки ніколи не
        // матчилась. Якщо позиція в Кошторисі названа просто "АКБ ..." (без
        // слова "акумулятор"), станція розпізнавалась як мережева, хоча
        // акумулятор фактично був — саме цей баг помітила Анна 2026-07-20
        // ("Тип станції" показав "мережева" при гібридному інверторі + АКБ).
        // Фікс: (?<![а-яіїєґ])...(?![а-яіїєґ]) — власна, кирилично-свідома
        // межа слова замість \b. Також додано корінь "батаре" (батарея) —
        // ще одне поширене позначення, яке раніше взагалі не розпізнавалось.
        if (/акумулятор|батаре|(?<![а-яіїєґ])акб(?![а-яіїєґ])|batter/.test(n)) {
          // isPrimary — назва позиції ПОЧИНАЄТЬСЯ з ключового слова (сам
          // акумулятор є "головним" предметом рядка), на відміну від
          // аксесуара, де слово лише десь ЗГАДУЄТЬСЯ в описі (типовий
          // приклад — "Шафа 3U-H-RACK (12 АКБ)", починається з "шафа").
          const isPrimary = /^(акумулятор|батаре|акб|batter)/.test(n);
          batteryMatches.push({ name: it.name, qty: it.qty, isPrimary });
        }
        if (it.qty > 0) {
          specItems.push({ label: it.name, value: `${it.qty} шт` });
        }
    });
    const hasBattery = batteryMatches.length > 0;
    // Реальні акумулятори (isPrimary — назва ПОЧИНАЄТЬСЯ з ключового слова), а
    // не аксесуари, що лише згадують АКБ в описі — кожен окремим рядком. Якщо
    // жодного "первинного" нема (усі — лише згадки), беремо перший будь-який
    // (стара поведінка). Одиничні поля = перший обраний, для сумісності.
    const primaryBatteries = batteryMatches.filter((m) => m.isPrimary);
    const batteryList = primaryBatteries.length ? primaryBatteries : (batteryMatches.length ? [batteryMatches[0]] : []);
    const batteries = batteryList.map((m) => ({ name: m.name, qty: m.qty }));
    const batteryModel = batteries.length ? batteries[0].name : null;
    const batteryQty = batteries.length ? batteries[0].qty : 0;
    const hybrid = isHybrid || hasBattery;
    const stationType = hybrid ? "гібридна" : "мережева";
    const stationTypeGen = hybrid ? "гібридної" : "мережевої";
    return {
      specItems: specItems.slice(0, 12), panelModel, panelsQty, inverterModel, invertersQty,
      batteryModel, batteryQty,
      panels, inverters, batteries,
      stationType, stationTypeGen, hasBattery,
      stationCapacityKw: inverterKwTotal || null,
    };
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  // "Без панелей" (запит Анни, 2026-07-22, терміново): без сонячних панелей
  // це вже не "сонячна електростанція" (гібридна/мережева), а система
  // резервного живлення на акумуляторах — тому назва станції по всьому
  // документу підміняється на "Джерело безперебійного живлення". Два
  // відмінки (називний і родовий) — бо фраза вживається в різних
  // граматичних контекстах ("Джерело..." як заголовок і "будівництво
  // джерела..." в тексті). m.hasPanels === false перевіряється явно
  // (не просто falsy), щоб виклики без цього поля не ламались.
  function stationNameNom(m) {
    return m.hasPanels === false ? "Джерело безперебійного живлення" : `${cap(m.tech.stationType)} сонячна електростанція`;
  }
  function stationNameGen(m) {
    return m.hasPanels === false ? "джерела безперебійного живлення" : `${m.tech.stationTypeGen} сонячної електростанції`;
  }

  function tierColors(values) {
    const n = values.length;
    const order = values.map((_, i) => i).sort((a, b) => (values[b] || 0) - (values[a] || 0));
    const tierSize = Math.ceil(n / 3);
    const colors = new Array(n);
    order.forEach((idx, rank) => {
      if (rank < tierSize) colors[idx] = "#F5C518";
      else if (rank < tierSize * 2) colors[idx] = "#05554B";
      else colors[idx] = "#82CFC4";
    });
    return colors;
  }

  const genDataLabelsPlugin = {
    id: "genDataLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.data.datasets.forEach((dataset, di) => {
        const meta = chart.getDatasetMeta(di);
        meta.data.forEach((bar, i) => {
          const value = dataset.data[i];
          if (value === null || value === undefined) return;
          ctx.save();
          ctx.fillStyle = "#1B1F1E";
          ctx.font = "600 11px -apple-system, Segoe UI, Roboto, Arial, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(fmtNum(value), bar.x, bar.y - 6);
          ctx.restore();
        });
      });
    },
  };

  // ---------- "Документ" (запит Анни, 2026-07-19) — другий формат виводу:
  // компактний портретний документ (лого+назва компанії, коротка преамбула,
  // решта даних — таблицями), замість "слайдів". Читає ТОЙ САМИЙ model, що
  // й render()/pageXxx() вище — жодного нового парсингу не потрібно, і всі
  // "розвилки" презентації (ПДВ/C, Розширений бюджет, опційні PvSyst/
  // сезонні дані) працюють ідентично, бо це одні й ті самі поля model.
  // Друкується НАТИВНИМ window.print() (див. app.js), НЕ html2canvas+jsPDF
  // — детальний план і обґрунтування: пам'ять kp_generator_document_mode_plan.
  function docTable(headCells, bodyHtml, tfootHtml) {
    return `<table class="doc-table">
      <thead><tr>${headCells.map((h) => `<th${h.num ? ' class="num"' : ""}>${esc(h.label)}</th>`).join("")}</tr></thead>
      <tbody>${bodyHtml}</tbody>
      ${tfootHtml ? `<tfoot>${tfootHtml}</tfoot>` : ""}
    </table>`;
  }

  // Проста 2-колонкова таблиця "показник — значення" для технічних/
  // фінансових показників (rows: [[підпис, значення-як-текст], ...]) —
  // рядки з порожнім/null значенням автоматично пропускаються (той самий
  // "не показуємо, якщо нема даних" підхід, що й у stat-card'ах на слайдах).
  function docKvTable(rows) {
    const body = rows
      .filter((r) => r[1] != null && r[1] !== "")
      .map((r) => `<tr><td>${esc(r[0])}</td><td class="num">${r[1]}</td></tr>`)
      .join("");
    if (!body) return "";
    return `<table class="doc-table doc-kv"><tbody>${body}</tbody></table>`;
  }

  // opts.avoidBreak (запит Анни, 2026-07-19): короткі секції — де таблиця
  // не така довга, щоб МУСИЛА розбиватись на кілька сторінок при друку —
  // отримують клас "doc-section-avoid-break" (page-break-inside:avoid у
  // style.css), щоб браузер не розривав їх посередині, залишаючи заголовок
  // на одній сторінці, а рядки таблиці на наступній. Навмисно НЕ
  // застосовується до "Бюджет реалізації" — та таблиця може бути довгою
  // (особливо з увімкненим Розширеним бюджетом), і примусова заборона
  // розриву там або не спрацює (таблиця однаково довша за сторінку), або
  // залишить велику порожню зону внизу попередньої сторінки — для неї й
  // так є власний, точковий page-break-inside:avoid на кожному <tr>
  // (table.doc-table tr{...} у style.css), який дозволяє розбивати МІЖ
  // рядками, просто не посередині одного рядка.
  function docSection(title, innerHtml, opts) {
    if (!innerHtml) return "";
    opts = opts || {};
    const cls = "doc-section"
      + (opts.avoidBreak ? " doc-section-avoid-break" : "")
      + (opts.breakBefore ? " doc-section-break-before" : "");
    return `<div class="${cls}"><h2>${esc(title)}</h2>${innerHtml}</div>`;
  }

  function docHeader(m) {
    return `<div class="doc-header">
      <div>
        <img class="logo" src="data:image/png;base64,${ESCORE_LOGO_B64}" alt="escore" />
        <div class="doc-company">${esc(m.meta.company.name)}</div>
      </div>
      <div class="doc-meta">
        <strong>КОМЕРЦІЙНА ПРОПОЗИЦІЯ</strong><br/>
        № ${esc(m.meta.kpNumber)} · від ${esc(m.meta.kpDateStr)}<br/>
        Дійсна ${esc(m.meta.validDays)} календарних днів
      </div>
    </div>`;
  }

  function docTitle(m) {
    // "Без панелей" (2026-07-22, третє термінове уточнення того ж дня):
    // формат "Документ" мав свою окрему копію цього заголовка, яку перший
    // прохід (для формату "Презентація") не зачепив — той самий
    // stationNameNom(m) helper, що вже використовується на обкладинці
    // слайд-формату.
    return `<div class="doc-title">${esc(stationNameNom(m))}${objectLabel(m)}${(m.model.capacityKwByPanels || m.tech.stationCapacityKw) ? " — " + fmtNum((m.model.capacityKwByPanels || m.tech.stationCapacityKw), 2) + " кВт" : ""}</div>`;
  }

  // Той самий текст-абзац, що й на слайді "Про проект" (pageAbout вище) —
  // не дублюємо копірайтинг, переюзаємо ту саму логіку побудови речення з
  // m.tech (сама оновлюється під кожен файл-розрахунок).
  function docPreamble(m) {
    const equipParts = [];
    // Назву панелей беремо як є з таблиці (вона вже містить "Сонячна панель…"),
    // БЕЗ хардкод-префікса "сонячні панелі" — інакше слова дублювались
    // (запит Анни, 2026-08-04). Так само, як інвертор/акумулятор нижче.
    const _panels = (m.tech.panels && m.tech.panels.length) ? m.tech.panels : (m.tech.panelModel ? [{ name: m.tech.panelModel, qty: m.tech.panelsQty }] : []);
    const _inverters = (m.tech.inverters && m.tech.inverters.length) ? m.tech.inverters : (m.tech.inverterModel ? [{ name: m.tech.inverterModel, qty: m.tech.invertersQty }] : []);
    const _batteries = m.tech.hasBattery ? ((m.tech.batteries && m.tech.batteries.length) ? m.tech.batteries : (m.tech.batteryModel ? [{ name: m.tech.batteryModel, qty: m.tech.batteryQty }] : [])) : [];
    _panels.forEach((p) => equipParts.push(`<b>${esc(stripEquipPrefix(p.name))}</b>${p.qty ? ` (${p.qty} шт)` : ""}`));
    _inverters.forEach((iv) => equipParts.push(`<b>${esc(iv.name)}</b>${iv.qty ? ` (${iv.qty} шт)` : ""}`));
    _batteries.forEach((b) => equipParts.push(`<b>${esc(b.name)}</b>${b.qty ? ` (${b.qty} шт)` : ""}`));
    return `<div class="doc-preamble">
      <p>Пропонуємо будівництво ${esc(stationNameGen(m))}${(m.model.capacityKwByPanels || m.tech.stationCapacityKw) ? " потужністю <b>" + fmtNum((m.model.capacityKwByPanels || m.tech.stationCapacityKw), 2) + " кВт</b>" : ""}${objectClause(m)}. ${m.hasPanels === false
        ? "Рішення забезпечує безперебійне живлення критичних навантажень об'єкта від акумуляторної системи під час перебоїв електропостачання."
        : `Рішення забезпечує генерацію власної електроенергії у денні години, коли зазвичай споживання найактивніше, зі зниженням витрат на електропостачання.${m.tech.hasBattery ? " Станція комплектується акумуляторною батареєю для автономної роботи / резервного живлення." : ""}`}</p>
      ${equipParts.length ? `<p>Основне обладнання: ${equipParts.join(", ")}.</p>` : ""}
      <p>Повний цикл робіт «під ключ»: проєктування, постачання обладнання, монтаж, підключення, пусконалагодження та запуск.</p>
    </div>`;
  }

  function docTechTable(m) {
    // Було: `m.tech.hasBattery ? "гібридна" : "мережева"` — окремий,
    // локальний перерахунок типу станції, що ігнорував isHybrid (ознаку
    // "гібридний" у НАЗВІ інвертора, buildTechSpec) і не використовував уже
    // готове m.tech.stationType (яке коректно об'єднує isHybrid || hasBattery,
    // buildTechSpec вище). Через це ця сторінка могла розійтись з рештою
    // документа (hero/обкладинка/преамбула — усі беруть m.tech.stationType) —
    // напр. якщо назва інвертора містить "гібрид", а окрема позиція АКБ з
    // якоїсь причини не розпізналась, тут все одно вийшла б "мережева", хоча
    // на інших сторінках уже стояло "гібридна". Фікс: одне джерело істини —
    // m.tech.stationType, як і скрізь інде в цьому файлі.
    // Кожна модель кожного типу — окремим рядком (запит Анни, 2026-08-16),
    // з fallback на одиничні поля (старий кеш m.tech без масивів).
    const invList = (m.tech.inverters && m.tech.inverters.length) ? m.tech.inverters : (m.tech.inverterModel ? [{ name: m.tech.inverterModel, qty: m.tech.invertersQty }] : []);
    const panelList = (m.tech.panels && m.tech.panels.length) ? m.tech.panels : (m.tech.panelModel ? [{ name: m.tech.panelModel, qty: m.tech.panelsQty }] : []);
    const battList = (m.tech.hasBattery && m.tech.batteries && m.tech.batteries.length) ? m.tech.batteries : (m.tech.hasBattery && m.tech.batteryModel ? [{ name: m.tech.batteryModel, qty: m.tech.batteryQty }] : []);
    const rows = [
      ["Тип станції", m.tech.stationType],
      ["Потужність інверторної групи", m.tech.stationCapacityKw ? fmtNum(m.tech.stationCapacityKw, 2) + " кВт" : null],
    ];
    invList.forEach((iv) => rows.push(["Інвертор", esc(iv.name) + (iv.qty ? ` — ${iv.qty} шт` : "")]));
    panelList.forEach((pl) => rows.push(["Сонячні панелі", esc(stripPanelLabel(stripEquipPrefix(pl.name))) + (pl.qty ? ` — ${pl.qty} шт` : "")]));
    rows.push(["Потужність масиву фотомодулів", m.model.capacityKw ? fmtNum(m.model.capacityKw, 2) + " кВт" : null]);
    battList.forEach((bt) => rows.push(["Акумулятор", esc(bt.name) + (bt.qty ? ` — ${bt.qty} шт` : "")]));
    rows.push(["Річна генерація", m.model.annualGenKwh ? fmtNum(m.model.annualGenKwh) + " кВт·год" : null]);
    rows.push(["Річна генерація на 1 кВт", m.model.annualGenPerKw ? fmtNum(m.model.annualGenPerKw) + " кВт·год" : null]);
    rows.push(["Генерація за 30 років (з урахуванням деградації фотоелектричних модулів: 1-й рік — 1%, починаючи з 2-го року — 0,4% щорічно)", m.model.gen30y ? fmtNum(m.model.gen30y) + " кВт·год" : null]);
    return docKvTable(rows);
  }

  function docFinTable(m) {
    return docKvTable([
      ["Річна економія (100% споживання)", m.model.annualSavings100 != null ? fmtUsd(m.model.annualSavings100) : null],
      ["Строк окупності при діючому тарифі (згідно наданих даних - 10 грн)", m.model.paybackAtTariff != null ? fmtNum(m.model.paybackAtTariff, 2) + " року" : null],
      ["Загальний економічний ефект за 30 років (розраховано з урахуванням деградації фотоелектричних модулів та експлуатаційних втрат)", m.model.totalEffect30y != null ? fmtUsd(m.model.totalEffect30y) : null],
      ["LCOE (собівартість 1 кВт·год) — середня вартість виробництва 1 кВт·год електроенергії. Розраховується як відношення загальних витрат на СЕС до загальної генерації за 30 років.", m.model.lcoe30Uah != null ? fmtNum(m.model.lcoe30Uah, 2) + " грн/кВт·год" : null],
    ]);
  }

  // Бюджет — та сама логіка/дані, що й pageBudget() вище (findBudgetEquipItems,
  // findBudgetWorksItems, budgetDetailSubsections/BUDGET_MATERIALS,
  // Розширений бюджет теж працює тут ідентично), просто БЕЗ повернутих на
  // 90° підписів категорій — у документа немає обмеження ширини "слайду",
  // тому категорія — звичайний виділений рядок-заголовок над своїми
  // позиціями. Це заразом прибирає весь клас "обрізаної літери" багів,
  // задокументованих для .budget-cat у kp_generator_status — тут цей
  // підхід просто не потрібен.
  // opts.withUnitMeasure (запит Анни, 2026-07-29, лише формат "Документ з
  // малюнками") — додає колонку "Од. виміру" між "Найменування" та
  // "Кількість". Значення: для позицій "Обладнання"/"Роботи" — одиниця з
  // рівня категорії ПДВ/Готівка_ФОП (sec.unitMeasure); для позицій середніх
  // підрозділів — пер-позиційна одиниця з Кошторису (it.unit), з відкатом на
  // sec.unitMeasure. У звичайному "Документі" (withUnitMeasure=false) таблиця
  // лишається 1:1 як була.
  if (typeof window !== "undefined") {
    window.__kpBudgetToggle = function (gid, el) {
      var scope = (el && el.closest("table")) || document;
      var rows = scope.querySelectorAll('tr[data-bg="' + gid + '"]');
      if (!rows.length) return;
      var show = rows[0].style.display === "none";
      for (var i = 0; i < rows.length; i++) rows[i].style.display = show ? "" : "none";
      var c = el && el.querySelector(".kp-caret");
      if (c) c.textContent = show ? "\u25be" : "\u25b8";
    };
  }

  function docBudgetTable(m, opts) {
    opts = opts || {};
    const withUM = !!opts.withUnitMeasure;
    const b = m.budget || {};
    const noVat = m.clientMode === "cash";
    const priceHeader = noVat ? "Вартість, $" : "Вартість без ПДВ, $";
    const unitHeader = noVat ? "Ціна, $" : "Ціна без ПДВ, $";
    // Ті самі блоки, що й у "Презентації" (buildBudgetSections): Обладнання
    // + кожна позиція середньої категорії ПДВ (з переліком із Кошторису в
    // розширеному режимі, лише ціна — у звичайному) + Роботи. Колонка "Ціна
    // без ПДВ, $" (ціна за одиницю) заповнюється лише в "Обладнанні".
    const sections = buildBudgetSections(m, b);

    // К-сть комірок, які перекриває підзаголовок блоку (усе, окрім останньої
    // колонки "Вартість"): Найменування [+ Од. виміру] + Кількість + Ціна.
    const catSpan = withUM ? 4 : 3;
    const measureOf = (sec, it) => {
      const own = it && it.unit != null ? String(it.unit).trim() : "";
      return own || sec.unitMeasure || "";
    };
    const catRow = (label, price, gid) => {
      const _bg = gid
        ? ` style="background:#eef1f0;cursor:pointer" onclick="window.__kpBudgetToggle&&window.__kpBudgetToggle('${gid}',this)"`
        : ` style="background:#eef1f0"`;
      const _caret = gid ? `<span class="kp-caret">\u25b8</span> ` : "";
      return `<tr class="doc-cat-row"${_bg}><td colspan="${catSpan}">${_caret}${esc(label)}</td><td class="num">${price != null ? fmtUsd(price) : ""}</td></tr>`;
    };
    const itemRows = (sec, gid) => {
      const _pf = fmtUsdSmart;
      const _hide = gid ? ` data-bg="${gid}" style="display:none"` : "";
      return sec.items.map((it) => {
        const q = sec.qtyFn(it);
        const u = sec.unitFn ? sec.unitFn(it) : null;
        const l = sec.lineFn ? sec.lineFn(it) : null;
        const umCell = withUM ? `<td>${esc(measureOf(sec, it))}</td>` : "";
        return `<tr${_hide}><td>${esc(sec.nameFn(it))}</td>${umCell}<td class="num">${q == null ? "—" : fmtNum(q)}</td><td class="num">${u != null ? _pf(u) : ""}</td><td class="num">${l != null ? fmtUsd(l) : ""}</td></tr>`;
      }).join("");
    };

    const midRow = (sec) => {
      const um = withUM ? ('<td>'+esc((sec.blockUnit!=null&&String(sec.blockUnit).trim())?String(sec.blockUnit).trim():(sec.unitMeasure||''))+'</td>') : '';
      const q = sec.blockQty;
      return '<tr><td>'+esc(sec.label)+'</td>'+um+'<td class=\"num\">'+(q==null?'':fmtNum(q))+'</td><td class=\"num\"></td><td class=\"num\">'+(sec.price!=null?fmtUsd(sec.price):'')+'</td></tr>';
    };
    let body = "";
    let _gid = 0;
    sections.forEach((sec) => {
      const __hasDetail = sec.items && sec.items.length;
      if (sec.noHeader) { if (__hasDetail) body += itemRows(sec, null); return; }
      if (sec.groupClass === "grp-mat" && !__hasDetail) { body += midRow(sec); return; }
      const gid = "bg" + (_gid++);
      body += catRow(sec.label, sec.price, gid);
      if (__hasDetail) body += itemRows(sec, gid);
    });

    const totalsHtml = noVat
      ? `<tr class="grand"><td colspan="${catSpan}">Загальна вартість:</td><td class="num">${fmtUsd(b.nettoTotal)}</td></tr>`
      : `<tr><td colspan="${catSpan}">Разом без ПДВ:</td><td class="num">${fmtUsd(b.nettoTotal)}</td></tr>
         <tr><td colspan="${catSpan}">ПДВ</td><td class="num">${fmtUsd(b.vat)}</td></tr>
         <tr class="grand"><td colspan="${catSpan}">Загальна вартість з ПДВ:</td><td class="num">${fmtUsd(b.grossTotal)}</td></tr>`;

    const head = withUM
      ? [{ label: "Найменування" }, { label: "Од. виміру" }, { label: "Кількість", num: true }, { label: unitHeader, num: true }, { label: priceHeader, num: true }]
      : [{ label: "Найменування" }, { label: "Кількість", num: true }, { label: unitHeader, num: true }, { label: priceHeader, num: true }];

    // Службова перевірка сум — ЛИШЕ у детальному режимі (m.detailedPrices) і
    // ЛИШЕ на екрані (.no-print, у PDF/друку не показується). Порівнює суму
    // показаних "Вартість" із «Загальною вартістю» й діагностує причину
    // розбіжності по кожному детальному блоку (курс / неповний перелік) +
    // позначає проблемні позиції (немає ціни / не сходиться з Кошторисом).
    let _note = "";
    if (m.detailedPrices) {
      let _colSum = 0; const _blockChecks = [];
      sections.forEach((sec) => {
        const hasDetail = sec.items && sec.items.length;
        if (!sec.noHeader && sec.price != null) _colSum += Number(sec.price) || 0;
        if (hasDetail && sec.lineFn) {
          let s2 = 0; sec.items.forEach((it) => { const l = sec.lineFn(it); if (l != null && !isNaN(l)) s2 += Number(l); });
          _colSum += s2;
          if (sec.detailPriced && sec.blockTotal != null) _blockChecks.push({ sec: sec, shown: s2, block: Number(sec.blockTotal) || 0 });
        }
      });
      const _r2 = (x) => Math.round(x * 100) / 100;
      const _TOL = 1;
      const _rows = [];
      const _cd = _r2(_colSum - (Number(b.nettoTotal) || 0));
      if (Math.abs(_cd) > _TOL) _rows.push("Сума позицій: " + fmtUsd(_colSum) + " проти «Загальна вартість» " + fmtUsd(b.nettoTotal) + " — розбіжність " + fmtUsd(_cd));
      _blockChecks.forEach((c) => {
        const d = _r2(c.shown - c.block);
        if (Math.abs(d) <= _TOL) return;
        const mk = 1 + (Number(c.sec.blockMarkup) || 0);
        const items = c.sec.items || [];
        let sumH = 0, sumCostL2 = 0;
        items.forEach((it) => { sumH += Number(it._h) || 0; sumCostL2 += Number(it._costL2) || 0; });
        const blockCost = mk ? c.block / mk : 0;
        const ratePart = _r2((sumCostL2 - sumH) * mk);
        const coverPart = _r2((sumH - blockCost) * mk);
        const parts = [];
        if (Math.abs(ratePart) > _TOL) parts.push("курс " + fmtUsd(ratePart));
        if (Math.abs(coverPart) > _TOL) parts.push("неповний перелік " + fmtUsd(coverPart));
        const flags = [];
        items.forEach((it) => {
          const q = Number(it.qty) || 0;
          const nm = "«" + esc(String(it.name || "").slice(0, 32)) + "»";
          if (it._priceMissing && q > 0) { flags.push(nm + ": є к-сть, немає ціни"); return; }
          const h = Number(it._h) || 0, cc = Number(it._costL2) || 0;
          if (h > 0 && cc > 0) { const ratio = cc / h; if (ratio < 0.7 || ratio > 1.4) flags.push(nm + ": ціна не сходиться з Кошторисом (валюта/значення?)"); }
          else if (h > 0 && cc === 0) flags.push(nm + ": немає ціни або кількості");
        });
        let line = esc(c.sec.label) + ": розбіжність " + fmtUsd(d);
        if (parts.length) line += " — " + parts.join(", ");
        if (flags.length) line += "; ⚠ " + flags.join("; ");
        _rows.push(line);
      });
      _note = _rows.length ? ('<div class="no-print" style="margin:8px 0;padding:8px 10px;border:1px solid #d9a300;background:#fff8e1;color:#7a5b00;font-size:12px;border-radius:4px;line-height:1.5;">⚠ Перевірка сум (лише на екрані, у PDF/друку не показується):<br/>' + _rows.join("<br/>") + "</div>") : "";
    }

    return docTable(head, body, totalsHtml) + _note + docBudgetDisclaimer(m);
  }

  // Пояснювальна плашка під таблицею "Бюджет реалізації" у форматі
  // "Документ" (запит Анни, 2026-07-27): виділений у фірмову зелену плашку
  // текст. Залежить від перемикача "Заміри / Немає замірів" на формі
  // (app.js → m.measured):
  //   • m.measured = false ("Немає замірів", за замовчуванням) — повний
  //     блок: вступ + перелік пунктів (зелені крапки-маркери) + рядок
  //     про оплату;
  //   • m.measured = true ("Заміри" вже зроблено, вартість не
  //     коригуватиметься) — лишається ТІЛЬКИ рядок про оплату.
  // У форматі "Презентація" цей блок навмисно не показується — там під
  // бюджетом уже є aside .budget-notes зі схожими примітками.
  function docBudgetDisclaimer(m) {
    const payLine = `<p class="dbn-analog">У разі відсутності позиції підбирається аналог</p><p class="dbn-pay">Оплата здійснюється в національній валюті за комерційним курсом на дату виконання платежу.</p>`;
    // Порожня плашка для довільного коментаря менеджера у варіанті "Заміри"
    // (запит Анни, 2026-08-04): йде під таблицею "Бюджет реалізації", ПЕРЕД
    // текстом "У разі відсутності позиції підбирається аналог". За
    // замовчуванням завжди порожня — заповнюється вручну в режимі
    // "Редагувати" (app.js робить її contenteditable, попри порожній вміст).
    // Порожня та поза режимом правки — не друкується (style.css @media print).
    const manualComment = `<div class="doc-budget-comment"></div>`;
    if (m && m.measured) {
      return `${manualComment}<div class="doc-budget-note">${payLine}</div>`;
    }
    return `${manualComment}<div class="doc-budget-note">
      <p class="dbn-intro">Остаточна вартість робіт та матеріалів може бути скоригована після:</p>
      <ul class="dbn-list">
        <li>виїзду на об'єкт</li>
        <li>виконання контрольних замірів</li>
        <li>уточнення технічних рішень</li>
        <li>складання детального кошторису</li>
      </ul>
      ${payLine}
    </div>`;
  }

  // "Імітаційна модель СЕС" у форматах "Документ" / "Документ з малюнками"
  // (запит Анни, 2026-07-29): замість скріншота PVsyst показуємо
  // ЗАВАНТАЖЕНЕ зображення з поля форми "Зображення розташування
  // панелей / візуалізація" (m.images[0]). PVsyst-скріншот
  // (m.pvsystImage) лишається лише у форматі "Презентація" (сторінка "04").
  // Якщо зображення не завантажено — секція не показується
  // (docSection повертає "" на порожній вміст).
  function docModelVisualBlock(m) {
    const img = m.images && m.images[0];
    if (!img) return "";
    return `<div class="doc-img-wrap"><img src="${img.url}"/><div class="cap">Візуалізація розташування панелей на об'єкті</div></div>`;
  }

  function docManagerBlock() {
    const mgr = window.KP_CONFIG.MANAGER;
    // Ім'я (<b>), email і телефон (<span>) — кожне окремим елементом-"листком",
    // щоб режим "Редагувати" (app.js) робив їх редагованими поокремо
    // (запит Анни, 2026-08-04: телефон і email теж мають правитись, як ім'я).
    return `<div class="doc-manager">
      <b>${esc(mgr.name)}</b>, ${esc(mgr.position)}<br/>
      <span class="doc-mgr-email">${esc(mgr.email)}</span> · <span class="doc-mgr-phone">${esc(mgr.phone)}</span><br/>
      ${esc(mgr.address).replace(/,?\n/g, ", ")}
    </div>`;
  }

  // Візуальний блок для розділу "Технічне рішення" у форматі "Документ з
  // малюнками": СТОВПЧИКОВА діаграма помісячної генерації — та
  // сама, що на слайді "Про проєкт" у "Презентації" (canvas + Chart.js,
  // малюється у wireDocGenChart нижче). ЗАВАНТАЖЕНЕ фото розкладки
  // панелей (m.images[0]) БІЛЬШЕ НЕ дублюється тут — воно показується
  // лише в розділі "Імітаційна модель СЕС" (docModelVisualBlock, запит
  // Анни, 2026-07-29). Без селектора місяця — лише діаграма.
  function docTechVisuals(m) {
    const chart = (m.hasPanels !== false && m.model.months && m.model.months.length)
      ? `<div class="doc-visual doc-chart-block"><div class="doc-visual-title">Прогнозована генерація за місяцями, кВт·год</div><div class="doc-chart-wrap"><canvas id="doc-gen-chart"></canvas></div></div>`
      : "";
    return chart;
  }

  // Малює стовпчикову діаграму помісячної генерації у "Документі з малюнками"
  // (та сама конфігурація Chart.js, що й у render() для слайда "Про проєкт" —
  // tierColors + genDataLabelsPlugin). Викликається після вставки HTML.
  function wireDocGenChart(model) {
    if (!(model.model.months && model.model.months.length && window.Chart)) return;
    const ctx = document.getElementById("doc-gen-chart");
    if (!ctx) return;
    const genValues = model.model.months.map((mm) => mm.generation);
    new Chart(ctx, {
      type: "bar",
      data: {
        labels: model.model.months.map((mm) => mm.month),
        datasets: [{
          label: "Генерація, кВт·год",
          data: genValues,
          backgroundColor: tierColors(genValues),
          borderRadius: 4,
          maxBarThickness: 46,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 28 } },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { display: false, beginAtZero: true, grid: { display: false }, border: { display: false } },
        },
      },
      plugins: [genDataLabelsPlugin],
    });
  }

  // opts.withImages (запит Анни, 2026-07-29) — формат "Документ з малюнками":
  // усе як у звичайному "Документі" (портрет, ручна правка, вибір Розділів КП),
  // ПЛЮС у розділі "Технічне рішення" — фото розкладки панелей + діаграма
  // генерації, а в таблиці "Бюджет реалізації" — колонка "Од. виміру".
  // "Додаткова сторінка" (запит Анни, 2026-08-14) — довільні скріншоти/
  // зображення, які менеджер підвантажує на формі при увімкненому чекбоксі
  // "Додаткова сторінка" (app.js → model.extraImages, список {name,url}).
  // Показуються В КІНЦІ КП, перед контактами менеджера, у всіх трьох форматах.
  // Порожньо (чекбокс вимкнено або немає файлів) — нічого не додається.
  // Презентація: кожен скрін — окремий слайд (.kp-page).
  function pageExtra(m) {
    const imgs = m.extraImages || [];
    if (!imgs.length) return "";
    return imgs.map((im) => `
    <section class="kp-page extra-page">
      ${pageHeader(m.meta)}
      <div class="section-title">Додаткова інформація</div>
      <div class="extra-img"><img src="${im.url}"/></div>
    </section>`).join("\n");
  }
  // Документ / Документ з малюнками: скріни стопкою в розділі
  // "Додаткова інформація" (кожен — окремий блок із власним page-break-inside).
  function docExtraBlock(m) {
    const imgs = m.extraImages || [];
    if (!imgs.length) return "";
    return imgs.map((im) => `<div class="doc-img-wrap doc-extra-img"><img src="${im.url}"/></div>`).join("");
  }

  function renderDocument(model, opts) {
    opts = opts || {};
    const withImages = !!opts.withImages;
    const now = new Date();
    model.meta.kpNumber = model.meta.kpNumber || defaultKpNumber(now);
    model.meta.kpDateStr = model.meta.kpDateStr || fmtDate(now);
    model.meta.company = window.KP_CONFIG.COMPANY;
    model.tech = buildTechSpec(model.pdv);

    // "Розділи КП" (запит Анни, 2026-07-20) — 4 чекбокси на формі
    // (index.html #in-sec-*), передаються через app.js як model.sections.
    // Наразі діють ЛИШЕ тут, у форматі "Документ" — presentation-версія
    // (render() нижче) навмисно НЕ чіпається, за домовленістю з Анною
    // ("давай поки для Документа, з Презентацією подивимось пізніше").
    // Фолбек на всі true — про всяк випадок, якщо колись щось викличе
    // renderDocument() без цього поля (напр. старий кеш app.js).
    const sections = model.sections || { tech: true, finance: true, budget: true, warranty: true };

    // У "Документі з малюнками" розділ "Технічне рішення" містить преамбулу +
    // фото + діаграму; тоді avoidBreak НЕ ставимо (розділ високий і може
    // законно переливатись на наступну сторінку — окремі фото/діаграма мають
    // власний page-break-inside:avoid у style.css). У звичайному "Документі"
    // розділ лишається коротким текстовим, з avoidBreak як раніше.
    const techInner = sections.tech
      ? (docPreamble(model) + (withImages ? docTechVisuals(model) : ""))
      : "";

    // Розділи, що йдуть ПЕРЕД "Бюджет реалізації". Рахуємо їх у змінні, бо від
    // того, чи є серед них хоч один непорожній, залежить примусовий перенос
    // бюджету на нову сторінку (див. нижче).
    const secTech = docSection("Технічне рішення", techInner, { avoidBreak: !withImages });
    const secTechSpec = docSection("Технічні характеристики", sections.tech ? docTechTable(model) : "", { avoidBreak: true });
    const secFinance = docSection("Фінансові показники", sections.finance ? docFinTable(model) : "", { avoidBreak: true });

    // "Бюджет реалізації" зазвичай починається з нової сторінки (breakBefore).
    // АЛЕ якщо всі попередні розділи вимкнені на формі ("Розділи КП") і між
    // заголовком КП та бюджетом нічого немає — примусовий перенос лишав би
    // заголовок самотнім на 1-й сторінці, а таблицю відкидав на 2-гу (запит
    // Анни 2026-07-30). Тому переносимо лише коли перед бюджетом є хоч один
    // непорожній розділ; інакше бюджет іде одразу після заголовка на тому ж
    // листі. docSection повертає "" на порожній вміст, тож перевірка на "" точна.
    const hasContentBeforeBudget = !!(secTech || secTechSpec || secFinance);
    const secBudget = docSection("Бюджет реалізації", sections.budget ? docBudgetTable(model, { withUnitMeasure: true }) : "", { breakBefore: hasContentBeforeBudget });

    const html = `
    <div class="doc-root">
      ${docHeader(model)}
      ${docTitle(model)}
      ${secTech}
      ${secTechSpec}
      ${secFinance}
      ${secBudget}
      ${docSection("Імітаційна модель СЕС", docModelVisualBlock(model), { avoidBreak: true })}
      ${docSection("Додаткова інформація", docExtraBlock(model), { breakBefore: true })}
      ${docSection("Гарантійний термін та термін використання", sections.warranty ? warrantyTableHtml() : "", { avoidBreak: true })}
      ${docManagerBlock()}
    </div>`;

    const holder = document.getElementById("kp-doc");
    holder.innerHTML = html;
    holder.classList.add("ready");

    if (withImages) wireDocGenChart(model);
  }

  function render(model) {
    const now = new Date();
    model.meta.kpNumber = model.meta.kpNumber || defaultKpNumber(now);
    model.meta.kpDateStr = model.meta.kpDateStr || fmtDate(now);
    model.meta.company = window.KP_CONFIG.COMPANY;
    model.tech = buildTechSpec(model.pdv);

    // "Без панелей" (2026-07-22): сторінка "02 Фінансові показники" вся
    // про економію/окупність від генерації — без панелей нема що на ній
    // показувати, тож не додаємо її до документа взагалі (сторінка "03
    // Бюджет реалізації" просто йде одразу після "01" — той самий
    // прийнятний "розрив" у нумерації, що вже є для опційних сторінок
    // "04"/"05" — PvSyst/сезонні графіки — коли їх немає).
    // "Без панелей" (2026-07-22, друге термінове уточнення того ж дня):
    // сторінка гарантій/термінів використання ("Гарантійний термін та
    // термін використання") теж вся про компоненти сонячної генерації
    // (фотомодулі, інвертори тощо) — без панелей прибираємо і її, лишаючи
    // сторінку менеджера останньою і єдиною "закриваючою" сторінкою.
    const html = [
      pageHero(model),
      pageWhyEscore(),
      pageCover(model),
      pageAbout(model),
      model.hasPanels === false ? "" : pageTech(model),
      pageBudget(model),
      pageShading(model),
      pageSeasonal(model),
      pageExtra(model),
      model.hasPanels === false ? "" : pageWarranty(model),
      pageManager(model),
    ].join("\n");

    const holder = document.getElementById("kp-doc");
    holder.innerHTML = html;
    holder.classList.add("ready");

    wireFinMonthSelect(model);
    wireSeasonalChart(model);

    if (model.model.months.length && window.Chart) {
      const ctx = document.getElementById("kp-gen-chart");
      if (ctx) {
        const genValues = model.model.months.map((m) => m.generation);
        new Chart(ctx, {
          type: "bar",
          data: {
            labels: model.model.months.map((m) => m.month),
            datasets: [{
              label: "Генерація, кВт·год",
              data: genValues,
              backgroundColor: tierColors(genValues),
              borderRadius: 4,
              maxBarThickness: 46,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 28 } },
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { display: false }, border: { display: false } },
              y: { display: false, beginAtZero: true, grid: { display: false }, border: { display: false } },
            },
          },
          plugins: [genDataLabelsPlugin],
        });
      }
    }
  }

  window.KpRender = { render, renderDocument };
})();
