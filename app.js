/* דיווח היעדרות: the teachers' personal page.
   Talks only to the absence sheet's Apps Script (config.js). The teacher's
   ID number is checked there and never stored here. ?demo=1 shows sample data. */
(() => {
  "use strict";
  const CFG = window.PORTAL_CONFIG || {};
  const DEMO = new URLSearchParams(location.search).has("demo");
  const $ = s => document.querySelector(s);
  const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  const REASONS = ["מחלה", "מחלת ילד", "אחר"];

  // ── small helpers ────────────────────────────────────────────────────
  function h(tag, attrs, ...kids) {
    const [name, ...cls] = tag.split(".");
    const el = document.createElement(name || "div");
    if (cls.length) el.className = cls.join(" ");
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === "class") el.className += " " + v;
      else if (k === "value") el.value = v;
      else if (k === "disabled") el.disabled = !!v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  /** Like el.replaceChildren, but empty items (null/false) are skipped, not shown as "null". */
  function put(el, ...kids) {
    el.replaceChildren(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));
    return el;
  }
  const z = n => String(n).padStart(2, "0");
  const iso = d => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  const parseISO = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => iso(new Date());
  const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
  const dayName = s => DAYS[parseISO(s).getDay()];
  const dm = s => { const d = parseISO(s); return `${d.getDate()}.${d.getMonth() + 1}`; };
  function nextSchoolDay(s) { let d = s; while (parseISO(d).getDay() === 6) d = addDays(d, 1); return d; }
  function hoursText(a, b) { return a === 1 && b === 10 ? "יום מלא" : a === b ? `שעה ${a}` : `שעות ${a}–${b}`; }

  function gematria(n) {
    if (n >= 1000) n %= 1000;
    const H = [[400, "ת"], [300, "ש"], [200, "ר"], [100, "ק"], [90, "צ"], [80, "פ"], [70, "ע"], [60, "ס"], [50, "נ"],
      [40, "מ"], [30, "ל"], [20, "כ"], [10, "י"], [9, "ט"], [8, "ח"], [7, "ז"], [6, "ו"], [5, "ה"], [4, "ד"], [3, "ג"], [2, "ב"], [1, "א"]];
    let o = ""; for (const [v, c] of H) while (n >= v) { o += c; n -= v; }
    o = o.replace("יה", "טו").replace("יו", "טז");
    return o.length > 1 ? o.slice(0, -1) + "״" + o.slice(-1) : o + "׳";
  }
  function heb(d) {
    try {
      const p = new Intl.DateTimeFormat("he-u-ca-hebrew-nu-latn", { day: "numeric", month: "long", year: "numeric" }).formatToParts(d);
      const g = t => (p.find(x => x.type === t) || {}).value;
      return { day: gematria(+g("day")), month: g("month"), year: gematria(+g("year")) };
    } catch (e) { return null; }
  }

  let toastT;
  function toast(msg, bad = false) {
    const t = $("#toast"); t.textContent = msg; t.className = "toast" + (bad ? " bad" : "");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hidden"), bad ? 6000 : 3200);
  }
  const loading = (txt = "טוען…") => h("div.loading", null, h("div.spinner"), txt);
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* private mode */ } },
  };

  /** Israeli ID check digit (same check as the server). */
  function idValid(s) {
    const d = String(s || "").replace(/\D/g, "").padStart(9, "0");
    if (d.length !== 9) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) { let x = +d[i] * (i % 2 + 1); if (x > 9) x -= 9; sum += x; }
    return sum % 10 === 0;
  }

  // ── talking to the sheet ─────────────────────────────────────────────
  let token = store.get("tp_token"), teacher = store.get("tp_teacher");
  async function call(action, body = {}) {
    if (DEMO) return demo(action, body);
    if (!CFG.scriptUrl) throw new Error("הדף עוד לא מחובר לגיליון");
    // text/plain keeps this a "simple" request, so Apps Script answers without CORS trouble.
    const res = await fetch(CFG.scriptUrl, { method: "POST", body: JSON.stringify({ action, token, ...body }) });
    const data = await res.json();
    if (!data.ok && data.error === "expired") { logout(); throw new Error("צריך להזדהות שוב"); }
    if (!data.ok) throw new Error(data.message || "משהו השתבש");
    return data;
  }

  // ── calendar ─────────────────────────────────────────────────────────
  let pop = null;
  const closePop = () => { if (pop) { pop.remove(); pop = null; } };
  document.addEventListener("mousedown", e => { if (pop && !pop.contains(e.target) && !e.target.closest(".dp-btn")) closePop(); });
  function datePicker(value, onPick, min) {
    let cur = value;
    const txt = h("span");
    const paint = () => { const hp = heb(parseISO(cur)); txt.textContent = `יום ${dayName(cur)}, ${parseISO(cur).getDate()} ב${MONTHS[parseISO(cur).getMonth()]}${hp ? ` · ${hp.day} ${hp.month}` : ""}`; };
    paint();
    const ico = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg>';
    const btn = h("button.dp-btn", { type: "button" }); btn.innerHTML = ico; btn.append(txt);
    btn.addEventListener("click", () => {
      if (pop) { closePop(); return; }
      const view = parseISO(cur); view.setDate(1);
      pop = h("div.dp-pop", { role: "dialog", "aria-label": "בחירת תאריך" });
      const draw = () => {
        const y = view.getFullYear(), m = view.getMonth(), n = new Date(y, m + 1, 0).getDate();
        const cells = [];
        for (let i = 0; i < new Date(y, m, 1).getDay(); i++) cells.push(h("span"));
        for (let d = 1; d <= n; d++) {
          const date = new Date(y, m, d), id = iso(date), hp = heb(date);
          cells.push(h("button.dp-day", {
            type: "button", disabled: date.getDay() === 6 || id < (min || todayISO()),
            class: (id === cur ? "sel" : "") + (id === todayISO() ? " today" : ""),
            on: { click: () => { cur = id; paint(); closePop(); onPick(id); } },
          }, h("b", null, d), hp ? h("small", null, hp.day) : null));
        }
        const a = heb(new Date(y, m, 1)), b = heb(new Date(y, m, n));
        put(pop, 
          h("div.dp-head", null,
            h("button.dp-nav", { type: "button", "aria-label": "חודש קודם", on: { click: () => { view.setMonth(m - 1); draw(); } } }, "→"),
            h("div.dp-title", null, `${MONTHS[m]} ${y}`, a ? h("small", null, a.month === b.month ? `${a.month} ${a.year}` : `${a.month}–${b.month} ${b.year}`) : null),
            h("button.dp-nav", { type: "button", "aria-label": "חודש הבא", on: { click: () => { view.setMonth(m + 1); draw(); } } }, "←")),
          h("div.dp-week", null, ["א", "ב", "ג", "ד", "ה", "ו", "ש"].map(x => h("span", null, x))),
          h("div.dp-grid", null, cells));
      };
      draw();
      document.body.append(pop);
      const r = btn.getBoundingClientRect(), w = Math.min(320, innerWidth - 16);
      pop.style.width = w + "px";
      pop.style.left = Math.min(Math.max(8, r.right - w), innerWidth - w - 8) + "px";
      pop.style.top = Math.min(r.bottom + 6, innerHeight - 400) + "px";
    });
    btn.setValue = v => { cur = v; paint(); };
    return btn;
  }

  // ── modal ────────────────────────────────────────────────────────────
  function modal(title, text, buttons) {
    const back = h("div.modal-back", { role: "presentation" });
    const close = () => {
      back.classList.add("out"); back.style.pointerEvents = "none";
      back.addEventListener("transitionend", () => back.remove(), { once: true });
      setTimeout(() => back.remove(), 250);
      document.removeEventListener("keydown", esc);
    };
    const esc = e => { if (e.key === "Escape") close(); };
    const box = h("div.modal", { role: "alertdialog", "aria-modal": "true", "aria-label": title },
      h("h3", null, title), h("p", null, text),
      h("div.modal-actions", null, (buttons || [["הבנתי", null, "primary"]]).map(([label, fn, kind]) =>
        h("button.btn", { type: "button", class: kind || "", on: { click: () => { close(); if (fn) fn(); } } }, label))));
    back.append(box);
    back.addEventListener("click", e => { if (e.target === back) close(); });
    document.addEventListener("keydown", esc);
    document.body.append(back);
    box.querySelector("button").focus();
  }
  const LOCKED = "את ההיעדרות הזאת כבר אי אפשר לשנות או לבטל מכאן. יש לפנות למזכירות או לרכז ההיעדרויות.";
  const LOCK_WHY = { past: "התאריך שלה כבר עבר.", subs: "כבר שובץ לה ממלא מקום.", office: "היא נרשמה במשרד." };
  function lockedModal(x) {
    modal("יש לפנות למזכירות", `${LOCK_WHY[x.lock] || ""} ${LOCKED}`.trim(),
      [["הבנתי", null, "primary"], ["כתיבת בקשה למשרד", () => showFix(x), ""]]);
  }

  // ── saving in the background ─────────────────────────────────────────
  // The sheet takes a few seconds. The teacher moves on at once; the save runs
  // here, a small pill says "saving, do not close", and closing the page while
  // something is still saving asks first.
  let busy = 0, onHome = false, saverT;
  const saver = h("div.saver.hidden", { role: "status", "aria-live": "polite" });
  document.body.append(saver);
  function pill(kind, text, ms) {
    clearTimeout(saverT);
    saver.className = "saver " + kind; saver.textContent = text;
    if (ms) saverT = setTimeout(() => saver.classList.add("hidden"), ms);
  }
  window.addEventListener("beforeunload", e => { if (busy) { e.preventDefault(); e.returnValue = ""; } });
  /** A status line on the next screen: wait / ok / bad (+ retry). */
  function statusLine() {
    const el = h("div.status-line");
    el.set = (kind, text, retry) => {
      el.className = "status-line " + kind;
      put(el, ...[h("span", null, text), retry ? h("button.btn.small", { type: "button", on: { click: retry } }, "לנסות שוב") : null].filter(Boolean));
    };
    return el;
  }
  /** Run work() in the background. ok/fail texts go to the line and the pill. */
  async function background(label, work, { line, okText = "✓ נשמר. אפשר לסגור את הדף", onFail } = {}) {
    busy++;
    pill("wait", `⏳ ${label}… לא לסגור את הדף`);
    if (line) line.set("wait", `${label}…`);
    try {
      const res = await work(line);
      busy--;
      if (line) line.set("ok", okText);
      if (busy) pill("wait", "⏳ שומר… לא לסגור את הדף"); else pill("ok", okText, 4000);
      if (onHome) showHome();
      return res;
    } catch (ex) {
      busy--;
      const msg = ex.message || "משהו השתבש";
      if (line) line.set("bad", `לא נשמר: ${msg}`, () => background(label, work, { line, okText, onFail }));
      pill("bad", `לא נשמר: ${msg}`, 8000);
      if (onFail) onFail(ex);
      if (onHome) showHome();
    }
  }

  // ── screens ──────────────────────────────────────────────────────────
  function setWho() {
    put($("#who"), ...(teacher ? [h("span", null, teacher), h("button", { on: { click: logout } }, "יציאה")] : []));
  }
  function logout() { token = teacher = null; store.del("tp_token"); store.del("tp_teacher"); setWho(); showLogin(); }

  function showLogin(msg = "") {
    onHome = false;
    setWho();
    const name = h("input.input", { autocomplete: "name", placeholder: "שם פרטי ושם משפחה, למשל: יוסף כהן" });
    const id = h("input.input", { inputmode: "numeric", autocomplete: "off", placeholder: "9 ספרות", maxlength: "10" });
    const err = h("p.error", null, msg);
    const go = h("button.btn.primary.wide", { type: "submit" }, "כניסה");
    const form = h("form.page", { on: { submit: async e => {
      e.preventDefault(); err.textContent = "";
      if (name.value.trim().split(/\s+/).length < 2) { err.textContent = "כתוב שם פרטי ושם משפחה"; return; }
      if (!idValid(id.value)) { err.textContent = "מספר הזהות לא תקין. בדוק את הספרות"; return; }
      go.disabled = true; go.textContent = "בודק…";
      try {
        const r = await call("login", { name: name.value, id: id.value });
        token = r.token; teacher = r.teacher; store.set("tp_token", token); store.set("tp_teacher", teacher);
        showHome();
      } catch (ex) { err.textContent = ex.message; go.disabled = false; go.textContent = "כניסה"; }
    } } },
      h("div.field", null, h("label.label", null, "שם פרטי ושם משפחה"), name),
      h("div.field", null, h("label.label", null, "מספר זהות"), id, h("div.hint", null, "משמש רק לזיהוי. לא נשמר בדף.")),
      go, err);
    put($("#main"), 
      h("h1", null, "שלום ", h("span.accent", null, "מורה")),
      h("p.lead", null, `${CFG.school || ""}: דיווח על היעדרות, וצפייה בהיעדרויות שלך`),
      form);
    name.focus();
  }

  const STATUS = {
    "חדש": ["התקבל", "wait"], "שינוי": ["השינוי התקבל", "wait"], "ביטול": ["הביטול התקבל", "wait"],
    "הוזן בשוטף": ["נרשם במערכת", "ok"], "עודכן בשוטף": ["עודכן במערכת", "ok"], "כבר היה במערכת": ["נרשם במערכת", "ok"],
    "ממתין לאישור המשרד": ["ממתין לאישור המשרד", "wait"],
    "בוטל": ["בוטל", "muted"], "בוטל בשוטף": ["בוטל", "muted"], "בוטל במערכת": ["בוטל במערכת", "muted"],
    "השינוי לא אושר": ["השינוי לא אושר", "bad"], "הביטול לא אושר": ["הביטול לא אושר", "bad"],
  };
  const statusOf = s => STATUS[s] || (String(s).startsWith("לבדיקה") ? ["בבדיקה במשרד", "wait"] : [s || "", "muted"]);
  const isClosed = x => x.lock === "canceled" || ["בוטל", "בוטל בשוטף", "בוטל במערכת", "ביטול"].includes(x.status);
  const SICK = ["מחלה", "מחלת ילד"];
  // Sick notes are collected month by month: on the 8th the previous month is
  // closed, so its missing notes are no longer shown or asked for.
  function noteCutoff() {
    const d = new Date(), y = d.getFullYear(), m = d.getMonth();
    return d.getDate() >= 8 ? iso(new Date(y, m, 1)) : iso(new Date(y, m - 1, 1));
  }
  const canAttach = x => x.sick && !x.hasNote && !isClosed(x) && x.from >= noteCutoff();
  const needsNote = x => canAttach(x) && x.from <= todayISO();

  /** School days (Sunday–Friday) of an absence. */
  function daysOf(x) { let n = 0, d = x.from; while (d <= (x.to || x.from)) { if (parseISO(d).getDay() !== 6) n++; d = addDays(d, 1); } return n; }

  let mine = [];  // the last list from the sheet, also used to warn about overlaps
  let fixes = []; // the teacher's requests to the office, with their status
  const filt = { month: "", reason: "", source: "", missing: false };

  async function showHome() {
    onHome = true;
    setWho();
    const body = h("div", null, loading("טוען את ההיעדרויות שלך…"));
    put($("#main"), 
      h("h1", null, "שלום, ", h("span.accent", null, teacher || "")),
      h("p.lead", null, "ההיעדרויות שלך מתחילת שנת הלימודים"),
      tabsBar("abs"),
      h("button.btn.primary.wide", { on: { click: () => showForm() } }, "+ דיווח היעדרות"),
      body);
    let r;
    try { r = await call("mine"); } catch (ex) { put(body, h("div.empty", null, ex.message)); return; }
    if (r.teacher && r.teacher !== teacher) { teacher = r.teacher; store.set("tp_teacher", teacher); setWho(); $("#main h1 .accent").textContent = teacher; }
    mine = r.items || [];
    fixes = r.fixes || [];
    const today = r.today || todayISO();
    const live = mine.filter(x => !isClosed(x));
    const upcoming = live.filter(x => (x.to || x.from) >= today).sort((a, b) => a.from.localeCompare(b.from) || a.fromHour - b.fromHour);
    const past = mine.filter(x => (x.to || x.from) < today || isClosed(x));

    // year summary
    const done = live.filter(x => x.from <= today);
    const sumDays = done.reduce((a, x) => a + daysOf({ from: x.from, to: (x.to || x.from) < today ? x.to : today }), 0);
    const full = done.filter(x => x.fromHour === 1 && x.toHour === 10).length;
    const noNote = live.filter(needsNote);
    const stats = h("div.stats", null,
      h("div.stat", null, h("b", null, sumDays), h("span", null, "ימי היעדרות השנה")),
      h("div.stat", null, h("b", null, done.length - full), h("span", null, "מהם חלקי יום")),
      h("button.stat", { type: "button", class: noNote.length ? "warn" : "", on: { click: () => {
        filt.missing = !!noNote.length; filt.month = filt.reason = filt.source = ""; paintHistory(); hist.scrollIntoView({ behavior: "smooth" });
      } } }, h("b", null, noNote.length), h("span", null, "בלי אישור מחלה")));

    // history filters
    const months = [...new Set(past.map(x => x.from.slice(0, 7)))].sort().reverse();
    const reasons = [...new Set(mine.map(x => x.reason).filter(Boolean))];
    const hist = h("div.slips");
    const bar = h("div.filters");
    function chipRow(label, opts, key) {
      return h("div.frow", null, h("span.flabel", null, label), h("div.chips", null, opts.map(([v, t]) => h("button.chip", {
        type: "button", class: filt[key] === v ? "on" : "", on: { click: () => { filt[key] = v; paintHistory(); } } }, t))));
    }
    function paintHistory() {
      const monthSel = h("select.input.month-sel", { "aria-label": "חודש", on: { change: e => { filt.month = e.target.value; paintHistory(); } } },
        h("option", { value: "" }, "כל החודשים"),
        months.map(m => { const d = parseISO(m + "-01"); return h("option", { value: m, selected: filt.month === m }, `${MONTHS[d.getMonth()]} ${d.getFullYear()}`); }));
      put(bar, 
        h("div.frow", null, h("span.flabel", null, "חודש"), monthSel),
        chipRow("סיבה", [["", "הכל"], ...reasons.map(x => [x, x])], "reason"),
        chipRow("עדכן", [["", "הכל"], ["המורה", "אני"], ["המשרד", "המשרד"]], "source"),
        h("div.frow", null, h("span.flabel", null, ""), h("button.chip", { type: "button", class: filt.missing ? "on" : "",
          on: { click: () => { filt.missing = !filt.missing; paintHistory(); } } }, "רק בלי אישור מחלה")));
      const rows = past.filter(x => (!filt.month || x.from.startsWith(filt.month)) && (!filt.reason || x.reason === filt.reason)
        && (!filt.source || x.source === filt.source) && (!filt.missing || needsNote(x)));
      const shown = filt.missing ? rows.concat(upcoming.filter(needsNote)) : rows;
      put(hist, ...(shown.length ? shown.map(slip) : [h("div.empty", null, past.length ? "אין היעדרויות שמתאימות לסינון" : "אין עדיין היעדרויות קודמות השנה")]));
    }
    paintHistory();
    // missing sick notes: one tap to attach (one file may cover several days)
    const banner = noNote.length ? h("div.banner", null,
      h("div", null, h("b", null, "חסר אישור מחלה"), " ל־",
        noNote.slice().sort((a, b) => a.from.localeCompare(b.from)).slice(0, 4).map(x => dm(x.from)).join(", "),
        noNote.length > 4 ? ` ועוד ${noNote.length - 4}` : ""),
      h("button.btn.primary", { on: { click: () => showAttach(noNote[0]) } }, "לצירוף")) : null;
    const openFixes = fixes.filter(f => f.status !== "טופל").length;
    const reqs = fixes.length ? [h("details.fixes-box", null,
      h("summary", null, h("span", null, "הבקשות שלי למשרד"),
        h("span.count", null, openFixes ? `${openFixes} בטיפול` : `${fixes.length}`)),
      h("div.fixes", null, fixes.slice(0, 8).map(fixCard)))] : [];
    put(body, 
      banner,
      stats,
      ...reqs,
      h("h2", null, "קרובות"),
      upcoming.length ? h("div.slips", null, upcoming.map(slip)) : h("div.empty", null, "אין היעדרויות קרובות. 🌿"),
      h("h2", null, "מתחילת השנה"), bar, hist,
      r.synced ? h("div.synced", null, `המצב במערכת עודכן לאחרונה: ${r.synced}`) : null,
      matchMedia("(display-mode: standalone)").matches ? null
        : h("div.synced", null, "טיפ: אפשר להוסיף את הדף למסך הבית בטלפון (שיתוף ← הוספה למסך הבית), ולפתוח אותו כמו אפליקציה."));
  }

  // Where the absence stands, in plain words: sent -> in the system.
  const ENTERED = ["הוזן בשוטף", "עודכן בשוטף", "כבר היה במערכת"];
  function steps(x) {
    const inSys = x.kind === "office" || ENTERED.includes(x.status);
    const st = [["נשלח", "done"], [inSys ? "נרשם במערכת" : "ממתין לרישום במערכת", inSys ? "done" : "now"]];
    if (x.kind === "office") st.shift();
    return h("ol.steps", { "aria-label": "מצב ההיעדרות" }, st.map(([t, c]) => h("li", { class: c }, t)));
  }
  const FIX_ST = { "חדש": ["נשלחה", "wait"], "נשלח למנדי": ["בטיפול", "wait"], "טופל": ["טופלה", "ok"] };
  const fixStatus = f => FIX_ST[f.status] || [f.status || "נשלחה", "wait"];
  function fixCard(f) {
    const [label, tone] = fixStatus(f);
    return h("div.fix", null,
      h("div.fix-top", null, h("span.tag", { class: tone }, label),
        f.date ? h("span", null, `${(f.text || "").startsWith("[מילוי מקום") ? "מילוי מקום" : "היעדרות"} ב${dayName(f.date)} ${dm(f.date)}`) : null,
        h("span.muted", null, f.at)),
      h("div.fix-text", null, f.text),
      f.answer ? h("div.fix-answer", null, h("b", null, "תשובת המשרד: "), f.answer) : null);
  }

  function slip(x) {
    const range = x.to && x.to !== x.from;
    const d1 = parseISO(x.from), hp = heb(d1);
    const [label, tone] = x.kind === "office" ? ["נרשם במערכת", "ok"] : statusOf(x.status);
    const closed = isClosed(x);
    const actions = [];
    if (!closed) {
      if (x.kind === "report") {
        actions.push(h("button.btn", { on: { click: () => x.lock ? lockedModal(x) : showForm(x) } }, "שינוי"));
        actions.push(h("button.btn.danger", { on: { click: () => x.lock ? lockedModal(x) : cancel(x) } }, "ביטול"));
      } else {
        actions.push(h("button.btn", { on: { click: () => showFix(x) } }, "בקשת תיקון"));
      }
      if (canAttach(x)) actions.push(h("button.btn.attach", { on: { click: () => showAttach(x) } }, "צירוף אישור מחלה"));
    }
    // the note: download any time; replace if it was the wrong file
    const notes = x.notes || [];
    const noteRow = x.hasNote ? h("div.slip-badges", null, h("span.badge.ok", null, "✓ אישור מחלה צורף"),
      notes.map((n, i) => h("button.linkbtn", { on: { click: () => downloadNote(n) } }, notes.length > 1 ? `הורדה ${i + 1}` : "הורדה")),
      closed ? null : h("button.linkbtn", { on: { click: () => replaceNote(x) } }, "החלפת הקובץ"),
      closed ? null : h("button.linkbtn", { on: { click: () => pickNote(x) } }, "צירוף קובץ נוסף"))
      : needsNote(x) ? h("div.slip-badges", null, h("span.badge.bad", null, "חסר אישור מחלה")) : null;
    const myFix = fixes.find(f => f.date === x.from && f.status !== "טופל");
    return h("div.slip", { class: closed ? "closed" : "" },
      h("div.slip-top", null,
        h("div.slip-date", null, `${dayName(x.from)}, `, h("span.num", null, d1.getDate()), ` ב${MONTHS[d1.getMonth()]}`,
          range ? ` – ${dayName(x.to)} ${dm(x.to)}` : ""),
        h("span.tag", { class: tone }, label),
        h("span.src", null, x.source === "המשרד" || x.kind === "office" ? "עודכן במשרד" : "עדכנת")),
      h("div.slip-meta", null, hp ? h("span", null, `${hp.day} ב${hp.month}`) : null,
        h("span", null, hoursText(x.fromHour, x.toHour)), h("span", null, x.reason)),
      x.note ? h("div.slip-note", null, x.note) : null,
      closed ? null : steps(x),
      noteRow,
      myFix ? h("div.slip-fix", null, "בקשה למשרד: ", h("b", null, fixStatus(myFix)[0])) : null,
      actions.length ? h("div.slip-actions", null, actions) : null);
  }

  // ── sick note: a photo or a PDF ──────────────────────────────────────
  const MAX_MB = 8;
  async function shrink(file) {
    // Photos from a phone are large: send a 1800px JPEG. PDFs (and images the
    // browser cannot draw, e.g. HEIC outside Safari) go as they are.
    if (!/^image\//.test(file.type)) return file;
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
      const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const blob = await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.82));
      return blob && blob.size < file.size ? new File([blob], "note.jpg", { type: "image/jpeg" }) : file;
    } catch (e) { return file; }
  }
  const b64 = f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = bad; r.readAsDataURL(f); });
  async function uploadNote(x, file, opts = {}) {
    const f = await shrink(file);
    if (f.size > MAX_MB * 1024 * 1024) throw new Error(`הקובץ גדול מדי (עד ${MAX_MB}MB)`);
    const mime = f.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "image/jpeg");
    const ref = y => ({ row: y.kind === "report" ? y.row : "", absenceId: y.absenceId || "" });
    const items = (opts.items && opts.items.length ? opts.items : [x]).map(ref);
    await call("note", { ...ref(x), items, replace: !!opts.replace, mime, data: await b64(f) });
  }
  function noteInput(onFile) {
    const inp = h("input", { type: "file", accept: "image/*,application/pdf", class: "hidden" });
    inp.addEventListener("change", () => { if (inp.files[0]) onFile(inp.files[0]); inp.value = ""; });
    return inp;
  }
  function chooseFile(onFile) {
    const inp = noteInput(onFile);
    document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
  }
  /** One more page for an absence that already has a note. */
  function pickNote(x) {
    chooseFile(file => background("מעלה את הקובץ", () => uploadNote(x, file), { okText: "✓ הקובץ צורף. אפשר לסגור את הדף" }));
  }
  /** The wrong file was sent: the new one takes its place (the old goes to the office's trash). */
  function replaceNote(x) {
    modal("החלפת אישור המחלה", "הקובץ החדש יחליף את הקובץ שצורף להיעדרות הזאת. להמשיך?", [
      ["בחירת קובץ חדש", () => chooseFile(file => background("מחליף את הקובץ",
        () => uploadNote(x, file, { replace: true }), { okText: "✓ האישור הוחלף. אפשר לסגור את הדף" })), "primary"],
      ["ביטול", null, ""]]);
  }
  /** The note comes through the sheet's script; the teacher never gets a Drive link. */
  async function downloadNote(n) {
    toast("מוריד…");
    try {
      const r = await call("noteFile", { n: n.n });
      const bin = atob(r.data), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: r.mime || "application/octet-stream" }));
      const a = h("a", { href: url, download: r.name || "אישור מחלה" });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast("✓ הקובץ ירד");
    } catch (ex) { toast(ex.message, true); }
  }
  /** Attach a sick note: to this absence, and to any other sick absences it covers. */
  function showAttach(x) {
    onHome = false;
    const today = todayISO();
    const others = mine.filter(y => y !== x && canAttach(y) && y.from <= addDays(today, 7))
      .sort((a, b) => a.from.localeCompare(b.from));
    const picked = new Set([x]);
    const row = y => {
      const cb = h("input", { type: "checkbox", checked: picked.has(y) ? "" : null });
      cb.checked = picked.has(y);
      cb.addEventListener("change", () => { cb.checked ? picked.add(y) : picked.delete(y); });
      return h("label.check.pick", null, cb, h("span", null, h("b", null, `${dayName(y.from)} ${dm(y.from)}`),
        y.to && y.to !== y.from ? ` עד ${dm(y.to)}` : "", ` · ${hoursText(y.fromHour, y.toHour)} · ${y.reason}`));
    };
    const fileName = h("span.file-name", null, "צילום ברור או PDF");
    let file = null;
    const fileInp = noteInput(f => { file = f; fileName.textContent = "📎 " + (f.name || "אישור"); });
    const err = h("p.error");
    const send = h("button.btn.primary.wide", { type: "button", on: { click: async () => {
      err.textContent = "";
      if (!file) { err.textContent = "בחר קובץ"; return; }
      if (!picked.size) { err.textContent = "סמן לאיזו היעדרות האישור שייך"; return; }
      const items = [...picked], f = file;
      showHome();
      background("מעלה את אישור המחלה", () => uploadNote(x, f, { items }), { okText: "✓ האישור צורף. אפשר לסגור את הדף" });
    } } }, "שליחת האישור");
    put($("#main"), 
      h("h1", null, "אישור ", h("span.accent", null, "מחלה")),
      h("p.lead", null, others.length ? "אם האישור מכסה כמה היעדרויות, סמן את כולן. הקובץ יעלה פעם אחת." : "צרף צילום או PDF של האישור."),
      h("div.page", null,
        h("div.field", null, h("span.label", null, "לאיזו היעדרות?"), row(x), others.map(row)),
        h("div.field", null, h("span.label", null, "הקובץ"),
          h("div.row", null, h("button.btn", { type: "button", on: { click: () => fileInp.click() } }, "בחירת קובץ"), fileName), fileInp),
        send, err,
        h("div.row", { style: "justify-content:center;margin-top:8px" }, h("button.btn.link", { type: "button", on: { click: showHome } }, "חזרה"))));
  }

  // ── report / change ──────────────────────────────────────────────────
  const overlaps = (a, b) => a.from <= (b.to || b.from) && b.from <= (a.to || a.from) && !(a.toHour < b.fromHour || a.fromHour > b.toHour);

  function showForm(edit = null) {
    onHome = false;
    let from = edit ? edit.from : nextSchoolDay(todayISO()), to = edit ? edit.to : from;
    let fh = edit ? edit.fromHour : 1, th = edit ? edit.toHour : 10, full = fh === 1 && th === 10;
    let reason = edit && REASONS.includes(edit.reason) ? edit.reason : edit ? "אחר" : "מחלה";
    let anchor = null;  // first tap of a range, waiting for the second
    let file = null;
    const warn = h("div.warn-box.hidden");
    const checkOverlap = () => {
      const want = { from, to, fromHour: full ? 1 : fh, toHour: full ? 10 : th };
      const hit = mine.find(x => !isClosed(x) && !(edit && x.kind === "report" && x.row === edit.row) && overlaps(want, x));
      warn.classList.toggle("hidden", !hit);
      if (hit) warn.textContent = `שים לב: כבר רשומה לך היעדרות ביום ${dayName(hit.from)} ${dm(hit.from)} (${hoursText(hit.fromHour, hit.toHour)}). אין צורך לדווח שוב.`;
    };
    const toPick = datePicker(to, d => { to = d; checkOverlap(); }, from);
    const fromPick = datePicker(from, d => { from = d; if (to < d) { to = d; toPick.setValue(d); } checkOverlap(); });
    const hours = h("div.chips.hours");
    const paintHours = () => { put(hours, ...Array.from({ length: 10 }, (_, i) => {
      const n = i + 1, inRange = n >= fh && n <= th;
      return h("button.chip", { type: "button", class: (n === fh || n === th) ? "on" : inRange ? "in" : "",
        "aria-pressed": inRange ? "true" : "false",
        on: { click: () => {
          // First tap sets the start; the second sets the end (either order).
          if (anchor === null) { fh = th = n; anchor = n; }
          else { fh = Math.min(anchor, n); th = Math.max(anchor, n); anchor = null; }
          paintHours();
        } } }, n);
    })); checkOverlap(); };
    const hoursField = h("div.field", null, h("span.label", null, "אילו שעות? לחץ על השעה הראשונה ואז על האחרונה"), hours);
    const scope = h("div.chips");
    const paintScope = () => {
      put(scope, 
        h("button.chip", { type: "button", class: full ? "on" : "", on: { click: () => { full = true; fh = 1; th = 10; paintScope(); } } }, "יום מלא"),
        h("button.chip", { type: "button", class: full ? "" : "on", on: { click: () => { full = false; anchor = null; if (fh === 1 && th === 10) { fh = th = 1; } paintScope(); } } }, "חלק מהיום"));
      hoursField.classList.toggle("hidden", full); paintHours();
    };
    const reasons = h("div.chips");
    const paintReasons = () => {
      put(reasons, ...REASONS.map(r => h("button.chip", { type: "button", class: r === reason ? "on" : "",
        on: { click: () => { reason = r; paintReasons(); } } }, r)));
      noteField.classList.toggle("hidden", !SICK.includes(reason));
    };
    const details = h("textarea.input", { placeholder: "לא חובה. בלי פרטים רפואיים.", maxlength: "300", value: edit ? edit.note || "" : "" });
    const fileName = h("span.file-name", null, "לא חובה. אפשר לצרף גם אחר כך");
    const fileInp = noteInput(f => { file = f; fileName.textContent = "📎 " + (f.name || "אישור"); });
    const noteField = h("div.field", null, h("span.label", null, "אישור מחלה"),
      h("div.row", null, h("button.btn", { type: "button", on: { click: () => fileInp.click() } }, "צירוף צילום או PDF"), fileName), fileInp);
    const mgr = h("input", { type: "checkbox", id: "mgr" });
    const mgrField = h("label.check", { for: "mgr" }, mgr, h("span", null, h("b", null, "באישור המנהל: "), "דיברתי עם המנהל והוא אישר את ההיעדרות"));
    paintScope(); paintReasons();
    const err = h("p.error");
    const sendLabel = edit ? "שליחת השינוי" : "שליחת הדיווח";
    const send = h("button.btn.primary.wide", { type: "button", on: { click: async () => {
      err.textContent = "";
      if (to < from) { err.textContent = "\"עד תאריך\" מוקדם מ\"מתאריך\""; return; }
      if (!mgr.checked) { err.textContent = "לפני השליחה צריך לדבר עם המנהל ולסמן ✓"; mgrField.classList.add("shake"); setTimeout(() => mgrField.classList.remove("shake"), 500); return; }
      const body = { from, to, fromHour: full ? 1 : fh, toHour: full ? 10 : th, reason, note: details.value, managerOk: true };
      const withFile = !!(file && SICK.includes(reason)), f = file;
      const line = statusLine();
      showSent({ edit: !!edit, from, to, fromHour: body.fromHour, toHour: body.toHour, reason, note: body.note, file: withFile }, line);
      // In stages, so "try again" never sends the report twice.
      let row = edit ? edit.row : null, sent = false;
      background(edit ? "שומר את השינוי" : "שולח את הדיווח", async ln => {
        if (!sent) {
          const res = await call(edit ? "change" : "report", edit ? { ...body, row: edit.row } : body);
          sent = true; if (!edit) row = res.row;
        }
        if (withFile) {
          ln.set("wait", "מעלה את אישור המחלה…");
          await uploadNote({ kind: "report", row, absenceId: edit ? edit.absenceId : "" }, f);
        }
      }, { line, okText: edit ? "✓ השינוי נשמר. אפשר לסגור את הדף" : "✓ הדיווח נשמר. אפשר לסגור את הדף",
           onFail: ex => { if (/לפנות למזכירות/.test(ex.message)) lockedModal({ ...(edit || {}), lock: "" }); } });
    } } }, sendLabel);
    put($("#main"), 
      h("h1", null, edit ? "שינוי " : "דיווח ", h("span.accent", null, "היעדרות")),
      h("p.lead", null, edit ? "עדכן את הפרטים ושלח. המשרד יקבל הודעה." : "הדיווח מגיע למשרד מיד, ונרשם במערכת תוך כמה דקות."),
      h("div.page", null,
        h("div.row2", null, h("div.field", null, h("span.label", null, "מתאריך"), fromPick), h("div.field", null, h("span.label", null, "עד תאריך"), toPick)),
        h("div.field", null, h("span.label", null, "היקף"), scope),
        hoursField, warn,
        h("div.field", null, h("span.label", null, "סיבה"), reasons),
        h("div.field", null, h("label.label", null, "פרטים"), details),
        noteField,
        mgrField,
        send, err,
        h("div.row", { style: "justify-content:center;margin-top:8px" }, h("button.btn.link", { type: "button", on: { click: showHome } }, "חזרה"))));
  }

  /** What was sent, and what happens next. */
  function showSent(r, line) {
    onHome = false;
    const when = r.to && r.to !== r.from ? `${dayName(r.from)} ${dm(r.from)} עד ${dayName(r.to)} ${dm(r.to)}` : `${dayName(r.from)} ${dm(r.from)}`;
    put($("#main"), 
      h("div.sent-mark", { "aria-hidden": "true" }, "✓"),
      h("h1", null, r.edit ? "השינוי " : "הדיווח ", h("span.accent", null, "נשלח")),
      h("div.page", null,
        h("div.sum-row", null, h("span", null, "מתי"), h("b", null, when)),
        h("div.sum-row", null, h("span", null, "שעות"), h("b", null, hoursText(r.fromHour, r.toHour))),
        h("div.sum-row", null, h("span", null, "סיבה"), h("b", null, r.reason)),
        r.note ? h("div.sum-row", null, h("span", null, "פרטים"), h("b", null, r.note)) : null,
        SICK.includes(r.reason) ? h("div.sum-row", null, h("span", null, "אישור מחלה"), h("b", null, r.file ? "צורף ✓" : "אפשר לצרף אחר כך")) : null,
        line || null,
        h("p.next", null, "הדיווח מגיע למשרד מיד, ונרשם במערכת תוך כמה דקות. את המצב שלו תראה בדף שלך."),
        h("div.remind", null, h("b", null, "לא לשכוח: "), "לעדכן את המנהל, ואת רכז ההיעדרויות והמזכירות."),
        h("button.btn.primary.wide", { type: "button", on: { click: showHome } }, "לדף שלי")));
    window.scrollTo(0, 0);
  }

  async function cancel(x) {
    const when = `${dayName(x.from)} ${dm(x.from)}`;
    modal("ביטול הדיווח", `לבטל את הדיווח על ${when}?`, [
      ["כן, לבטל", async () => {
        background("מבטל את הדיווח", () => call("cancel", { row: x.row }), { okText: "✓ הביטול נשלח. אפשר לסגור את הדף",
          onFail: ex => { if (/לפנות למזכירות/.test(ex.message)) lockedModal({ ...x, lock: "" }); } });
      }, "primary danger-fill"],
      ["לא", null, ""]]);
  }

  function showFix(x, ctx) {
    onHome = false;
    const back = ctx ? showFills : showHome;
    const text = h("textarea.input", { placeholder: "למשל: הייתי רק עד שעה 4, או: לא נעדרתי ביום הזה", maxlength: "500" });
    const err = h("p.error");
    const send = h("button.btn.primary.wide", { type: "button", on: { click: async () => {
      if (!text.value.trim()) { err.textContent = "כתוב מה צריך לתקן"; return; }
      const draft = { at: "", date: ctx ? ctx.date : x.from, text: (ctx ? ctx.prefix : "") + text.value.trim(), status: "", answer: "" };
      const card = h("div", null, fixCard({ ...draft, status: "שולח…" }));
      const line = statusLine();
      onHome = false;
      put($("#main"), 
        h("div.sent-mark", { "aria-hidden": "true" }, "✓"),
        h("h1", null, "הבקשה ", h("span.accent", null, "נשלחה")),
        h("div.page", null, card, line,
          h("p.next", null, "הבקשה מגיעה לרכז ההיעדרויות. כשיטפלו בה, הסטטוס כאן יתעדכן ל\"טופלה\", ואם תהיה תשובה, תראה אותה כאן."),
          h("button.btn.primary.wide", { type: "button", on: { click: back } }, "לדף שלי")));
      let sent = false;
      background("שולח את הבקשה", async () => {
        if (sent) return;
        const r = await call("fix", { absenceId: ctx ? "" : x.absenceId, date: draft.date, text: draft.text });
        sent = true;
        put(card, fixCard(r.fix || { ...draft, status: "חדש" }));
      }, { line, okText: "✓ הבקשה נשלחה ונמצאת בטיפול. אפשר לסגור את הדף" });
    } } }, "שליחת הבקשה");
    put($("#main"), 
      h("h1", null, "בקשה ", h("span.accent", null, "למשרד")),
      h("p.lead", null, ctx ? ctx.lead : `היעדרות ביום ${dayName(x.from)} ${dm(x.from)}, ${hoursText(x.fromHour, x.toHour)}. הבקשה תגיע למזכירות ולרכז ההיעדרויות.`),
      h("div.page", null, h("div.field", null, h("label.label", null, "מה צריך לשנות?"), text), send, err,
        h("div.row", { style: "justify-content:center;margin-top:8px" }, h("button.btn.link", { type: "button", on: { click: back } }, "חזרה"))));
  }

  // ── covered lessons ("מילויי מקום") ────────────────────────────────────
  const fl = { group: "month", type: "", when: "", cls: "", who: "" };
  const sundayOf = s => addDays(s, -parseISO(s).getDay());
  const GROUPS = [["month", "חודש"], ["week", "שבוע"], ["day", "יום"], ["cls", "כיתה"], ["who", "במקום מי"], ["hour", "שעה"]];

  function tabsBar(active) {
    return h("nav.tabs", { role: "tablist" }, [["abs", "ההיעדרויות שלי", showHome], ["fills", "מילויי מקום", showFills]].map(([k, t, fn]) =>
      h("button.tab", { type: "button", role: "tab", "aria-selected": active === k ? "true" : "false", class: active === k ? "on" : "",
        on: { click: () => { if (active !== k) fn(); } } }, t)));
  }

  function fillRow(x, today) {
    const future = x.date > today;
    const what = [x.classes, x.subject].filter(Boolean).join(" · ") || "שיעור";
    const ctx = { date: x.date, lead: `מילוי מקום ביום ${dayName(x.date)} ${dm(x.date)}, שעה ${x.hour}. הבקשה תגיע למזכירות ולרכז ההיעדרויות.`,
      prefix: `[מילוי מקום ${dm(x.date)} שעה ${x.hour}${x.classes ? ", " + x.classes : ""}] ` };
    return h("div.frow2", { class: future ? "future" : "" },
      h("div.fr-top", null, h("b", null, `${dayName(x.date)} ${dm(x.date)}`), h("span", null, `שעה ${x.hour}`),
        x.type === "שעה נוספת" ? h("span.tag", null, "שעה נוספת") : null,
        future ? h("span.tag.soon", null, "בקרוב") : null),
      h("div.fr-what", null, what),
      x.instead ? h("div.fr-inst", null, "במקום ", x.instead) : null,
      h("button.btn.link.fr-fix", { type: "button", on: { click: () => showFix(null, ctx) } }, "יש טעות?"));
  }

  async function showFills() {
    onHome = true;
    setWho();
    const body = h("div", null, loading("טוען את המילויים שלך…"));
    put($("#main"),
      h("h1", null, "שלום, ", h("span.accent", null, teacher || "")),
      h("p.lead", null, "השעות שמילאת מקום מתחילת שנת הלימודים"),
      tabsBar("fills"), body);
    let r;
    try { r = await call("myFills"); } catch (ex) { put(body, h("div.empty", null, ex.message)); return; }
    const all = (r.rows || []).slice().sort((a, b) => b.date.localeCompare(a.date) || b.hour - a.hour);
    const today = r.today || todayISO();
    if (!all.length) {
      put(body, h("div.empty", null, "עוד לא רשומות לך שעות מילוי מקום השנה."),
        r.synced ? h("div.synced", null, `המצב במערכת עודכן לאחרונה: ${r.synced}`) : null);
      return;
    }
    const done = all.filter(x => x.date <= today);
    const month = today.slice(0, 7);
    const stats = h("div.stats", null,
      h("div.stat", null, h("b", null, done.length), h("span", null, "שעות השנה")),
      h("div.stat", null, h("b", null, done.filter(x => x.date.startsWith(month)).length), h("span", null, "החודש")),
      h("div.stat", null, h("b", null, all.length - done.length), h("span", null, "קרובות")));
    const uniq = k => [...new Set(all.map(x => x[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "he"));
    const classes = uniq("classes"), whos = uniq("instead");
    const types = [...new Set(all.map(x => x.type))];
    const bar = h("div.filters"), list = h("div.groups");

    function groupOf(x) {
      switch (fl.group) {
        case "month": { const d = parseISO(x.date); return [x.date.slice(0, 7), `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, 0]; }
        case "week": { const sun = sundayOf(x.date); return [sun, `שבוע ${dm(sun)}–${dm(addDays(sun, 5))}`, 0]; }
        case "day": return [x.date, `${dayName(x.date)} ${dm(x.date)}`, 0];
        case "cls": return [x.classes || "—", x.classes || "ללא כיתה", 1];
        case "who": return [x.instead || "—", x.instead ? `במקום ${x.instead}` : "ללא מורה נעדר", 1];
        default: return [String(x.hour), `שעה ${x.hour}`, 2];
      }
    }
    function paint() {
      const sel = (label, key, opts) => opts.length < 2 ? null : h("div.frow", null, h("span.flabel", null, label),
        h("select.input.month-sel", { "aria-label": label, on: { change: e => { fl[key] = e.target.value; paint(); } } },
          h("option", { value: "" }, "הכל"), opts.map(o => h("option", { value: o, selected: fl[key] === o }, o))));
      put(bar,
        h("div.frow", null, h("span.flabel", null, "סיכום לפי"), h("div.chips", null, GROUPS.map(([k, t]) =>
          h("button.chip", { type: "button", class: fl.group === k ? "on" : "", on: { click: () => { fl.group = k; paint(); } } }, t)))),
        h("div.frow", null, h("span.flabel", null, "מתי"), h("div.chips", null, [["", "הכל"], ["past", "שהיו"], ["soon", "קרובות"]].map(([k, t]) =>
          h("button.chip", { type: "button", class: fl.when === k ? "on" : "", on: { click: () => { fl.when = k; paint(); } } }, t)))),
        types.length > 1 ? h("div.frow", null, h("span.flabel", null, "סוג"), h("div.chips", null, [["", "הכל"], ...types.map(t => [t, t])].map(([k, t]) =>
          h("button.chip", { type: "button", class: fl.type === k ? "on" : "", on: { click: () => { fl.type = k; paint(); } } }, t)))) : null,
        sel("כיתה", "cls", classes), sel("במקום מי", "who", whos));
      const rows = all.filter(x => (!fl.type || x.type === fl.type) && (!fl.cls || x.classes === fl.cls) && (!fl.who || x.instead === fl.who)
        && (!fl.when || (fl.when === "past" ? x.date <= today : x.date > today)));
      const groups = new Map();
      rows.forEach(x => { const [k, label, mode] = groupOf(x); (groups.get(k) || groups.set(k, { k, label, mode, rows: [] }).get(k)).rows.push(x); });
      const arr = [...groups.values()];
      arr.sort((a, b) => a.mode === 0 ? b.k.localeCompare(a.k) : a.mode === 2 ? Number(a.k) - Number(b.k) : b.rows.length - a.rows.length || a.label.localeCompare(b.label, "he"));
      put(list,
        h("div.glead", null, h("b", null, rows.length), " שעות במסנן הנוכחי"),
        ...(arr.length ? arr.map(g => h("details.group", null,
          h("summary", null, h("span", null, g.label), h("span.count", null, `${g.rows.length} ${g.rows.length === 1 ? "שעה" : "שעות"}`)),
          h("div.glist", null, g.rows.map(x => fillRow(x, today))))) : [h("div.empty", null, "אין שעות שמתאימות לסינון")]));
    }
    paint();
    put(body, stats, bar, list,
      h("p.synced", null, "הנתונים לקוחים ממערכת שוטף. אם משהו לא נראה נכון, לחץ על \"יש טעות?\" ליד השורה."),
      r.synced ? h("div.synced", null, `המצב במערכת עודכן לאחרונה: ${r.synced}`) : null);
  }

  // ── demo data (?demo=1) ──────────────────────────────────────────────
  const T = todayISO();
  const demoItems = [
    { kind: "report", row: 7, from: nextSchoolDay(addDays(T, 1)), to: nextSchoolDay(addDays(T, 1)), fromHour: 1, toHour: 10, reason: "מחלה", note: "", status: "הוזן בשוטף", absenceId: "1", source: "המורה", sick: true, hasNote: false, subs: "2/5", lock: "" },
    { kind: "report", row: 9, from: nextSchoolDay(addDays(T, 6)), to: nextSchoolDay(addDays(T, 7)), fromHour: 3, toHour: 10, reason: "אחר", note: "השתלמות", status: "חדש", absenceId: "", source: "המורה", sick: false, hasNote: false, lock: "" },
    { kind: "office", from: nextSchoolDay(addDays(T, 3)), to: nextSchoolDay(addDays(T, 3)), fromHour: 5, toHour: 6, reason: "אחר", absenceId: "3", source: "המשרד", sick: false, hasNote: false, lock: "office" },
    { kind: "report", row: 4, from: addDays(T, -12), to: addDays(T, -12), fromHour: 1, toHour: 10, reason: "מחלה", status: "הוזן בשוטף", absenceId: "5", source: "המורה", sick: true, hasNote: true, notes: [{ n: 2, name: "ישראלי 3.11.png" }], subs: "5/5", lock: "past" },
    { kind: "report", row: 3, from: addDays(T, -30), to: addDays(T, -29), fromHour: 1, toHour: 10, reason: "מחלת ילד", status: "הוזן בשוטף", absenceId: "6", source: "המורה", sick: true, hasNote: false, lock: "past" },
    { kind: "office", from: addDays(T, -45), to: addDays(T, -45), fromHour: 4, toHour: 8, reason: "מחלה", absenceId: "7", source: "המשרד", sick: true, hasNote: false, lock: "office" },
  ];
  async function demo(action, body) {
    await new Promise(r => setTimeout(r, ["report", "change", "fix", "note", "cancel"].includes(action) ? 2500 : 350));
    if (action === "login") return { ok: true, token: "demo", teacher: "ישראל ישראלי" };
    if (action === "mine") return { ok: true, teacher: "ישראל ישראלי", items: demoItems, synced: "15/11/2026 19:40", today: T,
      fixes: [{ at: "10/11/2026 08:12", date: addDays(T, -45), text: "הייתי רק עד שעה 6", status: "טופל", answer: "תוקן, השעות עודכנו" },
              { at: "15/11/2026 18:30", date: nextSchoolDay(addDays(T, 3)), text: "לא נעדרתי בשעה 6", status: "נשלח למנדי", answer: "" }] };
    if (action === "myFills") return { ok: true, today: T, synced: "15/11/2026 19:40", rows: [
      { id: "1", date: addDays(T, -2), hour: 3, classes: "ד1", subject: "חומש", instead: "כהן לוי", type: "מילוי מקום" },
      { id: "2", date: addDays(T, -2), hour: 4, classes: "ד1", subject: "חשבון", instead: "כהן לוי", type: "מילוי מקום" },
      { id: "3", date: addDays(T, -9), hour: 2, classes: "ה2", subject: "אנגלית", instead: "ברק דוד", type: "מילוי מקום" },
      { id: "4", date: addDays(T, -20), hour: 6, classes: "ו1", subject: "גמרא", instead: "", type: "שעה נוספת" },
      { id: "5", date: addDays(T, -45), hour: 1, classes: "ד1", subject: "חומש", instead: "כהן לוי", type: "מילוי מקום" },
      { id: "6", date: addDays(T, 2), hour: 5, classes: "ה2", subject: "הלכה", instead: "ברק דוד", type: "מילוי מקום" }] };
    if (action === "noteFile") return { ok: true, name: "ישראלי 3.11.png", mime: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" };
    if (action === "fix") return { ok: true, fix: { at: "15/11/2026 19:45", date: body.date, text: body.text, status: "חדש", answer: "" } };
    if (action === "report") return { ok: true, row: 99 };
    return { ok: true };
  }

  // ── start ────────────────────────────────────────────────────────────
  if (token && teacher) showHome(); else showLogin(CFG.scriptUrl || DEMO ? "" : "הדף עוד לא מחובר לגיליון.");
})();
