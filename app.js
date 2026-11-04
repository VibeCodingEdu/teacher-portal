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
  const REASONS = ["מחלה", "מחלת ילד", "אבל", "הצהרה", "בידוד", "אחר"];

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
        pop.replaceChildren(
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

  // ── screens ──────────────────────────────────────────────────────────
  function setWho() {
    $("#who").replaceChildren(...(teacher ? [h("span", null, teacher), h("button", { on: { click: logout } }, "יציאה")] : []));
  }
  function logout() { token = teacher = null; store.del("tp_token"); store.del("tp_teacher"); setWho(); showLogin(); }

  function showLogin(msg = "") {
    setWho();
    const name = h("input.input", { autocomplete: "name", placeholder: "למשל: כהן, או יוסף כהן" });
    const id = h("input.input", { inputmode: "numeric", autocomplete: "off", placeholder: "9 ספרות", maxlength: "10" });
    const err = h("p.error", null, msg);
    const go = h("button.btn.primary.wide", { type: "submit" }, "כניסה");
    const form = h("form.page", { on: { submit: async e => {
      e.preventDefault(); err.textContent = "";
      if (!name.value.trim()) { err.textContent = "כתוב את השם"; return; }
      if (!idValid(id.value)) { err.textContent = "מספר הזהות לא תקין. בדוק את הספרות"; return; }
      go.disabled = true; go.textContent = "בודק…";
      try {
        const r = await call("login", { name: name.value, id: id.value });
        token = r.token; teacher = r.teacher; store.set("tp_token", token); store.set("tp_teacher", teacher);
        showHome();
      } catch (ex) { err.textContent = ex.message; go.disabled = false; go.textContent = "כניסה"; }
    } } },
      h("div.field", null, h("label.label", null, "השם שלך"), name),
      h("div.field", null, h("label.label", null, "מספר זהות"), id, h("div.hint", null, "משמש רק לזיהוי. לא נשמר בדף.")),
      go, err);
    $("#main").replaceChildren(
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
  const isClosed = s => ["בוטל", "בוטל בשוטף", "בוטל במערכת", "ביטול"].includes(s);

  async function showHome() {
    setWho();
    const list = h("div.slips", null, loading("טוען את ההיעדרויות שלך…"));
    $("#main").replaceChildren(
      h("h1", null, "שלום, ", h("span.accent", null, (teacher || "").split(" ").slice(-1)[0] || teacher)),
      h("p.lead", null, "ההיעדרויות שלך מהיום והלאה"),
      h("button.btn.primary.wide", { on: { click: () => showForm() } }, "+ דיווח היעדרות"),
      h("h2", null, "ההיעדרויות שלי"), list);
    try {
      const r = await call("mine");
      const items = r.items.filter(x => x.status !== "עבר, לא טופל")
        .sort((a, b) => a.from.localeCompare(b.from) || a.fromHour - b.fromHour);
      if (!items.length) { list.replaceChildren(h("div.empty", null, "אין היעדרויות רשומות. 🌿")); return; }
      list.replaceChildren(...items.map(slip));
      if (r.synced) list.after(h("div.synced", null, `המצב במערכת עודכן לאחרונה: ${r.synced}`));
    } catch (ex) { list.replaceChildren(h("div.empty", null, ex.message)); }
  }

  function slip(x) {
    const range = x.to && x.to !== x.from;
    const d1 = parseISO(x.from), hp = heb(d1);
    const [label, tone] = x.kind === "office" ? ["נרשם במערכת", "ok"] : statusOf(x.status);
    const actions = [];
    const started = x.from <= todayISO();
    if (x.kind === "report" && !isClosed(x.status) && x.status !== "ממתין לאישור המשרד") {
      if (!started) actions.push(h("button.btn", { on: { click: () => showForm(x) } }, "שינוי"));
      actions.push(h("button.btn.danger", { on: { click: () => cancel(x) } }, "ביטול"));
    }
    if (x.kind === "office") actions.push(h("button.btn", { on: { click: () => showFix(x) } }, "בקשת תיקון"));
    return h("div.slip", null,
      h("div.slip-top", null,
        h("div.slip-date", null, `${dayName(x.from)}, `, h("span.num", null, d1.getDate()), ` ב${MONTHS[d1.getMonth()]}`,
          range ? ` – ${dayName(x.to)} ${dm(x.to)}` : ""),
        h("span.tag", { class: tone }, label),
        h("span.src", null, x.kind === "office" ? "נרשם במשרד" : "דיווחת")),
      h("div.slip-meta", null, hp ? h("span", null, `${hp.day} ב${hp.month}`) : null,
        h("span", null, hoursText(x.fromHour, x.toHour)), h("span", null, x.reason)),
      x.note ? h("div.slip-note", null, x.note) : null,
      actions.length ? h("div.slip-actions", null, actions) : null);
  }

  function showForm(edit = null) {
    let from = edit ? edit.from : nextSchoolDay(todayISO()), to = edit ? edit.to : from;
    let fh = edit ? edit.fromHour : 1, th = edit ? edit.toHour : 10, full = fh === 1 && th === 10;
    let reason = edit ? edit.reason : "מחלה";
    let anchor = null;  // first tap of a range, waiting for the second
    const toPick = datePicker(to, d => { to = d; }, from);
    const fromPick = datePicker(from, d => { from = d; if (to < d) { to = d; toPick.setValue(d); } });
    const hours = h("div.chips.hours");
    const paintHours = () => hours.replaceChildren(...Array.from({ length: 10 }, (_, i) => {
      const n = i + 1, inRange = n >= fh && n <= th;
      return h("button.chip", { type: "button", class: (n === fh || n === th) ? "on" : inRange ? "in" : "",
        "aria-pressed": inRange ? "true" : "false",
        on: { click: () => {
          // First tap sets the start; the second sets the end (either order).
          if (anchor === null) { fh = th = n; anchor = n; }
          else { fh = Math.min(anchor, n); th = Math.max(anchor, n); anchor = null; }
          paintHours();
        } } }, n);
    }));
    const hoursField = h("div.field", null, h("span.label", null, "אילו שעות? לחץ על השעה הראשונה ואז על האחרונה"), hours);
    const scope = h("div.chips");
    const paintScope = () => {
      scope.replaceChildren(
        h("button.chip", { type: "button", class: full ? "on" : "", on: { click: () => { full = true; fh = 1; th = 10; paintScope(); } } }, "יום מלא"),
        h("button.chip", { type: "button", class: full ? "" : "on", on: { click: () => { full = false; anchor = null; if (fh === 1 && th === 10) { fh = th = 1; } paintScope(); } } }, "חלק מהיום"));
      hoursField.classList.toggle("hidden", full); paintHours();
    };
    const reasons = h("div.chips");
    const paintReasons = () => reasons.replaceChildren(...REASONS.map(r => h("button.chip", { type: "button", class: r === reason ? "on" : "",
      on: { click: () => { reason = r; paintReasons(); } } }, r)));
    paintScope(); paintReasons();
    const note = h("textarea.input", { placeholder: "לא חובה. בלי פרטים רפואיים.", maxlength: "300", value: edit ? edit.note || "" : "" });
    const err = h("p.error");
    const send = h("button.btn.primary.wide", { type: "button", on: { click: async () => {
      err.textContent = "";
      if (to < from) { err.textContent = "\"עד תאריך\" מוקדם מ\"מתאריך\""; return; }
      send.disabled = true; send.textContent = "שולח…";
      const body = { from, to, fromHour: full ? 1 : fh, toHour: full ? 10 : th, reason, note: note.value };
      try {
        await call(edit ? "change" : "report", edit ? { ...body, row: edit.row } : body);
        toast(edit ? "✓ השינוי נשלח" : "✓ הדיווח נשלח. תודה");
        showHome();
      } catch (ex) { err.textContent = ex.message; send.disabled = false; send.textContent = edit ? "שליחת השינוי" : "שליחת הדיווח"; }
    } } }, edit ? "שליחת השינוי" : "שליחת הדיווח");
    $("#main").replaceChildren(
      h("h1", null, edit ? "שינוי " : "דיווח ", h("span.accent", null, "היעדרות")),
      h("p.lead", null, edit ? "עדכן את הפרטים ושלח. המשרד יקבל הודעה." : "הדיווח מגיע למשרד מיד, ונרשם במערכת תוך כמה דקות."),
      h("div.page", null,
        h("div.row2", null, h("div.field", null, h("span.label", null, "מתאריך"), fromPick), h("div.field", null, h("span.label", null, "עד תאריך"), toPick)),
        h("div.field", null, h("span.label", null, "היקף"), scope),
        hoursField,
        h("div.field", null, h("span.label", null, "סיבה"), reasons),
        h("div.field", null, h("label.label", null, "הערה"), note),
        send, err,
        h("div.row", { style: "justify-content:center;margin-top:8px" }, h("button.btn.link", { type: "button", on: { click: showHome } }, "חזרה"))));
  }

  async function cancel(x) {
    const when = `${dayName(x.from)} ${dm(x.from)}`;
    if (!confirm(`לבטל את הדיווח על ${when}?`)) return;
    try { await call("cancel", { row: x.row }); toast("✓ הביטול נשלח"); showHome(); }
    catch (ex) { toast(ex.message, true); }
  }

  function showFix(x) {
    const text = h("textarea.input", { placeholder: "למשל: הייתי רק עד שעה 4, או: לא נעדרתי ביום הזה", maxlength: "500" });
    const err = h("p.error");
    const send = h("button.btn.primary.wide", { type: "button", on: { click: async () => {
      if (!text.value.trim()) { err.textContent = "כתוב מה צריך לתקן"; return; }
      send.disabled = true;
      try { await call("fix", { absenceId: x.absenceId, date: x.from, text: text.value }); toast("✓ הבקשה נשלחה למשרד"); showHome(); }
      catch (ex) { err.textContent = ex.message; send.disabled = false; }
    } } }, "שליחת הבקשה");
    $("#main").replaceChildren(
      h("h1", null, "בקשת ", h("span.accent", null, "תיקון")),
      h("p.lead", null, `היעדרות ביום ${dayName(x.from)} ${dm(x.from)}, ${hoursText(x.fromHour, x.toHour)}. ההיעדרות נרשמה במשרד, ולכן התיקון נעשה שם.`),
      h("div.page", null, h("div.field", null, h("label.label", null, "מה לא נכון?"), text), send, err,
        h("div.row", { style: "justify-content:center;margin-top:8px" }, h("button.btn.link", { type: "button", on: { click: showHome } }, "חזרה"))));
  }

  // ── demo data (?demo=1) ──────────────────────────────────────────────
  const demoItems = [
    { kind: "report", row: 7, from: nextSchoolDay(addDays(todayISO(), 1)), to: nextSchoolDay(addDays(todayISO(), 1)), fromHour: 1, toHour: 10, reason: "מחלה", note: "", status: "הוזן בשוטף", absenceId: "1" },
    { kind: "report", row: 9, from: nextSchoolDay(addDays(todayISO(), 6)), to: nextSchoolDay(addDays(todayISO(), 7)), fromHour: 3, toHour: 10, reason: "אחר", note: "השתלמות", status: "חדש", absenceId: "" },
    { kind: "office", from: nextSchoolDay(addDays(todayISO(), 3)), to: nextSchoolDay(addDays(todayISO(), 3)), fromHour: 5, toHour: 6, reason: "הצהרה", absenceId: "3" },
  ];
  async function demo(action, body) {
    await new Promise(r => setTimeout(r, 350));
    if (action === "login") return { ok: true, token: "demo", teacher: "ישראלי ישראל" };
    if (action === "mine") return { ok: true, items: demoItems, synced: "04/11/2026 19:40" };
    return { ok: true };
  }

  // ── start ────────────────────────────────────────────────────────────
  if (token && teacher) showHome(); else showLogin(CFG.scriptUrl || DEMO ? "" : "הדף עוד לא מחובר לגיליון.");
})();
