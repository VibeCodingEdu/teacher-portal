/* יומן מורה: weekly schedule, lesson diary, absences and substitutes.
   Talks to the bot's own server (/api/...). No framework. */
(() => {
  "use strict";

  const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData
    ? window.Telegram.WebApp : null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const state = { weekOf: todayISO(), week: null, selDay: null, absDate: todayISO(), meta: null };

  // ── helpers ──────────────────────────────────────────────────────────
  function todayISO() { return iso(new Date()); }
  function iso(d) {
    const z = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }
  function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); }
  function dm(s) { const d = parseISO(s); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; }
  function dayName(s) { return DAYS[parseISO(s).getDay()]; }

  /** h("div.cls", {attrs}, ...children) */
  function h(tag, attrs, ...kids) {
    const [name, ...cls] = tag.split(".");
    const el = document.createElement(name || "div");
    if (cls.length) el.className = cls.join(" ");
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === "class") el.className += " " + v;
      else if (k === "value") el.value = v;
      else if (k === "checked" || k === "disabled" || k === "selected") el[k] = !!v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  // ── icons (drawn, not emoji) ────────────────────────────────────────
  const ICONS = {
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
    sheet: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M4 9h16M4 14h16M10 3.5v17"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    auto: '<rect x="3.5" y="4.5" width="17" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    prev: '<path d="M9 5l7 7-7 7"/>',
    next: '<path d="M15 5l-7 7 7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    pencil: '<path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z"/><path d="m14.5 6.5 3 3"/>',
    trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 12h8l1-12M10.5 11v5M13.5 11v5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/>',
  };
  function icon(name) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.setAttribute("viewBox", "0 0 24 24"); el.setAttribute("aria-hidden", "true");
    el.innerHTML = ICONS[name];
    return el;
  }

  // ── subject inks: every subject keeps its own muted color ───────────
  const INKS = ["#2f5d8a", "#8a5a2b", "#4c7a46", "#9b3d55", "#6a5596", "#2c7d76", "#a8741f", "#56606b", "#7b4a7a", "#3d6f9e"];
  function inkOf(subject) {
    let h = 0;
    for (const ch of subject || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return INKS[h % INKS.length];
  }

  // ── motion (apple-design) ────────────────────────────────────────────
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /** A spring that starts from the current value and velocity, so it can be
      grabbed and re-targeted at any moment. response = seconds, damping 1 =
      no overshoot. Velocity in px/s. */
  function spring(from, to, { response = 0.35, damping = 1, velocity = 0 } = {}, onUpdate, onDone) {
    const k = Math.pow(2 * Math.PI / response, 2), c = 4 * Math.PI * damping / response;
    let x = from, v = velocity, last = performance.now(), raf = 0, stopped = false;
    let frames = 0;
    const step = now => {
      if (stopped) return;
      frames++;
      // Dropped frames (a background tab) jump ahead; small sub-steps keep it stable.
      const dt = Math.min(0.5, (now - last) / 1000); last = now;
      const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;  // ≤ 4 ms per step
      for (let i = 0; i < n; i++) { const a = -k * (x - to) - c * v; v += a * h; x += v * h; }
      if (Math.abs(v) < 4 && Math.abs(x - to) < 0.4) {
        stopped = true; clearInterval(watchdog); onUpdate(to); if (onDone) onDone(); return;
      }
      onUpdate(x);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // No frames at all (hidden tab, app in background): settle at once.
    let ticks = -1;
    const watchdog = setInterval(() => {
      if (stopped) { clearInterval(watchdog); return; }
      if (ticks === frames) { stopped = true; cancelAnimationFrame(raf); clearInterval(watchdog); onUpdate(to); if (onDone) onDone(); }
      ticks = frames;
    }, 150);
    return { stop() { stopped = true; cancelAnimationFrame(raf); clearInterval(watchdog); }, get velocity() { return v; } };
  }
  /** Where a flick would come to rest (Apple's projection, d ≈ 0.998). */
  const project = (v, d = 0.998) => (v / 1000) * d / (1 - d);
  /** Soft resistance past an edge. */
  const rubberband = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
  /** A short haptic tick in Telegram, only on meaningful moments. */
  function haptic(kind) {
    try {
      if (!tg || !tg.HapticFeedback) return;
      if (kind === "success" || kind === "error" || kind === "warning") tg.HapticFeedback.notificationOccurred(kind);
      else tg.HapticFeedback.impactOccurred(kind || "light");
    } catch (e) { /* older Telegram */ }
  }
  // iOS Safari shows :active only when a touch listener exists.
  document.addEventListener("touchstart", () => {}, { passive: true });
  // Translucent header: the edge appears only once content scrolls under it.
  window.addEventListener("scroll", () => { const t = $(".top"); if (t) t.classList.toggle("scrolled", window.scrollY > 2); }, { passive: true });

  const absCache = new Map();          // "from|to" -> { t, days }: the absences just read (30 seconds)
  // ── teacher mode: the same diary, speaking to the bot's /diary line with the teacher's own login ──
  const DY = { dt: "", q: new URLSearchParams(location.search) };
  const dyCfg = () => window.PORTAL_CONFIG || {};
  async function dyCard() {
    if (DY.q.get("dt")) { DY.dt = DY.q.get("dt"); return; }          // local testing only: a card given in the address
    const tok = sessionStorage.getItem("tp_token");
    if (!tok) throw new Error("צריך להתחבר מחדש בדף");
    const r = await fetch(dyCfg().scriptUrl, { method: "POST", body: JSON.stringify({ action: "diaryCard", token: tok }) });
    const q = await r.json();
    if (!q.ok) throw new Error(q.message || "היומן האישי עוד לא הופעל עבורך");
    DY.dt = q.dt;
  }
  async function dyCall(op, p = {}, again = true) {
    const base = DY.q.get("bot") || dyCfg().botUrl;
    if (!base) throw new Error("היומן עוד לא מחובר");
    if (!DY.dt) await dyCard();
    let res;
    try { res = await fetch(base + "/diary", { method: "POST", body: JSON.stringify({ dt: DY.dt, op, ...p }) }); }
    catch (e) { throw new Error("היומן לא זמין כרגע. אפשר להשתמש באתר של סמארט סקול"); }
    if (res.status === 401 && again) { DY.dt = ""; return dyCall(op, p, false); }
    if (res.status === 404) throw new Error("היומן האישי כבוי כרגע");
    const q = await res.json().catch(() => ({}));
    if (!q.ok) {
      const e = new Error(q.error || "משהו השתבש");
      e.notConnected = !!q.notConnected;
      if (e.notConnected) showConnect();
      throw e;
    }
    return q;
  }
  async function api(path, opts = {}) {
    const u = new URL(path, location.href), q = u.searchParams, post = (opts.method || "GET") !== "GET";
    if (u.pathname === "/api/auth") return { ok: true };
    if (u.pathname === "/api/week") return dyCall("week", { date: q.get("date") });
    if (u.pathname === "/api/lesson") return post ? dyCall("save", { url: opts.body.url, draft: opts.body.draft }) : dyCall("lesson", { url: q.get("url") });
    if (u.pathname === "/api/event") return post ? dyCall("eventSave", { url: opts.body.url, draft: opts.body.draft }) : dyCall("event", { url: q.get("url") });
    throw new Error("זה לא זמין ביומן האישי");
  }
  /** First visit (or after "ניתוק"): the one-time connection to סמארט סקול. */
  function showConnect(msg = "") {
    let el = document.getElementById("dyConnect");
    if (!el) { el = h("div.login", { id: "dyConnect" }); document.body.append(el); }
    const user = h("input", { type: "text", autocomplete: "username", autocapitalize: "off", spellcheck: "false", dir: "ltr", placeholder: "שם משתמש בסמארט סקול", required: true });
    const pass = h("input", { type: "password", autocomplete: "current-password", dir: "ltr", placeholder: "סיסמה בסמארט סקול", required: true });
    const err = h("p.error", null, msg);
    const go = h("button.btn.primary.wide", { type: "submit" }, "חיבור");
    el.replaceChildren(h("form.login-card", { on: { submit: async e => {
      e.preventDefault(); err.textContent = ""; go.disabled = true; go.textContent = "מתחבר לסמארט סקול…";
      try { await dyCall("connect", { user: user.value.trim(), pass: pass.value }); pass.value = ""; el.remove(); loadWeek(); }
      catch (ex) { err.textContent = ex.message; go.disabled = false; go.textContent = "חיבור"; }
    } } },
      h("div.brand.big", null, h("span", null, "היומן שלי")),
      h("p.muted", null, "חיבור חד-פעמי לסמארט סקול. הפרטים נשמרים מוצפנים בשרת הבוט של בית הספר, ומשמשים רק לפתיחת היומן שלך. אפשר למחוק אותם בכל רגע."),
      user, pass, go, err));
    user.focus();
  }
  function dyInit() {
    const bar = document.querySelector("#view-week .toolbar");
    if (bar) bar.append(h("button.btn.ghost", { type: "button", on: { click: async () => {
      if (!confirm("הסיסמה שלך תימחק מהשרת, ותצטרך להתחבר שוב כדי לראות את היומן. הנתונים בסמארט סקול לא ישתנו. להמשיך?")) return;
      try { await dyCall("disconnect"); } catch (e) { toast(e.message, true); return; }
      showConnect();
    } } }, "ניתוק ומחיקת הסיסמה"));
  }

  let toastTimer;
  function toast(msg, bad = false) {
    haptic(bad ? "error" : (msg.startsWith("✓") ? "success" : null));
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (bad ? " bad" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), bad ? 6000 : 3200);
  }
  /** Put children in an element; empty ones (null / false) are skipped, never shown as "null". */
  function put(el, ...kids) { el.replaceChildren(...kids.flat().filter(k => k !== null && k !== undefined && k !== false)); return el; }

  // ── look: follow the system, or light, or dark (one icon button) ────────
  const THEME_LABEL = { auto: "מצב תצוגה: לפי המערכת", light: "מצב תצוגה: בהיר", dark: "מצב תצוגה: כהה" };
  const THEME_ICON = { auto: "auto", light: "sun", dark: "moon" };
  function themeMode() { try { const t = localStorage.getItem("diaryTheme"); return t === "light" || t === "dark" ? t : "auto"; } catch (e) { return "auto"; } }
  function applyTheme(mode) {
    const root = document.documentElement;
    if (mode === "light" || mode === "dark") root.dataset.theme = mode;
    else if (tg && tg.colorScheme) root.dataset.theme = tg.colorScheme === "dark" ? "dark" : "light";
    else delete root.dataset.theme;
    const btn = $("#themeBtn");
    if (btn) { put(btn, icon(THEME_ICON[mode])); btn.setAttribute("aria-label", THEME_LABEL[mode]); btn.title = THEME_LABEL[mode]; }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", getComputedStyle(document.body).backgroundColor);
  }
  $("#themeBtn").addEventListener("click", () => {
    const order = ["auto", "light", "dark"], next = order[(order.indexOf(themeMode()) + 1) % 3];
    try { next === "auto" ? localStorage.removeItem("diaryTheme") : localStorage.setItem("diaryTheme", next); } catch (e) { /* private mode */ }
    applyTheme(next);
  });
  if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(themeMode()));
  function loading(text = "טוען…") { return h("div.loading", null, h("div.spinner"), text); }

  // ── calendar picker ─────────────────────────────────────────────────
  const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  const heb = (() => { try { return new Intl.DateTimeFormat("he-u-ca-hebrew", { day: "numeric", month: "long", year: "numeric" }); } catch (e) { return null; } })();
  const hebMonth = (() => { try { return new Intl.DateTimeFormat("he-u-ca-hebrew", { month: "long", year: "numeric" }); } catch (e) { return null; } })();
  const hebDay = (() => { try { return new Intl.DateTimeFormat("he-u-ca-hebrew", { day: "numeric" }); } catch (e) { return null; } })();
  /** Hebrew numerals: 24 -> כ״ד, 5787 -> תשפ״ז. */
  function gematria(n) {
    if (n >= 1000) n %= 1000;
    const H = [[400, "ת"], [300, "ש"], [200, "ר"], [100, "ק"], [90, "צ"], [80, "פ"], [70, "ע"], [60, "ס"], [50, "נ"],
      [40, "מ"], [30, "ל"], [20, "כ"], [10, "י"], [9, "ט"], [8, "ח"], [7, "ז"], [6, "ו"], [5, "ה"], [4, "ד"], [3, "ג"], [2, "ב"], [1, "א"]];
    let out = "";
    for (const [v, c] of H) while (n >= v) { out += c; n -= v; }
    out = out.replace("יה", "טו").replace("יו", "טז");
    return out.length > 1 ? out.slice(0, -1) + "״" + out.slice(-1) : out + "׳";
  }
  const hebParts = d => {
    try {
      const p = new Intl.DateTimeFormat("he-u-ca-hebrew-nu-latn", { day: "numeric", month: "long", year: "numeric" }).formatToParts(d);
      const get = t => (p.find(x => x.type === t) || {}).value;
      return { day: gematria(+get("day")), month: get("month"), year: gematria(+get("year")) };
    } catch (e) { return null; }
  };
  let openPop = null;
  function closePop() { if (openPop) { openPop.remove(); openPop = null; } }
  document.addEventListener("mousedown", e => { if (openPop && !openPop.contains(e.target) && !e.target.closest(".dp-btn")) closePop(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closePop(); });

  /** A button showing a date; a click opens a month calendar. */
  function datePicker({ value, onPick, allowSat = false, label = "" }) {
    let cur = value;
    const text = h("span");
    const btn = h("button.dp-btn", { type: "button", "aria-haspopup": "dialog" }, icon("cal"), text);
    const paint = () => { text.textContent = (label ? label + " " : "") + `${dayName(cur)} ${dm(cur)}`; };
    paint();
    btn.addEventListener("click", () => {
      if (openPop && openPop.owner === btn) { closePop(); return; }
      closePop();
      let view = parseISO(cur); view.setDate(1);
      const pop = h("div.dp-pop", { role: "dialog", "aria-label": "בחירת תאריך" });
      pop.owner = btn;
      const draw = () => {
        const y = view.getFullYear(), m = view.getMonth();
        const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
        const cells = [];
        for (let i = 0; i < first.getDay(); i++) cells.push(h("span.dp-blank"));
        for (let dd = 1; dd <= days; dd++) {
          const d = new Date(y, m, dd), id = iso(d), sat = d.getDay() === 6;
          cells.push(h("button.dp-day", {
            type: "button", disabled: sat && !allowSat,
            class: (id === cur ? "sel" : "") + (id === todayISO() ? " today" : "") + (sat ? " sat" : ""),
            title: (() => { const x = hebParts(d); return x ? `${x.day} ${x.month} ${x.year}` : ""; })(),
            on: { click: () => { cur = id; paint(); closePop(); onPick(id); } },
          }, h("b", null, dd), (() => { const x = hebParts(d); return x ? h("small", null, x.day) : null; })()));
        }
        pop.replaceChildren(
          h("div.dp-head", null,
            h("button.dp-nav", { type: "button", "aria-label": "חודש קודם", on: { click: () => { view.setMonth(view.getMonth() - 1); draw(); } } }, "→"),
            h("div.dp-title", null, `${MONTHS[m]} ${y}`, (() => {
              const a = hebParts(new Date(y, m, 1)), b = hebParts(new Date(y, m, days));
              if (!a) return null;
              return h("small", null, a.month === b.month ? `${a.month} ${a.year}` : `${a.month}–${b.month} ${b.year}`);
            })()),
            h("button.dp-nav", { type: "button", "aria-label": "חודש הבא", on: { click: () => { view.setMonth(view.getMonth() + 1); draw(); } } }, "←")),
          h("div.dp-week", null, ["א", "ב", "ג", "ד", "ה", "ו", "ש"].map(x => h("span", null, x))),
          h("div.dp-grid", null, cells),
          h("div.dp-foot", null, h("button.btn.ghost", { type: "button", on: { click: () => {
            const t = todayISO(); cur = t; paint(); closePop(); onPick(t);
          } } }, "היום")));
      };
      draw();
      document.body.append(pop);
      const r = btn.getBoundingClientRect(), w = Math.min(300, window.innerWidth - 16);
      pop.style.width = w + "px";
      const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
      pop.style.left = left + "px";
      pop.style.setProperty("--origin", `${Math.max(0, Math.min(w, r.left + r.width / 2 - left))}px top`);
      pop.style.top = Math.min(r.bottom + 6, window.innerHeight - 380) + "px";
      openPop = pop;
    });
    btn.setValue = v => { cur = v; paint(); };
    btn.getValue = () => cur;
    return btn;
  }

  // ── login ────────────────────────────────────────────────────────────
  function showLogin() {
    $("#app").classList.add("hidden");
    $("#login").classList.remove("hidden");
    $("#password").focus();
  }
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#loginError").textContent = "";
    try {
      await api("/api/login", { method: "POST", body: { password: $("#password").value } });
      $("#login").classList.add("hidden");
      start();
    } catch (err) { $("#loginError").textContent = err.message; }
  });

  // ── tabs ─────────────────────────────────────────────────────────────
  document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === b));
    const v = b.dataset.view;
    $("#view-week").classList.toggle("hidden", v !== "week");
    $("#view-absences").classList.toggle("hidden", v !== "absences");
    $("#view-tt").classList.toggle("hidden", v !== "tt");
    $("#view-fills").classList.toggle("hidden", v !== "fills");
    if (v === "fills") loadFills();
    if (v === "absences") loadAbsences();
    if (v === "tt") loadTT();
  }));


  // ── covered lessons: everyone, summed per teacher ─────────────────────
  const fills = { from: null, to: null, group: "who", teacher: "", data: null, ready: false };
  function schoolYearStart() { const t = new Date(); return `${t.getMonth() >= 8 ? t.getFullYear() : t.getFullYear() - 1}-09-01`; }
  function monthRange(offset) {
    const t = new Date(); const a = new Date(t.getFullYear(), t.getMonth() + offset, 1), b = new Date(t.getFullYear(), t.getMonth() + offset + 1, 0);
    return [iso(a), iso(b)];
  }
  function hebShortISO(s) { const p = hebParts(parseISO(s)); return p ? `${p.day} ב${p.month}` : ""; }

  async function loadFills() {
    const bar = $("#fillsBar"), out = $("#fillsOut");
    if (!fills.ready) {
      [fills.from, fills.to] = monthRange(0);
      fills.ready = true;
    }
    async function fetchRows() {
      out.replaceChildren(loading("קורא את מילויי המקום משוטף…"));
      try { fills.data = await api(`/api/fills?from=${fills.from}&to=${fills.to}`); }
      catch (err) { out.replaceChildren(h("div.empty-state", null, err.message)); return; }
      paintOut();
    }
    function setRange(a, b) { fills.from = a; fills.to = b; paintBar(); fetchRows(); }
    function paintBar() {
      const m0 = monthRange(0), m1 = monthRange(-1);
      const is = (a, b) => fills.from === a && fills.to === b;
      const chip = (t, a, b) => h("button.chip", { type: "button", class: is(a, b) ? "on" : "", on: { click: () => setRange(a, b) } }, t);
      const seg = h("div.seg-scroll", null, h("div.seg", { role: "tablist", "aria-label": "סיכום לפי" }, [["who", "מורה"], ["month", "חודש"], ["day", "יום"], ["cls", "כיתה"], ["inst", "במקום מי"]].map(([k, t]) =>
        h("button", { type: "button", role: "tab", class: fills.group === k ? "on" : "", on: { click: () => { fills.group = k; paintBar(); paintOut(); } } }, t))));
      const dl = h("button.btn.dl", { type: "button", on: { click: async () => {
        dl.disabled = true; const keep = [...dl.childNodes]; put(dl, "מכין…");
        try {
          const q = `from=${fills.from}&to=${fills.to}`;
          if (tg) { await api(`/api/fills?${q}&format=telegram`); toast("✓ הדוח נשלח אליך בטלגרם"); }
          else {
            const res = await fetch(`/api/fills?${q}&format=xlsx`, { credentials: "same-origin" });
            if (!res.ok) throw new Error(`שגיאה (${res.status})`);
            const a = h("a", { href: URL.createObjectURL(await res.blob()), download: `מילויי-מקום-${fills.from}-${fills.to}.xlsx` });
            document.body.append(a); a.click(); a.remove(); toast("✓ הקובץ ירד");
          }
        } catch (err) { toast(err.message, true); }
        dl.disabled = false; put(dl, ...keep);
      } } }, icon("download"), tg ? "בטלגרם" : "אקסל");
      fills.dl = dl;
      bar.replaceChildren(
        h("div.chips", null, chip("החודש", ...m0), chip("חודש קודם", ...m1), chip("כל השנה", schoolYearStart(), iso(new Date()))),
        h("div.fills-dates", null,
          datePicker({ value: fills.from, allowSat: true, label: "מתאריך", onPick: d => setRange(d, fills.to < d ? d : fills.to) }),
          datePicker({ value: fills.to, allowSat: true, label: "עד", onPick: d => setRange(fills.from > d ? d : fills.from, d) })),
        seg);
    }
    function paintOut() {
      const rows0 = (fills.data && fills.data.rows) || [];
      const teachers = [...new Set(rows0.map(r => r.sub).filter(Boolean))].sort((a, b) => a.localeCompare(b, "he"));
      const rows = rows0.filter(r => !fills.teacher || r.sub === fills.teacher);
      const today = (fills.data && fills.data.today) || todayISO();
      const sel = h("select.input", { "aria-label": "מורה", on: { change: e => { fills.teacher = e.target.value; paintOut(); } } },
        h("option", { value: "" }, "כל המורים"), teachers.map(t => h("option", { value: t, selected: fills.teacher === t }, t)));
      const stats = h("div.stats", null,
        h("div.stat", null, h("b", null, rows.length), h("span", null, "שעות")),
        h("div.stat", null, h("b", null, new Set(rows.map(r => r.sub)).size), h("span", null, "מורים")),
        h("div.stat", null, h("b", null, rows.filter(r => r.type === "שעה נוספת").length), h("span", null, "שעות נוספות")));
      const keyOf = r => {
        switch (fills.group) {
          case "who": return [r.sub || "—", r.sub || "ללא שם", 1];
          case "month": { const d = parseISO(r.iso); return [r.iso.slice(0, 7), `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, 0]; }
          case "day": return [r.iso, `${dayName(r.iso)} ${dm(r.iso)} · ${hebShortISO(r.iso)}`, 0];
          case "cls": return [r.classes || "—", r.classes || "ללא כיתה", 1];
          default: return [r.instead || "—", r.instead ? `במקום ${r.instead}` : "ללא מורה נעדר", 1];
        }
      };
      const groups = new Map();
      rows.forEach(r => { const [k, label, mode] = keyOf(r); (groups.get(k) || groups.set(k, { k, label, mode, rows: [] }).get(k)).rows.push(r); });
      const arr = [...groups.values()].sort((a, b) => a.mode === 0 ? b.k.localeCompare(a.k) : b.rows.length - a.rows.length || a.label.localeCompare(b.label, "he"));
      const rowEl = r => h("div.fl-row", { class: r.iso > today ? "future" : "" },
        h("b", null, `${dayName(r.iso)} ${dm(r.iso)}`), h("span.muted", null, hebShortISO(r.iso)),
        h("span", null, `שעה ${r.hour}`),
        fills.group === "who" ? null : h("span", null, r.sub),
        h("span", null, [r.classes, r.subject].filter(Boolean).join(" · ")),
        r.instead && fills.group !== "inst" ? h("span.muted", null, `במקום ${r.instead}`) : null,
        r.type === "שעה נוספת" ? h("span.tag", null, "שעה נוספת") : null,
        r.iso > today ? h("span.tag", null, "בקרוב") : null);
      out.replaceChildren(h("div.fills-top", null, sel, fills.dl), stats,
        ...(arr.length ? arr.map(g => h("details.fl-group", null,
          h("summary", null, h("span", null, g.label), h("span.count", null, `${g.rows.length} ${g.rows.length === 1 ? "שעה" : "שעות"}`)),
          h("div.fl-list", null, g.rows.slice().sort((a, b) => b.iso.localeCompare(a.iso) || a.hour - b.hour).map(rowEl))))
          : [h("div.empty-state", null, "אין מילויי מקום בטווח הזה")]));
    }
    paintBar();
    if (!fills.data) fetchRows(); else paintOut();
  }

  // ── week ─────────────────────────────────────────────────────────────
  $("#prevWeek").onclick = () => { state.weekOf = addDays(state.weekOf, -7); loadWeek(); };
  $("#nextWeek").onclick = () => { state.weekOf = addDays(state.weekOf, 7); loadWeek(); };
  $("#thisWeek").onclick = () => { state.weekOf = todayISO(); state.selDay = null; weekPicker.setValue(todayISO()); loadWeek(); };
  const weekPicker = datePicker({ value: todayISO(), label: "מעבר ל:", onPick: d => {
    state.weekOf = d; state.selDay = d; loadWeek(); } });
  $("#thisWeek").after(weekPicker);

  function kindOf(item) {
    const s = item.status || "", t = item.text || "";
    if (item.kind === "lesson") return "lesson";
    if (s.includes("פרטני") || t.startsWith("פרטני")) return "k-private";
    if (s.includes("שהייה") || t.startsWith("שהייה")) return "k-stay";
    if (s.includes("אישי")) return "k-event";
    return "k-other";
  }
  function lessonState(item) {
    const s = item.status || "";
    if (s === "הוזן דוח") return "done";
    if (s === "טרם הוזן דוח") return "todo";
    if (s === "שיעור שבוטל") return "cancel";
    return "future";
  }
  function weekTeacher(w) {
    if (w.teacher) return w.teacher;
    const count = {};
    for (const d of w.days) for (const x of d.hours) for (const it of x.items)
      if (it.kind === "lesson" && it.lines && it.lines[0]) count[it.lines[0]] = (count[it.lines[0]] || 0) + 1;
    return Object.entries(count).sort((a, b) => b[1] - a[1]).map(e => e[0])[0] || "";
  }
  function lessonParts(item, teacher) {
    const all = (item.lines || []).filter(l => !/^\d+$/.test(l));
    // A substitution starts with "מילוי מקום ע"י <who>". When <who> is me, I am
    // covering for the teacher on the next line (swap). Otherwise someone else
    // covered my own lesson while I was away (covered).
    const subLine = all.find(l => l.startsWith("מילוי מקום"));
    if (subLine) {
      const by = subLine.replace(/^מילוי מקום\s*(ע["״]י)?\s*/, "").trim();
      const rest = all.filter(l => l !== subLine);
      if (!by || by === teacher) {
        const r = rest.filter(l => l !== teacher);
        if (r.length >= 3) return { subject: r[1], cls: r[2], sub: `במקום ${r[0]}`, swap: true, absent: r[0] };
        return { subject: r[0] || "מילוי מקום", cls: r.slice(1).join(" · "), sub: "מילוי מקום", swap: true };
      }
      const r = rest.filter(l => l !== teacher);
      return { subject: r[0] || "שיעור", cls: r.slice(1).join(" · "), sub: `ממלא מקום: ${by}`, covered: true };
    }
    const lines = all.filter(l => l !== teacher);
    return { subject: lines[0] || "שיעור", cls: lines.slice(1).join(" · "), sub: "" };
  }
  const swapIcon = () => {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("class", "swap-ic"); svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M20 8a8 8 0 0 0-14.3-3M4 4v4h4M4 16a8 8 0 0 0 14.3 3M20 20v-4h-4");
    svg.append(path); return svg;
  };

  async function loadWeek() {
    const grid = $("#grid");
    grid.replaceChildren(loading());
    $("#weekLabel").textContent = "טוען…";
    try {
      const w = await api(`/api/week?date=${state.weekOf}`);
      w.teacher = weekTeacher(w);
      state.week = w;
      $("#who").textContent = w.teacher || "";
      renderWeek();
    } catch (err) {
      grid.replaceChildren(h("div.empty-state", null, err.message));
    }
  }

  function renderWeek() {
    const w = state.week, grid = $("#grid");
    const days = w.days;
    if (!days.length) { grid.replaceChildren(h("div.empty-state", null, "אין מערכת בשבוע הזה")); return; }
    $("#weekLabel").textContent = `${dm(days[0].date)} עד ${dm(days[days.length - 1].date)}`;
    {
      const a = parseISO(days[0].date), b = parseISO(days[days.length - 1].date);
      const month = a.getMonth() === b.getMonth() ? MONTHS[a.getMonth()] : `${MONTHS[a.getMonth()]}–${MONTHS[b.getMonth()]}`;
      const ha = hebParts(a), hb = hebParts(b);
      const heb = ha && hb ? (ha.month === hb.month ? `${ha.day}–${hb.day} ב${ha.month} ${hb.year}` : `${ha.day} ב${ha.month} – ${hb.day} ב${hb.month} ${hb.year}`) : "";
      $("#weekTitle").replaceChildren(
        h("span.wt-main", null, `${month} `, h("bdi.wt-days", { dir: "ltr" }, `${a.getDate()}–${b.getDate()}`)),
        heb ? h("span.wt-heb", null, heb) : null);
    }
    const today = todayISO();
    if (!state.selDay || !days.some(d => d.date === state.selDay)) {
      state.selDay = (days.find(d => d.date === today) || days.find(d => d.date > today) || days[0]).date;
    }
    // phone: one day at a time
    $("#dayChips").replaceChildren(...days.map(d => h("button.day-chip", {
      class: (d.date === state.selDay ? "active" : "") + (d.date === today ? " today" : ""),
      on: { click: () => { state.selDay = d.date; renderWeek(); } },
    }, `${dayName(d.date)} ${dm(d.date)}`)));

    requestAnimationFrame(() => { const a = $("#dayChips .active"); if (a) a.scrollIntoView({ inline: "center", block: "nearest" }); });
    const hours = [...new Set(days.flatMap(d => d.hours.filter(x => x.items.length).map(x => x.hour)))].sort((a, b) => a - b);
    grid.style.setProperty("--days", days.length);
    const kids = [h("div")];
    for (const d of days) {
      const hp = hebParts(parseISO(d.date));
      kids.push(h("div.g-head", { class: (d.date === today ? "today" : "") + (d.date === state.selDay ? " sel" : "") },
        h("span.gh-day", null, dayName(d.date)),
        h("span.gh-num", null, parseISO(d.date).getDate()),
        hp ? h("span.gh-heb", null, `${hp.day} ${hp.month}`) : null));
    }
    if (!hours.length) {
      grid.replaceChildren(...kids, h("div.empty-state", null, "אין שיעורים בשבוע הזה"));
      return;
    }
    for (const hr of hours) {
      kids.push(h("div.g-hour", null, hr));
      for (const d of days) {
        const cell = h("div.g-cell", { class: (d.date === today ? "today" : "") + (d.date === state.selDay ? " sel" : "") });
        const slot = d.hours.find(x => x.hour === hr);
        const items = slot ? slot.items : [];
        if (!items.length) cell.append(h("div.empty-slot"));
        for (const it of items) cell.append(renderSlot(it, d.date, hr, w.teacher));
        kids.push(cell);
      }
    }
    grid.replaceChildren(...kids);
  }

  function renderSlot(it, date, hour, teacher) {
    const k = kindOf(it);
    if (k !== "lesson") {
      const [title, ...rest] = (it.text || "").split(" - ");
      const parts = [...new Set(rest.join(" - ").split(/[,(]/).map(x => x.replace(/\)/g, "").trim())
        .filter(x => x && x !== title.trim()))];
      const kids2 = [h("div.s-title", null, title), parts.length ? h("div.s-sub", null, parts.slice(0, 2).join(" · ")) : null];
      if (!it.eventUrl) return h("div.slot", { class: k, title: it.text }, ...kids2);
      return h("button.slot", { class: k, title: it.text, on: { click: () => openEvent(it, date, hour, title) } }, ...kids2);
    }
    const p = lessonParts(it, teacher), st = lessonState(it);
    const label = { done: "הוזן דוח", todo: "טרם הוזן דוח", future: "טרם התקיים", cancel: "בוטל" }[st];
    return h("button.slot.lesson", {
      class: st + (p.swap ? " swap" : "") + (p.covered ? " covered" : ""),
      style: `--subj:${inkOf(p.subject)}`, on: { click: () => openLesson(it, date, hour, p) },
      "aria-label": `${p.swap ? "מילוי מקום: " : ""}${p.subject} ${p.cls}, שעה ${hour}, ${label}`,
      title: p.swap ? `מילוי מקום ${p.sub} · ${label}` : label,
    },
      h("div.s-title", null, p.swap ? swapIcon() : null, p.subject, h("i.mark-st", { class: st, "aria-hidden": "true" })),
      h("div.s-sub", null, [p.cls, p.sub].filter(Boolean).join(" · ") || label));
  }

  // ── sheet (side panel) ──────────────────────────────────────────────
  // Enters and leaves along the same path (from the start edge). It rides a
  // spring that starts from where it is now, so a close can be grabbed back.
  // On the header it follows the finger 1:1 and a flick closes it.
  let sheetGuard = null;
  const sheetEl = $("#sheet"), backdrop = $("#sheetBackdrop");
  const sheetState = { x: 0, anim: null, open: false, closing: false };
  const sheetW = () => sheetEl.offsetWidth || window.innerWidth;
  // RTL: the panel sits on the right, so "away" is +x.
  const awaySign = () => (getComputedStyle(document.documentElement).direction === "rtl" ? 1 : -1);
  function sheetSet(x) {
    sheetState.x = x;
    sheetEl.style.transform = `translate3d(${x * awaySign()}px,0,0)`;
    backdrop.style.opacity = String(Math.max(0, Math.min(1, 1 - x / sheetW())));
  }
  function sheetTo(target, opts, done) {
    if (sheetState.anim) sheetState.anim.stop();
    if (reduceMotion.matches) {  // gentle cross-fade instead of a slide
      sheetEl.style.transition = backdrop.style.transition = "opacity .2s ease";
      sheetEl.style.transform = "none";
      requestAnimationFrame(() => {
        sheetEl.style.opacity = backdrop.style.opacity = target === 0 ? "1" : "0";
      });
      sheetState.x = target;
      setTimeout(() => { sheetEl.style.transition = backdrop.style.transition = ""; if (done) done(); }, 220);
      return;
    }
    sheetState.anim = spring(sheetState.x, target, opts, sheetSet, () => { sheetState.anim = null; if (done) done(); });
  }
  function openSheet(title, sub, body, foot) {
    const head = h("div.sh-head", null,
      h("div", null, h("h2", null, title), sub ? h("div.sub", null, sub) : null),
      h("button.icon-btn.close", { "aria-label": "סגירה", on: { click: closeSheet } }, icon("close")));
    attachSheetDrag(head);
    sheetEl.replaceChildren(...[head, h("div.sh-body", null, body),
      foot ? h("div.sh-foot", null, foot) : null].filter(Boolean));
    if (!sheetState.open || sheetState.closing) {
      // A close still in flight is re-targeted from where it is now.
      const fresh = !sheetState.open;
      sheetState.open = true; sheetState.closing = false;
      sheetEl.classList.remove("hidden"); backdrop.classList.remove("hidden");
      if (fresh) { sheetEl.style.opacity = reduceMotion.matches ? "0" : "1"; sheetSet(sheetW()); }
      const v = sheetState.anim ? sheetState.anim.velocity : 0;
      sheetTo(0, { response: 0.35, damping: 1, velocity: v });
      if (tg) tg.BackButton.show();
    }
  }
  function finishClose() {
    sheetState.open = false; sheetState.closing = false;
    sheetEl.classList.add("hidden"); backdrop.classList.add("hidden");
    if (tg) tg.BackButton.hide();
  }
  function closeSheet(velocity = 0) {
    if (!sheetState.open) return;
    if (sheetGuard && !sheetGuard()) { sheetTo(0, { response: 0.3, damping: 0.8 }); return; }
    sheetGuard = null;
    sheetState.closing = true;
    sheetTo(sheetW(), { response: 0.32, damping: 1, velocity: typeof velocity === "number" ? velocity : 0 }, finishClose);
  }
  function attachSheetDrag(head) {
    let id = null, startX = 0, grab = 0, moved = false, hist = [];
    head.addEventListener("pointerdown", e => {
      if (e.target.closest("button, a, input, select, textarea")) return;
      id = e.pointerId; head.setPointerCapture(id);
      if (sheetState.anim) { sheetState.anim.stop(); sheetState.anim = null; }  // grab it mid-flight
      startX = e.clientX; grab = sheetState.x; moved = false; hist = [{ t: e.timeStamp, x: sheetState.x }];
    });
    head.addEventListener("pointermove", e => {
      if (e.pointerId !== id) return;
      const dx = (e.clientX - startX) * awaySign();
      if (!moved && Math.abs(dx) < 10) return;  // small threshold before committing
      moved = true;
      let x = grab + dx;
      if (x < 0) x = rubberband(x, sheetW());   // soft edge when pulled further in
      sheetSet(x);
      hist.push({ t: e.timeStamp, x }); if (hist.length > 6) hist.shift();
    });
    const end = e => {
      if (e.pointerId !== id) return;
      id = null;
      if (!moved) return;
      const a = hist[0], b = hist[hist.length - 1];
      const v = b.t > a.t ? (b.x - a.x) / ((b.t - a.t) / 1000) : 0;
      const w = sheetW(), rest = sheetState.x + project(v);
      const close = Math.abs(v) > 400 ? v > 0 : rest > w * 0.45;  // velocity sign decides a flick
      if (close) closeSheet(v);
      else sheetTo(0, { response: 0.3, damping: 0.8, velocity: v });
    };
    head.addEventListener("pointerup", end);
    head.addEventListener("pointercancel", end);
  }
  backdrop.addEventListener("click", () => closeSheet());
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !openPop) closeSheet(); });
  if (tg) tg.BackButton.onClick(() => closeSheet());

  // ── lesson diary ────────────────────────────────────────────────────
  const NEG = new Set(["חיסור", "איחור", "הפרעה", "אי הבאת ציוד", "אי הכנת ש.ב"]);
  const WARN = new Set(["יציאה לפעילות בית-ספרית"]);
  const JUSTIFIABLE = new Set(["איחור", "חיסור"]);      // events that can be justified in the same save

  async function openLesson(it, date, hour, p) {
    const title = `${p.subject}${p.cls ? " · " + p.cls : ""}`;
    const sub = `${p.swap ? "⇄ מילוי מקום " + p.sub + " · " : ""}שעה ${hour} · יום ${dayName(date)} ${dm(date)}`;
    openSheet(title, sub, loading("פותח את דוח השיעור…"));
    let L;
    try { L = await api(`/api/lesson?url=${encodeURIComponent(it.url)}&key=${encodeURIComponent(title)}`); }
    catch (err) { openSheet(title, sub, h("div.empty-state", null, err.message)); return; }
    renderLesson(it.url, L, title, sub);
  }

  function renderLesson(url, L, title, sub) {
    const draft = { status: null, topicId: null, topicText: null, events: {}, remarks: {}, justify: {} };
    const eff = k => draft[k] !== null ? draft[k] : L[k];
    const evOf = (s, tid) => (draft.events[s.sid] && tid in draft.events[s.sid]) ? draft.events[s.sid][tid] : !!s.events[tid];
    const remOf = s => (s.sid in draft.remarks) ? draft.remarks[s.sid] : s.remark;
    const dirty = () => ["status", "topicId", "topicText"].some(k => draft[k] !== null)
      || Object.keys(draft.events).length || Object.keys(draft.remarks).length || Object.keys(draft.justify).length;
    const freeOpt = L.topicOptions.find(o => o.free);

    const statusSeg = h("div.seg");
    const topicSel = h("select", { "aria-label": "נושא השיעור" },
      h("option", { value: "" }, "— בחר נושא —"),
      L.topicOptions.map(o => h("option", { value: o.id, selected: o.id === L.topicId }, o.label)));
    // The free topic ("נושא לימוד אחר") is the default and its list is hidden:
    // only the "what was learned" box shows. A topic saved earlier from the
    // list is shown as text, so nothing changes unless the teacher edits it.
    const listTopic = L.topicOptions.find(o => o.id === L.topicId && !o.free);
    const topicText = h("textarea", { placeholder: "מה נלמד בשיעור", value: L.topicText || (listTopic ? listTopic.label : "") });
    const topicStart = topicText.value;
    const recent = (L.recentTopics || []).filter(t => t !== topicStart).slice(0, 4);
    const topicSuggest = freeOpt && recent.length ? h("div.chips.topic-suggest", null,
      h("span.muted", null, "מהשיעורים הקודמים:"),
      recent.map(t => h("button.chip", { type: "button", title: t, on: { click: () => {
        topicText.value = t; topicText.dispatchEvent(new Event("input")); haptic("light");
      } } }, t.length > 34 ? t.slice(0, 33) + "…" : t))) : null;
    const topicTextField = h("div.field", null,
      h("label", null, freeOpt ? "מה נלמד בשיעור" : "נושא לימוד אחר: מה נלמד"), topicText, topicSuggest);
    const footInfo = h("div.grow");
    const saveBtn = h("button.btn.primary", { on: { click: save } }, "שמירה");
    const resetBtn = h("button.btn.ghost", { on: { click: () => renderLesson(url, L, title, sub) } }, "ביטול שינויים");

    function syncTopic() {
      if (freeOpt) return;  // list hidden, the text box always shows
      const opt = L.topicOptions.find(o => o.id === eff("topicId"));
      topicTextField.classList.toggle("hidden", !(opt && opt.free));
    }
    function syncStatus() {
      statusSeg.replaceChildren(
        h("button", { class: eff("status") === "1" ? "on" : "", on: { click: () => setStatus("1") } }, "התקיים כרגיל"),
        h("button", { class: eff("status") === "0" ? "on" : "", on: { click: () => setStatus("0") } }, "בוטל"));
    }
    function setStatus(v) { draft.status = v === L.status ? null : v; syncStatus(); syncFoot(); }
    function syncFoot() {
      const n = Object.values(draft.events).reduce((a, x) => a + Object.keys(x).length, 0)
        + Object.keys(draft.remarks).length + Object.keys(draft.justify).length + ["status", "topicId", "topicText"].filter(k => draft[k] !== null).length;
      footInfo.textContent = !n ? "אין שינויים" : n === 1 ? "שינוי אחד שעוד לא נשמר" : `${n} שינויים שעוד לא נשמרו`;
      saveBtn.disabled = !n; resetBtn.disabled = !n;
    }
    topicSel.addEventListener("change", () => {
      draft.topicId = topicSel.value === L.topicId ? null : topicSel.value;
      const opt = L.topicOptions.find(o => o.id === topicSel.value);
      if (opt && opt.free) { topicText.focus(); } else { draft.topicText = null; }
      syncTopic(); syncFoot();
    });
    topicText.addEventListener("input", () => {
      if (topicText.value === topicStart) {
        draft.topicText = null; draft.topicId = null;
      } else {
        draft.topicText = topicText.value;
        if (freeOpt && L.topicId !== freeOpt.id) { draft.topicId = freeOpt.id; topicSel.value = freeOpt.id; }
      }
      syncFoot();
    });

    // students
    const list = h("div");
    function studentRow(s, i) {
      const row = h("div.stu");
      function paint() {
        const anyEv = L.types.some(t => evOf(s, t.id));
        const changed = (s.sid in draft.events) || (s.sid in draft.remarks);
        row.classList.toggle("changed", changed);
        const chips = h("div.chips", null, L.types.map(t => {
          const on = evOf(s, t.id);
          return h("button.chip", {
            class: on ? "on" + (NEG.has(t.label) ? " neg" : WARN.has(t.label) ? " warnc" : "") : "",
            "aria-pressed": on ? "true" : "false",
            on: { click: () => {
              const want = !evOf(s, t.id);
              const ev = draft.events[s.sid] = draft.events[s.sid] || {};
              if (want === !!s.events[t.id]) delete ev[t.id]; else ev[t.id] = want;
              if (!Object.keys(ev).length) delete draft.events[s.sid];
              if (!want) delete draft.justify[`${s.sid}:${t.id}`];
              haptic("light"); paint(); syncFoot();
            } },
          }, t.label);
        }));
        const note = anyEv ? h("div.stu-note", null, h("input", {
          type: "text", placeholder: "הערה (לא חובה)", value: remOf(s) || "", maxlength: "600",
          on: { input: e => {
            if (e.target.value === s.remark) delete draft.remarks[s.sid]; else draft.remarks[s.sid] = e.target.value;
            row.classList.toggle("changed", (s.sid in draft.events) || (s.sid in draft.remarks)); syncFoot();
          } },
        })) : null;
        // Justification, in the same save: for a late or absent student. Already justified events show as done.
        const asked = L.types.filter(t => JUSTIFIABLE.has(t.label) && evOf(s, t.id));
        const justRow = asked.length ? h("div.stu-just", null, asked.map(t => {
          const k = `${s.sid}:${t.id}`;
          if (s.justified && s.justified[t.id] === true && !(s.sid in draft.events && t.id in draft.events[s.sid])) {
            return h("span.just-done", null, icon("check"), `${t.label} מוצדק`);
          }
          const on = k in draft.justify;
          return h("div.just-item", null,
            h("button.chip.just", { type: "button", class: on ? "on" : "", "aria-pressed": on ? "true" : "false", on: { click: () => {
              if (on) delete draft.justify[k]; else draft.justify[k] = "";
              haptic("light"); paint(); syncFoot();
            } } }, `הצדקה ל${t.label}`),
            on ? h("label.just-note", null, h("span", null, "הערה להצדקה (לא חובה)"),
              h("input", { type: "text", maxlength: "250", value: draft.justify[k], on: { input: e => { draft.justify[k] = e.target.value; } } })) : null);
        })) : null;
        row.replaceChildren(...[h("div.stu-top", null, h("span.stu-num", null, i + 1), h("span.stu-name", null, s.name)), chips, justRow, note].filter(Boolean));
      }
      paint();
      return row;
    }
    list.append(...L.students.map(studentRow));

    async function save() {
      saveBtn.disabled = true; saveBtn.textContent = "שומר…";
      try {
        const res = await api("/api/lesson", { method: "POST", body: { url, draft, key: title } });
        sheetGuard = null;
        const jm = res.justified && res.justified.missed ? res.justified.missed.length : 0;
        if (res.missed && res.missed.length) {
          toast("נשמר, אבל לא נקלטו: " + res.missed.join(", "), true);
          renderLesson(url, res.lesson, title, sub);  // stay open to show what is missing
        } else if (jm) {
          toast(`נשמר, אבל ${jm} הצדקות לא נרשמו. כדאי לבדוק בסמארט סקול`, true);
          renderLesson(url, res.lesson, title, sub);
        } else {
          toast(res.justified && res.justified.done ? `✓ נשמר, ${res.justified.done} הצדקות נרשמו` : "✓ נשמר");
          closeSheet();
        }
        loadWeek();
      } catch (err) {
        toast(err.refused ? "לא נשמר: " + err.message : err.message, true);
        saveBtn.disabled = false; saveBtn.textContent = "שמירה";
      }
    }

    const body = h("div", null,
      freeOpt ? null : h("div.field", null, h("label", null, "נושא השיעור"), topicSel),
      topicTextField,
      h("div.students-head", null, h("h3", null, "תלמידים"), h("span.muted", null, `${L.students.length} בכיתה · לחיצה על אירוע מסמנת או מבטלת`)),
      list);
    openSheet(title, sub, body, [footInfo, resetBtn, saveBtn]);
    sheetGuard = () => !dirty() || confirm("יש שינויים שלא נשמרו. לסגור בלי לשמור?");
    syncTopic(); syncFoot();
  }

  // ── non-frontal hour (פרטני, שהייה, תפקיד…) ─────────────────────────
  async function openEvent(it, date, hour, title) {
    const sub = `שעה ${hour} · יום ${dayName(date)} ${dm(date)}`;
    openSheet(title, sub, loading("פותח את השעה…"));
    let E;
    try { E = await api(`/api/event?url=${encodeURIComponent(it.eventUrl)}`); }
    catch (err) { openSheet(title, sub, h("div.empty-state", null, err.message)); return; }
    let status = E.status;
    const seg = h("div.seg");
    const paintSeg = () => seg.replaceChildren(
      h("button", { class: status === "1" ? "on" : "", on: { click: () => { status = "1"; paintSeg(); } } }, "התקיים"),
      h("button", { class: status === "0" ? "on" : "", on: { click: () => { status = "0"; paintSeg(); } } }, "בוטל"));
    paintSeg();
    const desc = h("textarea", { value: E.description || "", placeholder: "מה נעשה בשעה" });
    const subj = h("select", null, h("option", { value: "" }, "— בחר מקצוע —"),
      E.subjects.map(o => h("option", { value: o.id, selected: o.id === E.subjectId }, o.label)));
    const saveBtn = h("button.btn.primary", { on: { click: async () => {
      saveBtn.disabled = true; saveBtn.textContent = "שומר…";
      try {
        await api("/api/event", { method: "POST", body: { url: E.url || it.eventUrl, draft: {
          status: status === E.status ? null : status,
          description: desc.value === E.description ? null : desc.value,
          subjectId: subj.value === E.subjectId ? null : subj.value } } });
        toast("✓ נשמר"); closeSheet(); loadWeek();
      } catch (err) { toast(err.refused ? "לא נשמר: " + err.message : err.message, true); saveBtn.disabled = false; saveBtn.textContent = "שמירה"; }
    } } }, "שמירה");
    openSheet(title, sub, h("div", null,
      E.typeLabel ? h("div.field", null, h("span.badge", null, E.typeLabel)) : null,
      h("div.field", null, h("div.label", null, "סטטוס"), seg),
      h("div.field", null, h("label", null, "נושא / תיאור"), desc),
      E.subjects.length ? h("div.field", null, h("label", null, "מקצוע"), subj) : null),
      [h("div.grow"), saveBtn]);
  }


  // ── full timetable (שוטף): by teacher or by class ───────────────────
  const tt = { weekOf: todayISO(), cache: {}, data: null, mode: "teacher", teacher: "", cls: "", day: null };
  try {
    const saved = JSON.parse(localStorage.getItem("tt") || "{}");
    if (saved.mode) tt.mode = saved.mode;
    if (saved.teacher) tt.teacher = saved.teacher;
    if (saved.cls) tt.cls = saved.cls;
  } catch (e) { /* private window: start fresh */ }
  function ttSave() {
    try { localStorage.setItem("tt", JSON.stringify({ mode: tt.mode, teacher: tt.teacher, cls: tt.cls })); } catch (e) { /* ignore */ }
  }
  $("#ttPrevWeek").onclick = () => { tt.weekOf = addDays(tt.weekOf, -7); tt.day = null; loadTT(); };
  $("#ttNextWeek").onclick = () => { tt.weekOf = addDays(tt.weekOf, 7); tt.day = null; loadTT(); };
  $("#ttThisWeek").onclick = () => { tt.weekOf = todayISO(); tt.day = null; ttPicker.setValue(todayISO()); loadTT(); };
  const ttPicker = datePicker({ value: todayISO(), label: "מעבר ל:", onPick: d => { tt.weekOf = d; tt.day = d; loadTT(); } });
  $("#ttThisWeek").after(ttPicker);
  document.querySelectorAll("#ttMode button").forEach(b => b.addEventListener("click", () => {
    tt.mode = b.dataset.mode; ttSave(); renderTT();
  }));

  async function loadTT() {
    const grid = $("#ttGrid");
    const key = weekStart(tt.weekOf);
    if (!tt.cache[key]) {
      grid.replaceChildren(loading("קורא את המערכת משוטף…"));
      $("#ttWho").replaceChildren();
      try { tt.cache[key] = await api(`/api/timetable?date=${tt.weekOf}`); }
      catch (err) { grid.replaceChildren(h("div.empty-state", null, err.message)); return; }
    }
    tt.data = tt.cache[key];
    renderTT();
  }
  function weekStart(s) { return addDays(s, -parseISO(s).getDay()); }

  const PRIV_CLASS = { "פרטני": "private", "שהייה": "stay", "גמול": "private" };
  function ttSlotsAt(date, hour) {
    const D = tt.data;
    if (tt.mode === "teacher") {
      return D.slots.filter(x => x.t === tt.teacher && x.date === date && x.hour === hour);
    }
    const mine = D.slots.filter(x => x.date === date && x.hour === hour && x.kind !== "blocked"
      && (x.classes || []).includes(tt.cls));
    // A substitute's row is already shown on the absent teacher's lesson.
    return mine.filter(x => x.kind !== "fill" || !mine.some(y => y.kind === "lesson" && y.absent && y.gid === x.gid));
  }
  const tName = id => ((tt.data.teachers.find(t => t.id === id) || {}).name || "");

  function ttSlot(x, date, hour) {
    const teacherMode = tt.mode === "teacher";
    let cls = "", title = x.title || "", sub = "";
    if (x.kind === "blocked") {
      return h("div.slot.tt-blocked", { title: "לא זמין בשעה זו", "aria-label": `שעה ${hour}: לא זמין` });
    }
    if (x.kind === "lesson") { cls = "lesson"; sub = teacherMode ? (x.classes || []).join(", ") : tName(x.t); }
    if (x.kind === "private") { cls = "k-" + (PRIV_CLASS[x.tag] || "other"); title = x.tag; sub = x.title !== x.tag ? x.title : ""; if (!teacherMode) sub = tName(x.t); }
    if (x.kind === "fill") { cls = "lesson swap"; sub = teacherMode ? `${(x.classes || []).join(", ")} · במקום ${x.instead}` : `${tName(x.t)} · במקום ${x.instead}`; }
    let status = null;
    if (x.absent) {
      cls += " tt-absent";
      status = x.cancel ? h("span.tt-st.bad", null, "בוטל")
        : x.sub ? h("span.tt-st", null, "ממלא: ", x.sub)
        : x.kind === "lesson" ? h("span.tt-st.bad", null, "נעדר · לא שובץ") : h("span.tt-st", null, "נעדר");
    }
    const label = [x.kind === "fill" ? "מילוי מקום" : "", title, sub, x.absent ? "נעדר" : "", x.exam ? "מבחן" : ""].filter(Boolean).join(", ");
    return h("button.slot", {
      class: cls, style: x.kind === "lesson" || x.kind === "fill" ? `--subj:${inkOf(title)}` : null,
      "aria-label": `שעה ${hour}: ${label}`, on: { click: () => ttDetails(x, date, hour) },
    },
      h("div.s-title", null, x.kind === "fill" ? swapIcon() : null, title, x.exam ? h("span.tt-exam", null, "מבחן") : null),
      sub ? h("div.s-sub", null, sub) : null,
      status);
  }

  function ttDetails(x, date, hour) {
    const rows = [];
    const row = (k, v) => v ? rows.push(h("div.tt-row", null, h("span", null, k), h("b", null, v))) : null;
    row("מורה", tName(x.t));
    row("כיתה", (x.classes || []).join(", "));
    if (x.kind === "private") row("סוג", x.tag);
    if (x.pupils) row("תלמידים", String(x.pupils));
    if (x.kind === "fill") row("מילוי מקום במקום", x.instead);
    if (x.absent) row("מצב", x.cancel ? "השיעור בוטל" : x.sub ? `המורה נעדר, ממלא מקום: ${x.sub}` : "המורה נעדר, עוד לא שובץ ממלא מקום");
    row("מבחן", x.exam);
    const jumps = [];
    if (tt.mode === "class" || x.kind === "fill") {
      jumps.push(h("button.btn", { on: { click: () => { tt.mode = "teacher"; tt.teacher = x.t; tt.day = date; ttSave(); closeSheet(); renderTT(); } } },
        `המערכת של ${tName(x.t)}`));
    }
    if (x.absent && x.sub) {
      const sid = (tt.data.teachers.find(t => t.name === x.sub) || {}).id;
      if (sid) jumps.push(h("button.btn", { on: { click: () => { tt.mode = "teacher"; tt.teacher = sid; tt.day = date; ttSave(); closeSheet(); renderTT(); } } },
        `המערכת של ${x.sub}`));
    }
    for (const c of x.classes || []) {
      if (tt.mode === "class" && c === tt.cls) continue;
      jumps.push(h("button.btn", { on: { click: () => { tt.mode = "class"; tt.cls = c; tt.day = date; ttSave(); closeSheet(); renderTT(); } } },
        `המערכת של כיתה ${c}`));
    }
    const title = x.kind === "private" ? x.tag : (x.title || "שיעור");
    openSheet(title, `${dayName(date)} ${dm(date)} · שעה ${hour}`,
      h("div", null, h("div.tt-rows", null, rows), jumps.length ? h("div.tt-jumps", null, jumps) : null));
  }

  /** A search box + every teacher; inline (nothing chosen yet) or in the sheet. */
  function ttTeacherList(inSheet) {
    const D = tt.data;
    const input = h("input.tt-search", { type: "search", placeholder: "חיפוש מורה…", "aria-label": "חיפוש מורה", autocomplete: "off" });
    const list = h("div.t-list.tt-tlist");
    const counts = {};
    D.slots.forEach(x => { if (x.kind === "lesson" || x.kind === "fill") counts[x.t] = (counts[x.t] || 0) + 1; });
    const draw = () => {
      const q = input.value.trim();
      const found = D.teachers.filter(t => !q || q.split(/\s+/).every(w => t.name.includes(w)));
      list.replaceChildren(...found.map(t => h("button.t-btn", {
        class: t.id === tt.teacher ? "on" : "",
        on: { click: () => { tt.teacher = t.id; tt.mode = "teacher"; ttSave(); if (inSheet) closeSheet(); renderTT(); } },
      }, h("span", null, t.name), counts[t.id] ? h("span.tag", null, `${counts[t.id]} ש׳`) : null)));
      if (!found.length) list.append(h("div.empty-state", null, "לא נמצא מורה בשם הזה"));
    };
    input.addEventListener("input", draw);
    input.addEventListener("keydown", e => { if (e.key === "Enter") { const b = list.querySelector("button"); if (b) b.click(); } });
    draw();
    return { el: h("div.tt-tpick", null, input, list), input };
  }
  function ttTeacherPicker() {
    const p = ttTeacherList(true);
    openSheet("בחירת מורה", "הקלד חלק מהשם, או בחר מהרשימה", p.el);
    setTimeout(() => p.input.focus(), 250);
  }


  // ── who is free at a given hour (for finding a substitute) ──────────
  function nowHour(date) {
    const D = tt.data, times = D.times || {};
    if (date !== todayISO() || !Object.keys(times).length) return null;
    const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
    const starts = D.hours.map(hr => [hr, times[hr]]).filter(x => x[1])
      .map(([hr, t]) => [hr, +t.slice(0, 2) * 60 + +t.slice(3)]);
    const cur = starts.filter(([, m]) => m <= mins).pop();   // the lesson going on now
    return cur ? cur[0] : (starts[0] || [null])[0];
  }
  function freeState(t, date, hour) {
    const D = tt.data;
    const day = D.slots.filter(x => x.t === t.id && x.date === date && x.kind !== "blocked");
    const at = D.slots.filter(x => x.t === t.id && x.date === date && x.hour === hour);
    if (at.some(x => x.absent)) return { g: "absent", label: "נעדר" };
    const teach = at.find(x => x.kind === "lesson" || x.kind === "fill");
    if (teach) return { g: "busy", label: `${teach.kind === "fill" ? "מילוי מקום · " : ""}${teach.title} ${(teach.classes || []).join(", ")}`.trim() };
    const priv = at.find(x => x.kind === "private");
    if (priv) return { g: "private", label: priv.tag };
    if (at.some(x => x.kind === "blocked") || !day.length) return { g: "off", label: "לא בבית הספר" };
    const hrs = day.map(x => x.hour);
    if (hour > Math.min(...hrs) && hour < Math.max(...hrs)) return { g: "free", label: "פנוי (חלון)" };
    return { g: "edge", label: hour < Math.min(...hrs) ? `מתחיל בשעה ${Math.min(...hrs)}` : `סיים בשעה ${Math.max(...hrs)}` };
  }
  function renderFree() {
    const D = tt.data, days = D.days, today = todayISO(), grid = $("#ttGrid");
    if (!tt.day || !days.some(d => d.date === tt.day)) {
      tt.day = (days.find(d => d.date === today) || days.find(d => d.date > today) || days[0] || {}).date;
    }
    const dayObj = days.find(d => d.date === tt.day) || {};
    if (!tt.freeHour || tt.freeDay !== tt.day) { tt.freeHour = nowHour(tt.day) || D.hours[0]; tt.freeDay = tt.day; }
    const times = D.times || {};
    $("#ttWho").replaceChildren(h("div.tt-hours", { role: "tablist", "aria-label": "שעה" }, D.hours.map(hr => h("button.chip", {
      class: hr === tt.freeHour ? "on" : "", role: "tab", "aria-selected": hr === tt.freeHour ? "true" : "false",
      on: { click: () => { tt.freeHour = hr; renderFree(); } },
    }, `שעה ${hr}`, times[hr] ? h("small", null, " ", times[hr]) : null))));
    $("#ttDayChips").replaceChildren(...days.map(d => h("button.day-chip", {
      class: (d.date === tt.day ? "active" : "") + (d.date === today ? " today" : ""),
      on: { click: () => { tt.day = d.date; renderFree(); } },
    }, `${dayName(d.date)} ${dm(d.date)}`)));
    $("#ttDayChips").style.display = "flex";
    if (dayObj.vacation) { grid.replaceChildren(h("div.tt-inline", null, h("div.empty-state", null, `${dayObj.vacation}: אין לימודים`))); return; }
    const groups = { free: [], private: [], edge: [], busy: [], absent: [], off: [] };
    for (const t of D.teachers) { const st = freeState(t, tt.day, tt.freeHour); groups[st.g].push({ t, st }); }
    const TITLES = {
      free: ["פנויים", "יש להם שיעורים לפני ואחרי השעה הזאת"],
      private: ["בפרטני, שהייה או תפקיד", "אפשר לבקש מהם למלא מקום"],
      edge: ["פנויים, מחוץ לשעות שלהם היום", "לפני תחילת או אחרי סוף היום שלהם"],
      busy: ["מלמדים", ""], absent: ["נעדרים", ""], off: ["לא בבית הספר בשעה הזאת", ""],
    };
    const order = ["free", "private", "edge", "busy", "absent", "off"];
    const body = order.filter(g => groups[g].length).map(g => {
      const list = groups[g].sort((a, b) => (b.t.available - a.t.available) || a.t.name.localeCompare(b.t.name, "he"));
      const open = ["free", "private", "edge"].includes(g);
      return h("details.tt-free", { open: open ? "" : null, class: "g-" + g },
        h("summary", null, h("b", null, TITLES[g][0]), h("span.tt-count", null, list.length), TITLES[g][1] ? h("span.muted", null, TITLES[g][1]) : null),
        h("div.t-list", null, list.map(({ t, st }) => h("button.t-btn", {
          title: "למערכת של המורה",
          on: { click: () => { tt.mode = "teacher"; tt.teacher = t.id; ttSave(); renderTT(); } },
        }, h("span", null, t.name, !t.available && open ? h("small.muted", null, " · לא מסומן למילוי") : null),
          h("span.tag", { class: { free: "free", private: "private", edge: "free", absent: "absent" }[g] || "" }, st.label)))));
    });
    grid.replaceChildren(h("div.tt-inline.tt-freewrap", null,
      h("div.tt-freehead", null, `${dayName(tt.day)} ${dm(tt.day)} · שעה ${tt.freeHour}${times[tt.freeHour] ? " · " + times[tt.freeHour] : ""}`),
      body));
  }

  function renderTT() {
    const D = tt.data;
    if (!D) return;
    document.querySelectorAll("#ttMode button").forEach(b => b.classList.toggle("on", b.dataset.mode === tt.mode));
    const days = D.days, today = todayISO(), grid = $("#ttGrid");
    $("#ttWeekLabel").textContent = days.length ? `${dm(days[0].date)} עד ${dm(days[days.length - 1].date)}` : "";
    $("#ttLegend").classList.toggle("hidden", tt.mode === "free");
    if (tt.mode === "free") { renderFree(); return; }
    $("#ttDayChips").style.display = "";
    if (tt.mode === "teacher" && !D.teachers.some(t => t.id === tt.teacher)) tt.teacher = "";
    if (tt.mode === "class" && !D.classes.some(c => c.label === tt.cls)) tt.cls = D.classes.length ? D.classes[0].label : "";

    // who: the teacher (with prev/next) or the class chips
    const who = $("#ttWho");
    if (tt.mode === "teacher") {
      const i = D.teachers.findIndex(t => t.id === tt.teacher);
      const step = n => { const t = D.teachers[(i + n + D.teachers.length) % D.teachers.length]; tt.teacher = t.id; ttSave(); renderTT(); };
      if (i < 0) {
        who.replaceChildren(h("h2.tt-ask", null, "של איזה מורה להציג את המערכת?"));
        const p = ttTeacherList(false);
        grid.replaceChildren(h("div.tt-inline", null, p.el));
        $("#ttDayChips").replaceChildren();
        return;
      }
      const mine = D.slots.filter(x => x.t === tt.teacher);
      const n = k => mine.filter(x => x.kind === k).length;
      const absent = new Set(mine.filter(x => x.absent).map(x => x.date)).size;
      who.replaceChildren(
        h("button.icon-btn", { "aria-label": "המורה הקודם", title: "המורה הקודם", on: { click: () => step(-1) } }, h("span", { "aria-hidden": "true" }, "›")),
        h("button.tt-name", { on: { click: ttTeacherPicker }, "aria-label": "החלפת מורה" },
          h("span", null, D.teachers[i].name), h("span.tt-chev", { "aria-hidden": "true" }, "▾")),
        h("button.icon-btn", { "aria-label": "המורה הבא", title: "המורה הבא", on: { click: () => step(1) } }, h("span", { "aria-hidden": "true" }, "‹")),
        h("div.tt-stats", null,
          h("span", null, h("b", null, n("lesson")), " שיעורים"),
          n("private") ? h("span", null, h("b", null, n("private")), " פרטני ושהייה") : null,
          n("fill") ? h("span", null, h("b", null, n("fill")), " מילוי מקום") : null,
          absent ? h("span.bad", null, h("b", null, absent), absent === 1 ? " יום היעדרות" : " ימי היעדרות") : null));
    } else {
      const layers = [];
      D.classes.forEach(c => { if (!layers.includes(c.layer)) layers.push(c.layer); });
      who.replaceChildren(h("div.tt-classes", { role: "tablist", "aria-label": "כיתה" }, D.classes.map(c => h("button.chip", {
        class: c.label === tt.cls ? "on" : "", role: "tab", "aria-selected": c.label === tt.cls ? "true" : "false",
        on: { click: () => { tt.cls = c.label; ttSave(); renderTT(); } },
      }, c.label))));
    }

    if (!tt.day || !days.some(d => d.date === tt.day)) {
      tt.day = (days.find(d => d.date === today) || days.find(d => d.date > today) || days[0] || {}).date;
    }
    $("#ttDayChips").replaceChildren(...days.map(d => h("button.day-chip", {
      class: (d.date === tt.day ? "active" : "") + (d.date === today ? " today" : ""),
      on: { click: () => { tt.day = d.date; renderTT(); } },
    }, `${dayName(d.date)} ${dm(d.date)}`)));
    requestAnimationFrame(() => {  // center the chosen day without scrolling the page
      const c = $("#ttDayChips"), a = $("#ttDayChips .active");
      if (a) c.scrollLeft = a.offsetLeft - c.clientWidth / 2 + a.offsetWidth / 2;
    });

    // rows: from the first to the last hour that has anything this week
    const used = D.hours.filter(hr => days.some(d => ttSlotsAt(d.date, hr).some(x => x.kind !== "blocked")));
    const hours = used.length ? D.hours.filter(hr => hr >= used[0] && hr <= used[used.length - 1]) : [];
    grid.style.setProperty("--days", days.length);
    const kids = [h("div")];
    for (const d of days) {
      const hp = hebParts(parseISO(d.date));
      kids.push(h("div.g-head", { class: (d.date === today ? "today" : "") + (d.date === tt.day ? " sel" : "") },
        h("span.gh-day", null, dayName(d.date)),
        h("span.gh-num", null, parseISO(d.date).getDate()),
        hp ? h("span.gh-heb", null, `${hp.day} ${hp.month}`) : null));
    }
    if (!hours.length) {
      grid.replaceChildren(...kids, h("div.empty-state", null, tt.mode === "teacher" ? "אין שיעורים למורה הזה בשבוע הזה" : "אין שיעורים לכיתה הזאת בשבוע הזה"));
      return;
    }
    hours.forEach((hr, ri) => {
      kids.push(h("div.g-hour", null, hr));
      for (const d of days) {
        const cell = h("div.g-cell", { class: (d.date === today ? "today" : "") + (d.date === tt.day ? " sel" : "") });
        if (d.vacation) {
          cell.append(ri === 0 ? h("div.slot.tt-vac", null, h("div.s-title", null, d.vacation), h("div.s-sub", null, "אין לימודים")) : h("div.tt-vac-fill"));
        } else {
          const items = ttSlotsAt(d.date, hr);
          if (!items.length) cell.append(h("div.empty-slot"));
          for (const x of items) cell.append(ttSlot(x, d.date, hr));
        }
        kids.push(cell);
      }
    });
    grid.replaceChildren(...kids);
  }

  // ── absences ────────────────────────────────────────────────────────
  async function meta() {
    if (!state.meta) state.meta = await api("/api/teachers");
    return state.meta;
  }
  function schoolDays(n) {
    const out = []; let d = todayISO();
    while (out.length < n) { if (parseISO(d).getDay() !== 6) out.push(d); d = addDays(d, 1); }
    return out;
  }
  function hoursLabel(a) {
    if (a.fromHour === 1 && a.toHour === 10) return "יום מלא";
    return a.fromHour === a.toHour ? `שעה ${a.fromHour}` : `שעות ${a.fromHour}–${a.toHour}`;
  }
  // ── the absences: yesterday / today / tomorrow / week / month / from–to, with the filters of a vice principal ──
  const ab = { mode: "day", from: todayISO(), to: todayISO(), teacher: "", reason: "", noNote: false, noSub: false, group: "day", rows: [], more: false };
  const startOfWeek = d => addDays(d, -parseISO(d).getDay());                       // Sunday
  const monthEdges = d => { const x = parseISO(d); return [iso(new Date(x.getFullYear(), x.getMonth(), 1)), iso(new Date(x.getFullYear(), x.getMonth() + 1, 0))]; };
  function absGo(mode, anchor) {
    const d = anchor || todayISO();
    ab.mode = mode;
    if (mode === "week") { ab.from = startOfWeek(d); ab.to = addDays(ab.from, 5); }
    else if (mode === "month") [ab.from, ab.to] = monthEdges(d);
    else ab.from = ab.to = d;
    state.absDate = ab.from;
    loadAbsences();
  }
  function absStep(dir) {
    if (ab.mode === "week") absGo("week", addDays(ab.from, 7 * dir));
    else if (ab.mode === "month") { const x = parseISO(ab.from); absGo("month", iso(new Date(x.getFullYear(), x.getMonth() + dir, 1))); }
    else if (ab.mode === "range") {
      const span = Math.round((parseISO(ab.to) - parseISO(ab.from)) / 86400e3) + 1;
      ab.from = addDays(ab.from, span * dir); ab.to = addDays(ab.to, span * dir); loadAbsences();
    } else { let d = addDays(ab.from, dir); if (parseISO(d).getDay() === 6) d = addDays(d, dir); absGo("day", d); }
  }
  const fromPick = datePicker({ value: ab.from, label: "מ־", allowSat: true, onPick: d => { ab.mode = "range"; ab.from = d; if (ab.to < d) ab.to = d; state.absDate = d; loadAbsences(); } });
  const toPick = datePicker({ value: ab.to, label: "עד ", allowSat: true, onPick: d => { ab.mode = "range"; ab.to = d; if (ab.from > d) ab.from = d; loadAbsences(); } });
  $("#newAbsence").onclick = () => openNewAbsence();
  $("#absMore").onclick = () => { ab.more = !ab.more; paintMore(); };
  /** The panel behind "עוד": the free date range, teacher, reason, order and the reports. */
  function paintMore() {
    $("#absPanel").classList.toggle("open", ab.more);
    const b = $("#absMore"), n = [ab.teacher, ab.reason, ab.group !== "day", ab.mode === "range"].filter(Boolean).length;
    b.setAttribute("aria-expanded", String(ab.more)); b.classList.toggle("open", ab.more);
    put(b, h("span", null, ab.more ? "פחות" : "עוד"), n && !ab.more ? h("span.count", null, n) : null, icon("down"));
  }

  function absTitle() {
    const d = parseISO(ab.from), hp = hebParts(d);
    if (ab.mode === "day") {
      return [h("span.wt-main", null, `${dayName(ab.from)}, `, h("span.wt-days", null, `${d.getDate()} ב${MONTHS[d.getMonth()]}`)),
        hp ? h("span.wt-heb", null, `${hp.day} ב${hp.month} ${hp.year}`) : null];
    }
    if (ab.mode === "month") return [h("span.wt-main", null, `${MONTHS[d.getMonth()]} `, h("span.wt-days", null, d.getFullYear()))];
    return [h("span.wt-main", null, ab.mode === "week" ? "שבוע " : "", h("span.wt-days", null, `${dm(ab.from)} – ${dm(ab.to)}`))];
  }

  async function loadAbsences() {
    const t = todayISO();
    fromPick.setValue(ab.from); toPick.setValue(ab.to);
    put($("#absTitle"), absTitle());
    const chip = (label, on, fn) => h("button.day-chip", { type: "button", class: on ? "active" : "", on: { click: fn } }, label);
    put($("#absDates"),
      chip("אתמול", ab.mode === "day" && ab.from === addDays(t, -1), () => absGo("day", addDays(t, -1))),
      chip("היום", ab.mode === "day" && ab.from === t, () => absGo("day", t)),
      chip("מחר", ab.mode === "day" && ab.from === addDays(t, 1), () => absGo("day", addDays(t, 1))),
      chip("השבוע", ab.mode === "week" && ab.from === startOfWeek(t), () => absGo("week", t)),
      chip("החודש", ab.mode === "month" && ab.from.slice(0, 7) === t.slice(0, 7), () => absGo("month", t)));
    put($("#absRange"),
      h("button.icon-btn", { type: "button", "aria-label": "הקודם", title: "הקודם", on: { click: () => absStep(-1) } }, icon("prev")),
      fromPick, toPick,
      h("button.icon-btn", { type: "button", "aria-label": "הבא", title: "הבא", on: { click: () => absStep(1) } }, icon("next")));
    paintMore();
    const list = $("#absList"), key = `${ab.from}|${ab.to}`;
    const hit = absCache.get(key);
    if (hit && Date.now() - hit.t < 30000) { ab.rows = hit.days; paintAbsences(); return; }
    put(list, loading(ab.mode === "month" || ab.mode === "range" ? "קורא משוטף… טווח ארוך לוקח כמה שניות" : "קורא משוטף…"));
    put($("#absStats")); put($("#absQuick"));
    try {
      const r = await api(`/api/absences/range?from=${ab.from}&to=${ab.to}`);
      if (key !== `${ab.from}|${ab.to}`) return;               // the dates changed meanwhile
      absCache.set(key, { t: Date.now(), days: r.days });
      ab.rows = r.days; paintAbsences();
    } catch (err) { put(list, h("div.empty-state", null, err.message)); }
  }

  /** One absence on one day: who, what, how much is covered, and what can be done. */
  function absRow(x, showDate) {
    const a = { id: x.id, teacher: x.teacher, fromHour: x.fromHour, toHour: x.toHour, reason: x.reason, note: x.note };
    const total = x.lessons || 0, filled = x.filled || 0, left = total - filled, hp = hebParts(parseISO(x.date));
    return h("article.card.slip.abs", null,
      showDate ? h("div.abs-date", null, `${dayName(x.date)} ${dm(x.date)}${hp ? ` · ${hp.day} ב${hp.month}` : ""}`) : null,
      h("div.abs-head", null, h("h3", null, x.teacher), noteBadge(x)),
      h("div.meta", null, h("span", null, hoursLabel(a)), h("span", null, x.reason)),
      x.note ? h("div.abs-note", null, x.note) : null,
      total ? h("div.subs", null,
        h("div.subs-bar", { role: "img", "aria-label": `${filled} מתוך ${total} שיעורים משובצים` }, h("span", { style: `width:${Math.round(100 * filled / total)}%` })),
        h("div.subs-text", { class: left ? "miss" : "ok" }, left ? `חסרים ${left} מחליפים` : [icon("check"), "כל השיעורים משובצים"], h("small", null, `${filled}/${total}`)))
        : h("div.subs-text.muted", null, "אין שיעורים עם כיתה"),
      h("div.actions.abs-actions", null,
        left ? h("button.btn.primary.grow", { type: "button", on: { click: () => openSubs(a, x.date) } }, "שיבוץ מחליפים") : null,
        h("button.btn", { type: "button", class: left ? "" : "grow", on: { click: () => openSummary(a, x.date) } }, left ? "סיכום" : "סיכום שיבוצים"),
        h("button.icon-btn", { type: "button", "aria-label": "עריכה", title: "עריכה", on: { click: () => openEdit(a, x.date) } }, icon("pencil")),
        h("button.icon-btn.danger", { type: "button", "aria-label": "מחיקה", title: "מחיקה", on: { click: () => removeAbsence(a, x.date) } }, icon("trash"))));
  }

  function paintAbsences() {
    const all = ab.rows || [];
    const teachers = [...new Set(all.map(x => x.teacher))].sort((p, q) => p.localeCompare(q, "he"));
    const reasons = [...new Set(all.map(x => x.reason).filter(Boolean))];
    if (ab.teacher && !teachers.includes(ab.teacher)) ab.teacher = "";
    if (ab.reason && !reasons.includes(ab.reason)) ab.reason = "";
    const rows = all.filter(x => (!ab.teacher || x.teacher === ab.teacher) && (!ab.reason || x.reason === ab.reason)
      && (!ab.noNote || x.sickNote === false) && (!ab.noSub || (x.lessons || 0) > (x.filled || 0)));
    const missNote = all.filter(x => x.sickNote === false).length, missSub = all.filter(x => (x.lessons || 0) > (x.filled || 0)).length;
    const again = () => paintAbsences();
    const toggle = (label, n, key) => h("button.chip", { type: "button", "aria-pressed": String(!!ab[key]), class: (ab[key] ? "on " : "") + (n ? "warnc" : ""),
      on: { click: () => { ab[key] = !ab[key]; again(); } } }, label, h("b", null, n));
    const sel = (label, key, opts) => h("label.fsel", null, h("span", null, label),
      h("select", { on: { change: e => { ab[key] = e.target.value; paintMore(); again(); } } }, opts.map(([v, t]) => h("option", { value: v, selected: ab[key] === v }, t))));
    put($("#absQuick"), toggle("חסר אישור מחלה", missNote, "noNote"), toggle("חסרים מחליפים", missSub, "noSub"));
    put($("#absFields"),
      sel("מורה", "teacher", [["", "כל המורים"], ...teachers.map(t => [t, t])]),
      reasons.length > 1 ? sel("סיבה", "reason", [["", "כל הסיבות"], ...reasons.map(t => [t, t])]) : null,
      sel("מיון", "group", [["day", "לפי יום"], ["teacher", "לפי מורה"]]));
    paintMore();
    const lessons = rows.reduce((n, x) => n + (x.lessons || 0), 0), filled = rows.reduce((n, x) => n + (x.filled || 0), 0);
    put($("#absStats"), rows.length ? h("div.muted", null,
      `${rows.length} ${rows.length === 1 ? "היעדרות" : "היעדרויות"} · ${lessons} שיעורים · ${lessons - filled} בלי מחליף`) : null);
    const list = $("#absList");
    if (!rows.length) {
      put(list, h("div.empty-state", null, all.length ? "אין היעדרויות שמתאימות לסינון" : "אין היעדרויות בטווח הזה"));
      return;
    }
    const groups = new Map();
    const sorted = rows.slice().sort((p, q) => p.date.localeCompare(q.date) || p.teacher.localeCompare(q.teacher, "he"));
    const byTeacher = ab.group === "teacher";
    sorted.forEach(x => { const k = byTeacher ? x.teacher : x.date; (groups.get(k) || groups.set(k, []).get(k)).push(x); });
    const order = [...groups.keys()];
    if (byTeacher) order.sort((p, q) => groups.get(q).length - groups.get(p).length || p.localeCompare(q, "he"));
    const single = ab.mode === "day";
    put(list, order.flatMap(k => {
      const g = groups.get(k);
      const head = single && !byTeacher ? null : h("h2.abs-group", null,
        byTeacher ? k : `${dayName(k)} ${dm(k)}`,
        h("span.count", null, byTeacher
          ? `${g.length} ${g.length === 1 ? "יום" : "ימים"} · ${g.reduce((n, x) => n + ((x.lessons || 0) - (x.filled || 0)), 0)} בלי מחליף`
          : `${g.length}`));
      return [head, ...g.map(x => absRow(x, byTeacher))];
    }));
  }

  // Sick absences: was a sick note attached in the teachers' page?
  function noteBadge(a) {
    if (a.sickNote === true) return h("span.note-badge.ok", null, "✓ אישור מחלה");
    if (a.sickNote === false) return h("span.note-badge.miss", null, "חסר אישור");
    return null;
  }

  function hourSelect(v) { return h("select", null, Array.from({ length: 10 }, (_, i) => h("option", { value: i + 1, selected: i + 1 === v }, i + 1))); }
  function reasonSelect(m, selectedId, selectedName) {
    const seen = new Set();
    return h("select", null, Object.entries(m.reasons).filter(([, n]) => !seen.has(n) && seen.add(n))
      .map(([id, n]) => h("option", { value: id, selected: selectedId ? String(selectedId) === id : n === selectedName }, n)));
  }

  async function openNewAbsence() {
    openSheet("היעדרות חדשה", "תישמר בשוטף", loading());
    let m;
    try { m = await meta(); } catch (err) { openSheet("היעדרות חדשה", "", h("div.empty-state", null, err.message)); return; }
    const teacher = h("select", null, h("option", { value: "" }, "— בחר מורה —"), m.teachers.map(t => h("option", { value: t.id }, t.name)));
    let fromV = state.absDate, toV = state.absDate;
    const to = datePicker({ value: toV, onPick: d => { toV = d; } });
    const from = datePicker({ value: fromV, onPick: d => { fromV = d; if (toV < d) { toV = d; to.setValue(d); } } });
    let full = true;
    const fh = hourSelect(1), th = hourSelect(10);
    const hoursRow = h("div.row2.hidden", null, h("div.field", null, h("label", null, "משעה"), fh), h("div.field", null, h("label", null, "עד שעה"), th));
    const scope = h("div.seg");
    const paintScope = () => {
      scope.replaceChildren(
        h("button", { class: full ? "on" : "", on: { click: () => { full = true; paintScope(); } } }, "יום מלא"),
        h("button", { class: full ? "" : "on", on: { click: () => { full = false; paintScope(); } } }, "חלק מהיום"));
      hoursRow.classList.toggle("hidden", full);
    };
    paintScope();
    const reason = reasonSelect(m, null, "מחלה");
    const note = h("input", { type: "text", placeholder: "לא חובה" });
    const saveBtn = h("button.btn.primary", { on: { click: async () => {
      if (!teacher.value) { toast("בחר מורה", true); return; }
      if (toV < fromV) { toast("\"עד תאריך\" מוקדם מ\"מתאריך\"", true); return; }
      const body = {
        teacherId: teacher.value, from: fromV, to: toV,
        fromHour: full ? 1 : +fh.value, toHour: full ? 10 : +th.value,
        reasonId: reason.value, note: note.value, approve: false,
      };
      saveBtn.disabled = true; saveBtn.textContent = "שומר…";
      try {
        const res = await api("/api/absences", { method: "POST", body });
        toast(res.saved.length ? "✓ ההיעדרות נשמרה" : "נשלח לשוטף, כדאי לבדוק שם", !res.saved.length);
        closeSheet(); absGo("day", body.from);
        if (res.saved.length) openSubs(res.saved[0], body.from);
      } catch (err) { toast(err.message, true); saveBtn.disabled = false; saveBtn.textContent = "שמירה"; }
    } } }, "שמירה");
    openSheet("היעדרות חדשה", "תישמר בשוטף", h("div", null,
      h("div.field", null, h("label", null, "מורה"), teacher),
      h("div.row2", null, h("div.field", null, h("div.label", null, "מתאריך"), from), h("div.field", null, h("div.label", null, "עד תאריך"), to)),
      h("div.field", null, h("div.label", null, "היקף"), scope),
      hoursRow,
      h("div.field", null, h("label", null, "סיבה"), reason),
      h("div.field", null, h("label", null, "הערה"), note)),
      [h("div.grow"), saveBtn]);
  }

  async function openEdit(a, date = state.absDate) {
    openSheet(`עריכה · ${a.teacher}`, `${dayName(date)} ${dm(date)}`, loading());
    let full, m;
    try { [full, m] = await Promise.all([api(`/api/absences/${a.id}?date=${date}`), meta()]); }
    catch (err) { openSheet("עריכה", "", h("div.empty-state", null, err.message)); return; }
    if (full.multiDay) {
      openSheet(`עריכה · ${a.teacher}`, "היעדרות של כמה ימים", h("p", null,
        "היעדרות של כמה ימים אפשר רק למחוק כאן. לשינוי שעות או תאריכים, ערוך בשוטף עצמו."),
        [h("div.grow"), h("button.btn.danger.solid", { on: { click: () => removeAbsence(a, date) } }, "מחיקה")]);
      return;
    }
    const fh = hourSelect(full.fromHour), th = hourSelect(full.toHour);
    const reason = reasonSelect(m, full.reasonID);
    const note = h("input", { type: "text", value: full.note || "" });
    const saveBtn = h("button.btn.primary", { on: { click: async () => {
      const body = { fromHour: +fh.value, toHour: +th.value, reasonID: +reason.value, note: note.value };
      if (body.fromHour > body.toHour) { toast("\"משעה\" גדולה מ\"עד שעה\"", true); return; }
      saveBtn.disabled = true;
      try { await api(`/api/absences/${a.id}?date=${date}`, { method: "POST", body }); toast("✓ עודכן"); closeSheet(); loadAbsences(); }
      catch (err) { toast(err.message, true); saveBtn.disabled = false; }
    } } }, "שמירה");
    openSheet(`עריכה · ${a.teacher}`, `${dayName(date)} ${dm(date)}`, h("div", null,
      h("div.row2", null, h("div.field", null, h("label", null, "משעה"), fh), h("div.field", null, h("label", null, "עד שעה"), th)),
      h("div.field", null, h("label", null, "סיבה"), reason),
      h("div.field", null, h("label", null, "הערה"), note)),
      [h("div.grow"), h("button.btn.danger", { on: { click: () => removeAbsence(a, date) } }, "מחיקה"), saveBtn]);
  }

  function removeAbsence(a, date = state.absDate) {
    const never = h("input", { type: "checkbox", id: "absNever" });
    const go = h("button.btn.danger.solid", null, "מחיקה");
    go.addEventListener("click", async () => {
      go.disabled = true; go.textContent = "מוחק…";
      try {
        const res = await api(`/api/absences/${a.id}?date=${date}`, { method: "DELETE" });
        if (!res.gone) { toast("נשלחה מחיקה, אבל היא עדיין מופיעה. כדאי לבדוק בשוטף", true); }
        else if (never.checked) {
          try { await api("/api/reports/hide", { method: "POST", body: { absenceId: a.id } }); toast("✓ ההיעדרות נמחקה, וגם הוסרה מהדף של המורה"); }
          catch (err) { toast("ההיעדרות נמחקה, אבל ההסרה מהדף של המורה נכשלה: " + err.message, true); }
        } else { toast("✓ ההיעדרות נמחקה"); }
        closeSheet(); loadAbsences();
      } catch (err) { toast(err.message, true); go.disabled = false; go.textContent = "מחיקה"; }
    });
    openSheet(`מחיקת ההיעדרות של ${a.teacher}`, `${hoursLabel(a)} · ${a.reason || ""}`,
      h("div", null,
        h("p", null, "בשוטף המחיקה חלה על כל התאריכים של ההיעדרות, ושיבוצי המחליפים שלה יימחקו."),
        h("label.check.never-check", { for: "absNever" }, never,
          h("span", null, h("b", null, "ההיעדרות לא התקיימה בכלל"),
            h("div.muted", null, "להסיר אותה גם מהדף של המורה. בלי הסימון, המורה יראה אותה כ\"בוטלה\"")))),
      [h("div.grow"), h("button.btn", { on: { click: closeSheet } }, "ביטול"), go]);
  }

  /** Teacher-page reports that were canceled or deleted: remove them from the teacher's page. */
  async function openCanceled() {
    const title = "דיווחים שבוטלו", sub = "מה שהמורים רואים בדף שלהם כ\"בוטל\"";
    openSheet(title, sub, loading("קורא מהגיליון…"));
    let reports;
    try { ({ reports } = await api("/api/reports/canceled")); }
    catch (err) { openSheet(title, sub, h("div.empty-state", null, err.message)); return; }
    if (!reports.length) { openSheet(title, sub, h("div.empty-state", null, "אין דיווחים שבוטלו")); return; }
    const range = r => r.to && r.to !== r.from ? `${dm(r.from)}–${dm(r.to)}` : `${dayName(r.from)} ${dm(r.from)}`;
    const list = h("div.cards.canceled-list", null, reports.sort((x, y) => (y.from > x.from ? 1 : -1)).map(r => {
      const btn = h("button.btn.small.danger", null, "הסרה מהדף");
      const card = h("div.card", null,
        h("h3", null, r.teacher),
        h("div.meta", null, h("span", null, range(r)), h("span", null, hoursLabel(r)), h("span", null, r.reason || ""),
          h("span.badge", null, r.status)),
        h("div.actions", null, btn));
      btn.addEventListener("click", async () => {
        if (!confirm(`להסיר מהדף של ${r.teacher} את הדיווח מ-${range(r)}?\nהמורה לא יראה אותו יותר, גם לא כמבוטל.`)) return;
        btn.disabled = true;
        try { await api("/api/reports/hide", { method: "POST", body: { row: r.row } }); card.remove(); toast("✓ הוסר מהדף של המורה"); }
        catch (err) { toast(err.message, true); btn.disabled = false; }
      });
      return card;
    }));
    openSheet(title, sub, h("div", null, h("p.muted", null, "הסרה מתאימה להיעדרות שלא התקיימה בכלל, למשל דיווח ניסיון. היא לא משנה כלום בשוטף."), list));
  }

  // ── substitutes ─────────────────────────────────────────────────────
  const TAG = { "פנוי": "free", "פרטני": "private", "שהייה": "stay", "תפוס": "busy", "משובץ": "sub", "נעדר": "absent" };
  const shortLesson = l => (l || "").split(",").slice(1).map(x => x.trim()).filter(Boolean).join(" · ") || l || "";

  /** Only the hours still without a substitute. A teacher click assigns at
      once; the hour leaves the list; when none are left the panel closes. */
  let subsPending = 0;       // assignments sent in the background and not answered yet
  async function openSubs(a, date = state.absDate) {
    const title = `שיבוץ מחליפים · ${a.teacher}`, sub = `${dayName(date)} ${dm(date)}`;
    openSheet(title, sub, loading("בודק שיעורים ומורים…"));
    let hours;
    try { ({ hours } = await api(`/api/absences/${a.id}/hours?date=${date}`)); }
    catch (err) { openSheet(title, sub, h("div.empty-state", null, err.message)); return; }
    if (!hours.length) { openSheet(title, sub, h("div.empty-state", null, "אין למורה שיעורים עם כיתה בשעות האלה")); return; }
    const open = hours.filter(x => !x.substitute);
    if (!open.length) {
      openSheet(title, sub, h("div.empty-state", null, "✓ כל השעות כבר שובצו"),
        [h("div.grow"), h("button.btn", { on: { click: () => openSummary(a, date) } }, "סיכום שיבוצים")]);
      return;
    }
    const wrap = h("div");
    const counter = h("div.grow");
    const paintCounter = () => { counter.textContent = `נשארו ${wrap.children.length} שעות לשיבוץ`; };
    for (const hr of open) {
      let filter = "all";
      const listEl = h("div.t-list");
      const filt = h("div.t-filter");
      const block = h("div.hour-block");
      const paint = () => {
        filt.replaceChildren(
          h("button.chip", { class: filter === "all" ? "on" : "", on: { click: () => { filter = "all"; paint(); } } }, "כל המורים"),
          h("button.chip", { class: filter === "free" ? "on" : "", on: { click: () => { filter = "free"; paint(); } } }, "פנויים, פרטני ושהייה"));
        const ts = hr.teachers.filter(t => filter === "all" || ["פנוי", "פרטני", "שהייה"].includes(t.tag));
        listEl.replaceChildren(...ts.map(t => h("button.t-btn", {
          disabled: t.tag === "נעדר",
          on: { click: e => doAssign(a, date, hr, t, block, e.currentTarget, done) },
        }, h("span", null, t.name), h("span.tag", { class: TAG[t.tag] || "" }, t.tag))));
      };
      paint();
      block.append(
        h("div.hour-head", null, h("b", null, `שעה ${hr.hour}`), h("span.grow", null, shortLesson(hr.lesson)),
          h("span.badge.warn", null, "ללא מחליף")),
        filt, listEl);
      wrap.append(block);
    }
    function done() {
      paintCounter();
      if (!wrap.children.length && !subsPending) { toast("✓ כל השעות שובצו"); closeSheet(); loadAbsences(); }
    }
    openSheet(title, sub, wrap,
      [counter, h("button.btn", { on: { click: () => openSummary(a, date) } }, "סיכום שיבוצים")]);
    paintCounter();
  }

  /** The click sends the wish in the background and the screen moves on at once: the hour leaves the list
      and the next one can be assigned. If שוטף does not take it, the hour comes back with the reason.
      `again`: call done() once more when the answer arrives (the list case; the summary reloads itself). */
  function doAssign(a, date, hr, t, block, btn, done, again = true) {
    const parent = block.parentNode, next = block.nextSibling;
    const warn = t.tag === "פנוי" ? "" : ` (שים לב: ${t.tag === "תפוס" ? "תפוס" : t.tag === "משובץ" ? "כבר היה משובץ" : "ב" + t.tag} בשעה הזאת)`;
    const back = reason => {
      toast(`שעה ${hr.hour} של ${a.teacher} לא שובצה: ${reason}`, true);
      if (parent && parent.isConnected) parent.insertBefore(block, next && next.parentNode === parent ? next : null);
      done();
    };
    block.remove(); subsPending++; done();
    toast(`⏳ משבץ את ${t.name} לשעה ${hr.hour}…`);
    api(`/api/absences/${a.id}/assign?date=${date}`, { method: "POST", body: { hour: hr.hour, teacherId: t.id } }).then(res => {
      subsPending--;
      if (!res.ok) return back("נשלח לשוטף, אבל השיבוץ לא מופיע. כדאי לבדוק בטיפולים");
      toast(`✓ ${res.teacher} שובץ לשעה ${hr.hour}${warn}`, !!warn);
      if (again) done();
    }).catch(err => { subsPending--; back(err.message); });
  }

  /** One hour: choose a (different) substitute. Replaces the current one. */
  function openReplace(a, date, hr) {
    const title = `שעה ${hr.hour} · ${shortLesson(hr.lesson)}`;
    const sub = hr.substitute ? `במקום ${hr.substitute} · ${a.teacher} נעדר` : `${a.teacher} נעדר`;
    let filter = "all";
    const listEl = h("div.t-list"), filt = h("div.t-filter"), block = h("div.hour-block");
    const others = hr.teachers.filter(t => t.name !== hr.substitute);
    const paint = () => {
      filt.replaceChildren(
        h("button.chip", { class: filter === "all" ? "on" : "", on: { click: () => { filter = "all"; paint(); } } }, "כל המורים"),
        h("button.chip", { class: filter === "free" ? "on" : "", on: { click: () => { filter = "free"; paint(); } } }, "פנויים, פרטני ושהייה"));
      const ts = others.filter(t => filter === "all" || ["פנוי", "פרטני", "שהייה"].includes(t.tag));
      listEl.replaceChildren(...ts.map(t => h("button.t-btn", {
        disabled: t.tag === "נעדר",
        on: { click: e => doAssign(a, date, hr, t, block, e.currentTarget, () => openSummary(a, date), false) },
      }, h("span", null, t.name), h("span.tag", { class: TAG[t.tag] || "" }, t.tag))));
    };
    paint();
    block.append(filt, listEl);
    openSheet(title, sub, block, [h("div.grow"), h("button.btn", { on: { click: () => openSummary(a, date) } }, "חזרה לסיכום")]);
  }

  /** Remove the substitute of one hour (it goes back to "not assigned"). Sent in the background:
      the row shows "מבטל…" and the summary reloads when שוטף has answered. */
  function removeSub(a, date, hr, el) {
    if (!confirm(`לבטל את השיבוץ של ${hr.substitute} בשעה ${hr.hour}?\nהשעה תחזור להיות לא משובצת בשוטף.`)) return;
    const row = el && el.closest("tr");
    if (row) {
      row.querySelectorAll("button").forEach(b => { b.disabled = true; });
      const cell = row.children[2]; if (cell) cell.textContent = "⏳ מבטל…";
    }
    api(`/api/absences/${a.id}/assign?date=${date}&hour=${hr.hour}`, { method: "DELETE" }).then(res => {
      if (!res.ok) toast("נשלח לשוטף, אבל השיבוץ עדיין מופיע. כדאי לבדוק בטיפולים", true);
      else toast(`✓ השיבוץ של ${res.teacher || hr.substitute} בשעה ${hr.hour} בוטל`);
    }).catch(err => toast(`השיבוץ בשעה ${hr.hour} של ${a.teacher} לא בוטל: ${err.message}`, true))
      .finally(() => { if (row && row.isConnected) openSummary(a, date); loadAbsences(); });
  }

  /** Everything assigned for this absence on this day, and what is missing. */
  async function openSummary(a, date = state.absDate) {
    const title = `סיכום שיבוצים · ${a.teacher}`, sub = `${dayName(date)} ${dm(date)} · ${hoursLabel(a)} · ${a.reason || ""}`;
    openSheet(title, sub, loading());
    let hours;
    try { ({ hours } = await api(`/api/absences/${a.id}/hours?date=${date}`)); }
    catch (err) { openSheet(title, sub, h("div.empty-state", null, err.message)); return; }
    const filled = hours.filter(x => x.substitute).length;
    const pct = hours.length ? Math.round(100 * filled / hours.length) : 100;
    const body = h("div", null,
      h("div.sum-top", null,
        h("div.sum-big", null, `${filled}/${hours.length}`),
        h("div", null, h("b", null, filled === hours.length ? "כל השעות שובצו" : `${hours.length - filled} שעות עוד לא שובצו`),
          h("div.sum-bar", null, h("span", { style: `width:${pct}%` })))),
      hours.length ? h("table.sum-table", null,
        h("thead", null, h("tr", null, h("th", null, "שעה"), h("th", null, "שיעור"), h("th", null, "ממלא מקום"), h("th", null, ""))),
        h("tbody", null, hours.map(x => h("tr", { class: x.substitute ? "" : "missing" },
          h("td", null, x.hour), h("td", null, shortLesson(x.lesson)),
          h("td", null, x.substitute ? x.substitute : h("span.tag.busy", null, "לא שובץ")),
          h("td.sum-act", null,
            h("button.btn.small", { on: { click: () => openReplace(a, date, x) } }, x.substitute ? "החלפה" : "שיבוץ"),
            x.substitute ? h("button.btn.small.danger", { on: { click: e => removeSub(a, date, x, e.currentTarget) } }, "ביטול") : null)))))
        : h("div.empty-state", null, "אין למורה שיעורים עם כיתה בשעות האלה"));
    openSheet(title, sub, body, filled < hours.length
      ? [h("div.grow"), h("button.btn.primary", { on: { click: () => openSubs(a, date) } }, "לשיבוץ השעות החסרות")] : null);
  }

  // ── one teacher (or everyone) between two dates ─────────────────────
  $("#absTools").append(h("button.btn", { id: "absSearch", on: { click: openSearch } }, icon("search"), "חיפוש ודוח"),
    h("button.btn", { id: "absCanceled", on: { click: openCanceled } }, icon("close"), "דיווחים שבוטלו"));
  async function openSearch() {
    openSheet("חיפוש היעדרויות", "מורה וטווח תאריכים", loading());
    let m;
    try { m = await meta(); } catch (err) { openSheet("חיפוש היעדרויות", "", h("div.empty-state", null, err.message)); return; }
    const now = new Date();
    const yearStart = `${now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1}-09-01`;  // school year
    let fromV = yearStart, toV = todayISO();
    const teacher = h("select", null, h("option", { value: "" }, "כל המורים"),
      m.teachers.map(t => h("option", { value: t.id, selected: t.id === state.searchTeacher }, t.name)));
    const to = datePicker({ value: toV, onPick: d => { toV = d; } });
    const from = datePicker({ value: fromV, onPick: d => { fromV = d; if (toV < d) { toV = d; to.setValue(d); } } });
    const quick = h("div.chips", null, [
      ["מתחילת השנה", () => [yearStart, todayISO()]],
      ["החודש", () => [todayISO().slice(0, 8) + "01", todayISO()]],
      ["30 הימים האחרונים", () => [addDays(todayISO(), -30), todayISO()]],
    ].map(([label, fn]) => h("button.chip", { type: "button", on: { click: () => {
      [fromV, toV] = fn(); from.setValue(fromV); to.setValue(toV); run();
    } } }, label)));
    const out = h("div.search-out");
    const q = () => `from=${fromV}&to=${toV}&teacher=${encodeURIComponent(teacher.value)}`;
    let last = null;
    async function run() {
      state.searchTeacher = teacher.value;
      out.replaceChildren(loading("קורא משוטף… טווח ארוך לוקח כמה שניות"));
      try {
        const r = last = await api(`/api/absences/range?${q()}`);
        if (!r.days.length) { out.replaceChildren(h("div.empty-state", null, "לא נמצאו היעדרויות בטווח הזה")); return; }
        const days = new Set(r.days.map(x => x.date + "|" + x.teacher)).size;
        const hours = r.days.reduce((a, x) => a + (x.dayHours || 0), 0);
        const reasons = {};
        r.days.forEach(x => { reasons[x.reason || "ללא סיבה"] = (reasons[x.reason || "ללא סיבה"] || 0) + 1; });
        const all = !teacher.value;
        out.replaceChildren(
          h("div.stat-row", null,
            h("div.stat", null, h("b", null, days), h("span", null, "ימי היעדרות")),
            h("div.stat", null, h("b", null, hours), h("span", null, "שעות")),
            h("div.stat", null, h("b", null, `${r.filled}/${r.lessons}`), h("span", null, "שיעורים שובצו"))),
          h("div.reason-row", null, Object.entries(reasons).map(([k, n]) => h("span.tag", null, `${k}: ${n}`))),
          h("table.sum-table", null,
            h("thead", null, h("tr", null, h("th", null, "תאריך"), all ? h("th", null, "מורה") : null,
              h("th", null, "סיבה"), h("th", null, "שעות"), h("th", null, "שובצו"))),
            h("tbody", null, r.days.slice().reverse().map(x => h("tr", { class: x.lessons && x.filled < x.lessons ? "missing" : "" },
              h("td", null, `${dayName(x.date)} ${dm(x.date)}`), all ? h("td", null, x.teacher) : null,
              h("td", null, x.reason || "", noteBadge(x), x.note ? h("div.muted", null, x.note) : null),
              h("td", null, x.fromHour && x.toHour ? (x.fromHour === 1 && x.toHour === 10 ? "יום מלא" : h("bdi", { dir: "ltr" }, `${x.fromHour}–${x.toHour}`)) : (x.dayHours ?? "")),
              h("td", null, x.lessons ? `${x.filled}/${x.lessons}` : "—"))))));
        dl.disabled = false;
      } catch (err) { out.replaceChildren(h("div.empty-state", null, err.message)); }
    }
    const dl = h("button.btn", { disabled: true, on: { click: async () => {
      dl.disabled = true; const t0 = dl.textContent; dl.textContent = "מכין…";
      try {
        if (tg) {
          await api(`/api/absences/range?${q()}&format=telegram`);
          toast("✓ הדוח נשלח אליך בטלגרם");
        } else {
          const res = await fetch(`/api/absences/range?${q()}&format=xlsx`, { credentials: "same-origin" });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `שגיאה (${res.status})`);
          const name = decodeURIComponent((res.headers.get("Content-Disposition") || "").split("UTF-8''")[1] || "absences.xlsx");
          const a = h("a", { href: URL.createObjectURL(await res.blob()), download: name });
          document.body.append(a); a.click(); a.remove();
          toast("✓ הקובץ ירד");
        }
      } catch (err) { toast(err.message, true); }
      dl.disabled = false; dl.textContent = t0;
    } } }, tg ? "שליחה בטלגרם" : "הורדת אקסל");
    openSheet("חיפוש היעדרויות", "מורה וטווח תאריכים", h("div", null,
      h("div.field", null, h("label", null, "מורה"), teacher),
      h("div.row2", null, h("div.field", null, h("div.label", null, "מתאריך"), from),
        h("div.field", null, h("div.label", null, "עד תאריך"), to)),
      h("div.field", null, quick),
      out),
      [dl, h("div.grow"), h("button.btn.primary", { on: { click: run } }, "חיפוש")]);
  }

  // ── monthly report ──────────────────────────────────────────────────
  $("#absTools").prepend(h("button.btn", { id: "monthReport", on: { click: openReport } }, icon("sheet"), "דוח חודשי"));
  function openReport() {
    const now = new Date();
    const months = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - i, 1));
    let pick = months[0];
    const list = h("div.month-list", null, months.map((d, i) => h("button.chip", {
      class: i === 0 ? "on" : "",
      on: { click: e => { pick = d; list.querySelectorAll(".chip").forEach(c => c.classList.remove("on")); e.currentTarget.classList.add("on"); } },
    }, `${MONTHS[d.getMonth()]} ${d.getFullYear()}`)));
    const ym = () => `${pick.getFullYear()}-${String(pick.getMonth() + 1).padStart(2, "0")}`;
    const dl = h("button.btn.primary", { on: { click: async () => {
      dl.disabled = true; dl.textContent = "מכין…";
      try {
        if (tg) {
          await api(`/api/report/send?month=${ym()}`, { method: "POST" });
          toast("✓ הדוח נשלח אליך בטלגרם"); closeSheet();
        } else {
          const headers = {};
          const res = await fetch(`/api/report?month=${ym()}`, { headers, credentials: "same-origin" });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `שגיאה (${res.status})`);
          const blob = await res.blob();
          const a = h("a", { href: URL.createObjectURL(blob), download: `שיבוצים-${MONTHS[pick.getMonth()]}-${pick.getFullYear()}.xlsx` });
          document.body.append(a); a.click(); a.remove();
          toast("✓ הקובץ ירד"); closeSheet();
        }
      } catch (err) { toast(err.message, true); }
      dl.disabled = false; dl.textContent = tg ? "שליחה בטלגרם" : "הורדת אקסל";
    } } }, tg ? "שליחה בטלגרם" : "הורדת אקסל");
    openSheet("דוח שיבוצים חודשי", "קובץ אקסל: מורה נעדר, סיבה, תאריך, שעה, שיעור, שעות, ממלא מקום", h("div", null,
      h("div.field", null, h("div.label", null, "חודש"), list),
      h("p.muted", null, "השיעורים נלקחים ממערכת השעות הנוכחית בשוטף. הדוח נשלח אליך גם בטלגרם אוטומטית בערב האחרון של כל חודש.")),
      [h("div.grow"), dl]);
  }

  // ── start ───────────────────────────────────────────────────────────
  async function start() {
    $("#app").classList.remove("hidden");
    loadWeek();
    dyInit();
  }
  (async () => {
    if (tg) { tg.ready(); tg.expand(); }
    applyTheme(themeMode());
    try {
      const a = await api("/api/auth");
      if (a.ok) start(); else showLogin();
    } catch (e) { showLogin(); }
  })();
})();
