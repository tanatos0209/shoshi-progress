"use strict";

const {
  ENTRANCES,
  tokyoToday,
  addDays,
  weekdayMon0,
  mondayOf,
  weekLogMinutes,
  formatJPDate,
  formatExamDate,
  computeExamDate,
  examSummary,
  syncStreak,
  addStudySpan,
  addBookStudySpan,
  bookTimeOf,
  formatElapsed,
  createSession,
  tickSession,
  resumeSession,
  startBreak,
  confirmNextSet,
  detachSpans,
  presentSession,
  sanitizeSession
} = ProgressRules;

const OX_URL = "https://tanatos0209.github.io/shoshi-ox/";
/* Daily queue only: 今日の学習を開始, then 復習待ち. Home 択一 stays on OX_URL. */
const OX_QUEUE_URL = "https://tanatos0209.github.io/shoshi-ox/?from=progress&start=today&scope=review";

function oxFrameUrl(queue) {
  return queue ? OX_QUEUE_URL : OX_URL;
}

function queueOpensOx(mode, stepKind) {
  return mode === "guide" && stepKind === "ox";
}

const STORAGE_KEY = "shoshi-progress-v1";
const DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];
const DEMO_HOURS = [1.5, 2.0, 1.0, 2.5, 1.5, 3.0, 2.8];
const DEMO_GOLD = [false, false, false, true, false, true, false];

const stateBox = { data: null };
let session = null;
let ticker = 0;
let lastFlush = 0;
let pendingEntrance = null;
let pendingLeave = null;
let endConfirmOpen = false;
let hashGuard = false;
let lastScreen = "";
let oxRelease = false;
let guideHold = null;
let pickedRate = "";
let cloze = { key: "", total: 0, open: new Set() };
let speedUi = { level: "chapters", chapterId: "", topicId: "", qIndex: 0, feedback: null };
let textPanel = "read";
let aiScope = "text";
let aiSaved = { text: null, workbook: null };
let aiDraft = null;
let aiDirty = false;
let pendingAiLeave = null;
let booksDraft = null;
let bookEditing = null;
let bookFormDirty = false;
let discardKind = "ai";
let bookRun = null;
let bookRunId = "";
let bookTicker = 0;
let bookLeaveAction = null;
let unitTargetId = "";
let unitChoice = "";
const AI_KEYS = {
  text: "shoshi-progress-ai-v1",
  workbook: "shoshi-progress-ai-workbook-v1"
};
const AI_SLOT_COUNT = 20;
const BOOK_LIMIT = 25;
const BOOK_TITLE_MAX = 40;
const BOOK_NOTE_MAX = 80;
const BOOK_IMAGE_MAX = 22000;
const BOOK_COLORS = ["#c0392b", "#f6f1e7", "#1e4d8c", "#8e1b3a", "#1f6b4a", "#d4a017", "#2c3e50", "#e07a3d"];
const DISCARD_COPY = {
  ai: "保存していない画像とメモは残しません。",
  books: "保存していないテキスト・教材の変更は残しません。"
};

function aiStorageKey(scope) {
  return scope === "workbook" ? AI_KEYS.workbook : AI_KEYS.text;
}

function cleanAiImage(value) {
  if (typeof value !== "string" || value.indexOf("data:image/") !== 0) return "";
  return value;
}

function normalizeAiSlots(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const slots = [];
  for (let i = 0; i < AI_SLOT_COUNT; i += 1) {
    const item = list[i] && typeof list[i] === "object" ? list[i] : {};
    slots.push({
      image: cleanAiImage(item.image),
      text: typeof item.text === "string" ? item.text : ""
    });
  }
  return slots;
}

function loadAiSlots(scope) {
  try {
    return normalizeAiSlots(JSON.parse(localStorage.getItem(aiStorageKey(scope)) || "null"));
  } catch (err) {
    return normalizeAiSlots(null);
  }
}

let cloudQuiet = false;

function notifyCloud(kind, payload) {
  if (cloudQuiet) return;
  if (typeof window === "undefined" || !window.ShoshiSync || !window.ShoshiSync.noteLocal) return;
  window.ShoshiSync.noteLocal(kind, payload);
}

function saveAiSlots(slots, scope) {
  const which = scope === "workbook" ? "workbook" : "text";
  aiSaved[which] = normalizeAiSlots(slots);
  try {
    localStorage.setItem(aiStorageKey(which), JSON.stringify(aiSaved[which]));
    notifyCloud(which === "workbook" ? "ai-workbook" : "ai-text", aiSaved[which]);
    return true;
  } catch (err) {
    return false;
  }
}

function ensureAiSlots(scope) {
  const which = scope === "workbook" ? "workbook" : "text";
  if (!aiSaved[which]) aiSaved[which] = loadAiSlots(which);
  return aiSaved[which];
}

function aiSlotsDirty(saved, draft) {
  const left = normalizeAiSlots(saved);
  const right = normalizeAiSlots(draft);
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].image !== right[i].image || left[i].text !== right[i].text) return true;
  }
  return false;
}

function syncAiDirty() {
  aiDirty = aiSlotsDirty(ensureAiSlots(aiScope), aiDraft);
}

function aiHostView() {
  if (session && session.mode === "guide") return "guide";
  return aiScope === "workbook" ? "workbook" : "text";
}

function discardSheetOpen() {
  const sheet = $("ai-discard-sheet");
  return !!(sheet && !sheet.hidden);
}

function makeBookId(seedIndex) {
  const n = Math.max(0, Math.round(Number(seedIndex) || 0));
  return "b" + Date.now().toString(36) + n.toString(36) + Math.random().toString(36).slice(2, 7);
}

function cleanBookImage(value) {
  if (typeof value !== "string") return "";
  if (!/^data:image\/(jpeg|png|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(value)) return "";
  if (value.length > BOOK_IMAGE_MAX) return "";
  return value;
}

function bookColorAt(value, index) {
  if (typeof value === "string" && BOOK_COLORS.indexOf(value) >= 0) return value;
  const n = Math.abs(Math.round(Number(index) || 0));
  return BOOK_COLORS[n % BOOK_COLORS.length];
}

function cleanBookUnit(item) {
  const source = item && typeof item === "object" ? item : {};
  const unit = source.unit === "page" || source.unit === "question" ? source.unit : "";
  const total = Math.round(Number(source.total) || 0);
  if (!unit || total < 1) return { unit: "", total: 0 };
  return { unit: unit, total: Math.min(9999, total) };
}

function foldSubject(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/Ⅰ/g, "I")
    .replace(/Ⅱ/g, "II")
    .replace(/Ⅲ/g, "III")
    .replace(/Ⅳ/g, "IV")
    .replace(/Ⅴ/g, "V")
    .replace(/[IVX]+$/g, "");
}

function bookNamesSubject(book, subject) {
  const core = foldSubject(subject);
  if (core.length < 2) return false;
  const blob = foldSubject((book && book.title) + " " + (book && book.note));
  return blob.indexOf(core) >= 0;
}

function bookGauge(book, plan) {
  const locked = cleanBookUnit(book);
  let current = 0;
  let linked = false;
  if (locked.unit === "page" && plan && plan.text && bookNamesSubject(book, plan.text.subject)) {
    linked = true;
    current = Math.max(0, Math.round(Number(plan.text.read) || 0));
  } else if (locked.unit === "question" && plan && plan.workbook && bookNamesSubject(book, plan.workbook.subject)) {
    linked = true;
    current = Math.max(0, Math.round(Number(plan.workbook.solved) || 0));
  }
  if (locked.total > 0) current = Math.min(current, locked.total);
  else current = 0;
  return { unit: locked.unit, current: current, total: locked.total, linked: linked };
}

function bookGaugeLabel(gauge) {
  const current = Math.max(0, Math.round(Number(gauge && gauge.current) || 0));
  const total = Math.max(0, Math.round(Number(gauge && gauge.total) || 0));
  if (gauge && gauge.unit === "question") return "問" + current + " / 問" + total;
  return "P." + current + " / P." + total;
}

function normalizeBooks(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length && out.length < BOOK_LIMIT; i += 1) {
    const item = list[i];
    if (!item || typeof item !== "object") continue;
    const title = typeof item.title === "string" ? item.title.trim().slice(0, BOOK_TITLE_MAX) : "";
    if (!title) continue;
    let id = typeof item.id === "string" ? item.id.trim().slice(0, 40) : "";
    if (!id || seen.has(id)) id = makeBookId(out.length);
    seen.add(id);
    const note = typeof item.note === "string" ? item.note.trim().slice(0, BOOK_NOTE_MAX) : "";
    const locked = cleanBookUnit(item);
    out.push({
      id: id,
      title: title,
      note: note,
      image: cleanBookImage(item.image),
      color: bookColorAt(item.color, out.length),
      unit: locked.unit,
      total: locked.total
    });
  }
  return out;
}

function copyBook(book) {
  const locked = cleanBookUnit(book);
  return {
    id: book.id,
    title: book.title,
    note: book.note,
    image: book.image,
    color: book.color,
    unit: locked.unit,
    total: locked.total
  };
}

function booksEqual(a, b) {
  const left = normalizeBooks(a);
  const right = normalizeBooks(b);
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].id !== right[i].id) return false;
    if (left[i].title !== right[i].title) return false;
    if (left[i].note !== right[i].note) return false;
    if (left[i].image !== right[i].image) return false;
    if (left[i].color !== right[i].color) return false;
    if (left[i].unit !== right[i].unit) return false;
    if (left[i].total !== right[i].total) return false;
  }
  return true;
}

function emptyBookSlots(count) {
  const n = Math.max(0, Math.min(BOOK_LIMIT, Math.round(Number(count) || 0)));
  if (n >= BOOK_LIMIT) return 0;
  const remain = BOOK_LIMIT - n;
  const pad = (4 - (n % 4)) % 4;
  const want = pad === 0 ? 4 : pad;
  return Math.min(remain, want);
}

function coverInk(color) {
  const hex = String(color || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return "#fffaf0";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luma = (r * 299 + g * 587 + b * 114) / 1000;
  return luma > 170 ? "#2a2116" : "#fffaf0";
}

function savedBooks() {
  return normalizeBooks(stateBox.data && stateBox.data.books);
}

function ensureBooksDraft() {
  if (!booksDraft) booksDraft = savedBooks().map(copyBook);
  return booksDraft;
}

function booksNeedConfirm() {
  if (bookFormDirty) return true;
  if (!booksDraft) return false;
  return !booksEqual(savedBooks(), booksDraft);
}

function openDiscard(kind, action) {
  pendingAiLeave = action;
  discardKind = kind === "books" ? "books" : "ai";
  const sheet = $("ai-discard-sheet");
  if (!sheet || discardSheetOpen()) return;
  const copy = $("ai-discard-copy");
  if (copy) copy.textContent = DISCARD_COPY[discardKind];
  sheet.hidden = false;
  $("ai-discard-yes").focus();
}

function requestLeaveAi(action) {
  if (textPanel !== "ai" || !aiDirty) {
    action();
    return;
  }
  openDiscard("ai", action);
}

function requestLeaveBooks(action) {
  if (!booksNeedConfirm()) {
    action();
    return;
  }
  openDiscard("books", action);
}

function confirmDiscardAi() {
  const kind = discardKind;
  const action = pendingAiLeave;
  pendingAiLeave = null;
  discardKind = "ai";
  $("ai-discard-sheet").hidden = true;
  const copy = $("ai-discard-copy");
  if (copy) copy.textContent = DISCARD_COPY.ai;
  if (kind === "books") {
    booksDraft = null;
    bookFormDirty = false;
    bookEditing = null;
    const editor = $("book-sheet");
    const remove = $("book-delete-sheet");
    if (editor) editor.hidden = true;
    if (remove) remove.hidden = true;
    if (action) action();
    return;
  }
  aiDraft = normalizeAiSlots(ensureAiSlots(aiScope));
  aiDirty = false;
  if (window.ShoshiSync && window.ShoshiSync.recheck) {
    window.ShoshiSync.recheck(aiScope === "workbook" ? "ai-workbook" : "ai-text");
  }
  if (action) action();
}

function cancelDiscardAi() {
  const kind = discardKind;
  pendingAiLeave = null;
  discardKind = "ai";
  if (pendingLeave && !endConfirmOpen) pendingLeave = null;
  $("ai-discard-sheet").hidden = true;
  const copy = $("ai-discard-copy");
  if (copy) copy.textContent = DISCARD_COPY.ai;
  if (kind === "books") {
    if ((location.hash || "") !== "#record") {
      hashGuard = true;
      history.replaceState({ view: "record" }, "", location.pathname + location.search + "#record");
      hashGuard = false;
    }
    show("record");
    return;
  }
  const host = aiHostView();
  if ((location.hash || "") !== "#" + host) {
    hashGuard = true;
    history.replaceState({ view: host }, "", location.pathname + location.search + "#" + host);
    hashGuard = false;
  }
  show(host);
}

function studyView(mode) {
  if (mode === "notes" || mode === "speed" || mode === "ox" || mode === "text" || mode === "workbook" || mode === "guide") return mode;
  return "home";
}

function routeAllowed(view) {
  if (!session) return true;
  if (view === studyView(session.mode)) return true;
  return session.mode === "guide" && (view === "guide" || view === "ox");
}

function sessionShowsTimer(view) {
  if (!session) return false;
  if (view === studyView(session.mode)) return true;
  return session.mode === "guide" && view === "ox";
}

const DAILY_GOAL_MINUTES = 240;

function formatDuration(min) {
  const value = Math.max(0, Math.floor(Number(min) || 0));
  return `${Math.floor(value / 60)}時間${value % 60}分`;
}

/* Display only. Stored minutes and carryMs stay exact. */
function floorStudyMinutes(rec) {
  const minutes = Math.max(0, Number(rec && rec.minutes) || 0);
  const carryMs = Math.max(0, Number(rec && rec.carryMs) || 0);
  return Math.floor((minutes * 60000 + carryMs) / 60000);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function seed() {
  const today = tokyoToday();
  return {
    v: 1,
    examDate: computeExamDate(today),
    dailyGoalMinutes: DAILY_GOAL_MINUTES,
    weeklyGoalHours: 30,
    dailyQuestionGoal: 20,
    streak: 0,
    lastStudyDate: "",
    demo: true,
    studied: false,
    subjects: {
      main: { choice: 18, written: 0 },
      minor: { choice: 5, written: 0 }
    },
    log: {
      [today]: { minutes: 0, questions: 0, carryMs: 0 }
    },
    srs: { notes: {}, speed: {} },
    activeSession: null,
    books: []
  };
}

function cleanSrs(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  Object.keys(raw).forEach((id) => {
    const item = raw[id];
    if (!item || typeof item !== "object") return;
    out[id] = {
      introduced: typeof item.introduced === "string" ? item.introduced : "",
      due: typeof item.due === "string" ? item.due : "",
      interval: Math.max(0, Math.round(Number(item.interval) || 0)),
      priority: Math.max(0, Math.round(Number(item.priority) || 0)),
      lastResult: item.lastResult === "unknown" ? "unknown" : "known",
      lastDay: typeof item.lastDay === "string" ? item.lastDay : ""
    };
  });
  return out;
}

function normalize(data) {
  const base = seed();
  const subjects = data.subjects || {};
  return {
    ...base,
    ...data,
    subjects: {
      main: { ...base.subjects.main, ...(subjects.main || {}) },
      minor: { ...base.subjects.minor, ...(subjects.minor || {}) }
    },
    log: data.log && typeof data.log === "object" ? data.log : base.log,
    srs: {
      notes: cleanSrs(data.srs && data.srs.notes),
      speed: cleanSrs(data.srs && data.srs.speed)
    },
    demo: typeof data.demo === "boolean" ? data.demo : true,
    studied: data.studied === true,
    streak: Math.max(0, Math.round(Number(data.streak) || 0)),
    lastStudyDate: typeof data.lastStudyDate === "string" ? data.lastStudyDate : "",
    activeSession: sanitizeSession(data.activeSession),
    books: normalizeBooks(data && data.books)
  };
}

/* Untouched demo seeds are not real study. A saved session or real minutes stay. */
function settle(data) {
  const today = tokyoToday();
  data.examDate = computeExamDate(today);
  data.dailyGoalMinutes = DAILY_GOAL_MINUTES;
  if (data.demo && !data.studied && !data.activeSession) {
    const prev = (data.log && data.log[today]) || {};
    data.log = {
      [today]: {
        minutes: 0,
        questions: Math.max(0, Math.round(Number(prev.questions) || 0)),
        carryMs: 0
      }
    };
    if (prev.pcs) data.log[today].pcs = prev.pcs;
    if (prev.bookTime) data.log[today].bookTime = prev.bookTime;
    data.streak = 0;
    data.lastStudyDate = "";
  } else {
    syncStreak(data, today);
  }
  Pcs.ensurePlan(data, today);
}

function load() {
  let data = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) data = normalize(JSON.parse(raw));
  } catch (err) {
    /* keep the in-memory seed when storage is blocked */
  }
  if (!data) data = seed();
  settle(data);
  save(data);
  return data;
}

function save(data) {
  stateBox.data = data;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    /* private mode */
  }
  notifyCloud("state", data);
}

function todayRecord(data) {
  const key = tokyoToday();
  const rec = data.log[key] || { minutes: 0, questions: 0 };
  return {
    minutes: Math.max(0, Math.round(Number(rec.minutes) || 0)),
    questions: Math.max(0, Math.round(Number(rec.questions) || 0))
  };
}

function materializeDemo(data) {
  if (!data.demo) return;
  const today = tokyoToday();
  const mon = mondayOf(today);
  const current = data.log[today] || { minutes: 0, questions: 0, carryMs: 0 };
  for (let i = 0; i < 7; i += 1) {
    const key = addDays(mon, i);
    if (key === today) {
      data.log[key] = {
        minutes: Math.max(0, Math.round(Number(current.minutes) || 0)),
        questions: Math.max(0, Math.round(Number(current.questions) || 0)),
        carryMs: Math.max(0, Number(current.carryMs) || 0),
        pcs: current.pcs,
        bookTime: current.bookTime
      };
    } else {
      const prev = data.log[key] || {};
      data.log[key] = {
        minutes: Math.round(DEMO_HOURS[i] * 60),
        questions: Math.max(0, Math.round(Number(prev.questions) || 0)),
        sample: true
      };
    }
  }
  data.demo = false;
}

function weekSeries(data) {
  if (data.demo) {
    return DEMO_HOURS.map((hours, index) => ({
      hours,
      gold: DEMO_GOLD[index],
      label: hours.toFixed(1) + "h"
    }));
  }
  /* This Monday 00:00–Sunday in Asia/Tokyo. Last week's log rows stay stored. */
  const minutes = weekLogMinutes(data.log, tokyoToday());
  return minutes.map((min, index) => {
    const hours = min / 60;
    return {
      hours,
      gold: index === 3 || index === 5,
      label: (Math.round(hours * 10) / 10).toFixed(1) + "h"
    };
  });
}

function $(id) { return document.getElementById(id); }

function renderHome() {
  const data = stateBox.data;
  const today = tokyoToday();
  const summary = examSummary(today);
  const streakBefore = data.streak;
  const lastBefore = data.lastStudyDate;
  let dirty = false;
  if (data.examDate !== summary.examDate) {
    data.examDate = summary.examDate;
    dirty = true;
  }
  syncStreak(data, today);
  if (data.streak !== streakBefore || data.lastStudyDate !== lastBefore) dirty = true;
  if (dirty) save(data);

  $("exam-when").textContent = formatExamDate(summary.examDate);
  $("days-left").textContent = String(Math.max(0, summary.days));
  $("exam-hero").setAttribute("aria-label", summary.label);

  const rec = todayRecord(data);
  const todayLog = data.log[today] || { minutes: rec.minutes, carryMs: 0 };
  $("today-time").textContent = formatDuration(floorStudyMinutes(todayLog));
  $("daily-goal").textContent = "4時間";
  $("streak-n").textContent = String(Math.max(0, data.streak));
  $("week-goal").textContent = String(data.weeklyGoalHours);

  if (data.demo) {
    $("sum-h").textContent = "12";
    $("sum-m").textContent = "30";
  } else {
    const total = weekLogMinutes(data.log, today).reduce((sum, min) => sum + min, 0);
    $("sum-h").textContent = String(Math.floor(total / 60));
    $("sum-m").textContent = String(total % 60);
  }

  const series = weekSeries(data);
  const maxHours = data.demo ? 3 : Math.max(3, ...series.map((item) => item.hours));
  const plot = $("week-bars");
  plot.replaceChildren();
  series.forEach((item) => {
    const col = document.createElement("div");
    col.className = "col";
    const val = document.createElement("span");
    val.className = "val";
    val.textContent = item.label;
    const shaft = document.createElement("div");
    shaft.className = "shaft";
    const bar = document.createElement("i");
    bar.className = item.gold ? "gold" : "green";
    const pct = maxHours ? Math.max(4, Math.round((item.hours / maxHours) * 100)) : 4;
    bar.style.height = (item.hours <= 0 ? 3 : pct) + "%";
    shaft.append(bar);
    col.append(val, shaft);
    plot.append(col);
  });

  const days = $("week-days");
  days.replaceChildren();
  const todayIndex = weekdayMon0(today);
  DAY_LABELS.forEach((label, index) => {
    const span = document.createElement("span");
    span.textContent = label;
    if (index === todayIndex) span.className = "is-today";
    days.append(span);
  });

  const plan = syncPlan();
  const model = Pcs.progress(plan, rec.questions);
  $("today-pct").textContent = model.overall + "%";
  renderKindRows(model);

  paintSubject("main", data.subjects.main);
  paintSubject("minor", data.subjects.minor);
}

function paintSubject(key, subject) {
  const choice = clamp(Math.round(Number(subject.choice) || 0), 0, 100);
  const written = clamp(Math.round(Number(subject.written) || 0), 0, 100);
  const choiceEl = $(key + "-choice");
  const writtenEl = $(key + "-written");
  choiceEl.textContent = choice + "%";
  writtenEl.textContent = written + "%";
  choiceEl.className = choice > 0 ? "gold-text" : "";
  writtenEl.className = written > 0 ? "gold-text" : "";
  const bar = $(key + "-bar");
  bar.style.width = choice + "%";
  bar.style.minWidth = choice > 0 ? "12px" : "0";
}

function currentView() {
  const hash = (location.hash || "#home").replace("#", "");
  const known = ["home", "notes", "ox", "speed", "record", "perfect", "calendar", "settings", "today", "guide", "text", "workbook"];
  return known.includes(hash) ? hash : "home";
}

function oxFrameHref(frame) {
  try {
    return frame.contentWindow && frame.contentWindow.location ? frame.contentWindow.location.href : "";
  } catch (err) {
    return frame.getAttribute("src") || "";
  }
}

function armIframeGuard(frame) {
  try {
    const win = frame.contentWindow;
    if (!win || win.__shoshiGuard) return;
    win.__shoshiGuard = true;
    win.history.pushState({ shoshiGuard: 1 }, "", win.location.href);
    win.addEventListener("popstate", () => {
      if (!session || oxRelease) return;
      try {
        const href = win.location.href;
        if (!href || href === "about:blank") win.location.replace(oxFrameUrl(useQueueOxLink()));
        else win.history.pushState({ shoshiGuard: 1 }, "", href);
      } catch (err) { /* parent session still owns the back gesture */ }
      promptSessionEnd();
    });
  } catch (err) {
    /* cross-origin frame: the parent history guard handles swipe-back */
  }
}

function useQueueOxLink() {
  if (!session || session.mode !== "guide") return false;
  const step = currentStep();
  return queueOpensOx(session.mode, step && step.kind);
}

function ensureOxFrame() {
  const frame = $("ox-frame");
  if (!frame || oxRelease) return;
  const target = oxFrameUrl(useQueueOxLink());
  const href = oxFrameHref(frame);
  if (frame.dataset.loaded === "1" && frame.dataset.oxTarget === target && href.includes("shoshi-ox")) {
    frame.hidden = false;
    return;
  }
  frame.dataset.loaded = "1";
  frame.dataset.oxTarget = target;
  frame.hidden = true;
  frame.onload = () => {
    if (oxRelease || frame.dataset.loaded !== "1") return;
    const next = oxFrameHref(frame);
    if (!next || next === "about:blank" || !next.includes("shoshi-ox")) {
      frame.hidden = true;
      return;
    }
    frame.hidden = false;
    armIframeGuard(frame);
  };
  frame.src = target;
}

function releaseOxFrame() {
  const frame = $("ox-frame");
  if (!frame) return;
  oxRelease = true;
  frame.hidden = true;
  frame.dataset.loaded = "";
  frame.dataset.oxTarget = "";
  frame.onload = null;
  if (frame.getAttribute("src")) frame.src = "about:blank";
}

function show(view) {
  if (view === "guide" && !(session && session.mode === "guide")) {
    navigateTo("today", true);
    return;
  }
  if (view === "guide" && session && session.mode === "guide" && !guideHold) {
    const step = currentStep();
    if (step && step.kind === "ox") {
      navigateTo("ox", true);
      return;
    }
  }
  if (!document.getElementById("view-" + view)) view = "home";
  document.body.classList.remove("is-timing");
  document.querySelectorAll(".view").forEach((node) => {
    const on = node.id === "view-" + view;
    node.hidden = !on;
    node.classList.toggle("is-on", on);
  });
  document.body.classList.toggle("is-ox", view === "ox");
  if (view === "ox") {
    oxRelease = false;
    ensureOxFrame();
  } else releaseOxFrame();

  const learning = view === "notes" || view === "speed" || view === "ox" || view === "text" || view === "workbook" || view === "guide" || view === "today";
  const tab = learning ? "home" : view;
  document.querySelectorAll(".tab").forEach((node) => {
    const on = node.dataset.tab === tab;
    node.classList.toggle("active", on);
    if (on) node.setAttribute("aria-current", "page");
    else node.removeAttribute("aria-current");
  });
  const titles = {
    home: "進捗管理",
    notes: "テキストまとめ",
    speed: "スピードチェック",
    text: "テキスト",
    workbook: "問題集",
    today: "今日の課題",
    guide: "今日の課題",
    record: "記録する",
    perfect: "PCS",
    calendar: "カレンダー",
    settings: "設定",
    ox: "択一対策"
  };
  document.title = view === "home" ? "進捗管理" : titles[view] + " | 進捗管理";
  if (view !== "text" && view !== "workbook" && view !== "guide") {
    textPanel = "read";
    aiDraft = null;
    aiDirty = false;
  } else if (textPanel === "ai" && view !== aiHostView()) {
    textPanel = "read";
    aiDraft = null;
    aiDirty = false;
  }
  if (view !== "record") {
    closeBookSheets();
    if (bookRunId) {
      if (bookRun) commitBookRun(Date.now());
      closeBookRun();
    }
  }
  if (view === "record") fillRecord();
  if (view === "settings") fillSettings();
  if (view !== "ox") {
    const dock = $("ox-dock");
    if (dock) dock.hidden = true;
    document.body.classList.remove("is-guide-ox");
  }
  renderHome();
  if (sessionShowsTimer(view)) renderStudyChrome(presentSession(session, Date.now()));
  else hideStudyChrome();
  if (bookRun && !(session && sessionShowsTimer(view))) renderBookBadge(Date.now());
  if (view === "today") renderToday();
  if (view === "guide") renderGuide();
  if (view === "notes") renderNotes();
  if (view === "speed") renderSpeed();
  if (view === "text") renderRangeInto($("text-root"), "text");
  if (view === "workbook") renderRangeInto($("workbook-root"), "workbook");
  if (view === "ox") renderOxDock();
  window.scrollTo(0, 0);
  requestAnimationFrame(() => window.scrollTo(0, 0));
}

function navigateTo(view, replace) {
  if (!document.getElementById("view-" + view)) view = "home";
  const next = "#" + view;
  if (location.hash !== next) {
    const url = location.pathname + location.search + next;
    hashGuard = true;
    if (replace) history.replaceState({ view }, "", url);
    else history.pushState({ view }, "", url);
    hashGuard = false;
  }
  show(view);
}

function closeBookSheets() {
  bookEditing = null;
  bookFormDirty = false;
  const editor = $("book-sheet");
  const remove = $("book-delete-sheet");
  const file = $("book-file");
  if (editor) editor.hidden = true;
  if (remove) remove.hidden = true;
  if (file) file.value = "";
}

function bookCover(book, className) {
  const cover = el("span", className + (book.image ? " has-image" : " is-plain"));
  cover.style.background = book.color;
  if (book.image) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = book.image;
    cover.append(img);
  } else {
    const label = el("span", "book-cover-label", book.title);
    label.style.color = coverInk(book.color);
    cover.append(label);
  }
  return cover;
}

function bookTile(book) {
  const wrap = el("div", "book-tile");
  const open = el("button", "book-open");
  open.type = "button";
  open.dataset.act = "open-book";
  open.dataset.id = book.id;
  open.setAttribute("aria-label", book.title + "を記録");
  const caption = el("span", "book-caption");
  caption.append(el("b", "", book.title));
  if (book.note) caption.append(el("small", "", book.note));
  open.append(bookCover(book, "book-cover"), caption);
  const edit = el("button", "book-edit", "編集");
  edit.type = "button";
  edit.dataset.act = "edit-book";
  edit.dataset.id = book.id;
  edit.setAttribute("aria-label", book.title + "を編集");
  wrap.append(open, edit);
  return wrap;
}

function addBookTile() {
  const btn = el("button", "book-add", "＋");
  btn.type = "button";
  btn.dataset.act = "add-book";
  btn.setAttribute("aria-label", "教材を追加");
  return btn;
}

function renderBookShelf() {
  const books = ensureBooksDraft();
  const count = $("book-count");
  if (count) count.textContent = String(books.length);
  const grid = $("book-grid");
  if (!grid) return;
  grid.replaceChildren();
  books.forEach((book) => grid.append(bookTile(book)));
  const empties = emptyBookSlots(books.length);
  for (let i = 0; i < empties; i += 1) grid.append(addBookTile());
}

function fillRecord() {
  const date = $("record-date");
  if (date) date.textContent = formatJPDate(tokyoToday());
  renderBookShelf();
}

function paintBookColors() {
  const wrap = $("book-colors");
  if (!wrap || !bookEditing) return;
  wrap.replaceChildren();
  BOOK_COLORS.forEach((color) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "book-swatch";
    btn.style.background = color;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", bookEditing.color === color ? "true" : "false");
    btn.setAttribute("aria-label", "色");
    btn.addEventListener("click", () => {
      if (!bookEditing) return;
      bookEditing.color = color;
      bookFormDirty = true;
      paintBookColors();
    });
    wrap.append(btn);
  });
}

function paintBookImage() {
  const img = $("book-pick-img");
  const ph = $("book-pick-ph");
  const clear = $("book-clear-image");
  const image = bookEditing && bookEditing.image;
  if (!img || !ph || !clear) return;
  if (image) {
    img.src = image;
    img.hidden = false;
    ph.hidden = true;
    clear.hidden = false;
  } else {
    img.removeAttribute("src");
    img.hidden = true;
    ph.hidden = false;
    clear.hidden = true;
  }
}

function openBookEditor(book) {
  const isNew = !book;
  if (isNew && ensureBooksDraft().length >= BOOK_LIMIT) {
    toast("登録は25冊までです");
    return;
  }
  bookEditing = book ? copyBook(book) : {
    id: makeBookId(ensureBooksDraft().length),
    title: "",
    note: "",
    image: "",
    color: bookColorAt("", ensureBooksDraft().length),
    unit: "",
    total: 0
  };
  bookEditing.isNew = isNew;
  bookFormDirty = false;
  $("book-sheet-title").textContent = isNew ? "教材を追加" : "教材を編集";
  $("book-title").value = bookEditing.title;
  $("book-note").value = bookEditing.note;
  $("book-apply").textContent = isNew ? "一覧に追加" : "一覧に反映";
  $("book-delete").hidden = isNew;
  const file = $("book-file");
  if (file) file.value = "";
  paintBookImage();
  paintBookColors();
  $("book-sheet").hidden = false;
  $("book-title").focus();
}

function closeBookEditor() {
  bookEditing = null;
  bookFormDirty = false;
  const sheet = $("book-sheet");
  const file = $("book-file");
  if (sheet) sheet.hidden = true;
  if (file) file.value = "";
}

function readBookForm() {
  if (!bookEditing) return null;
  return {
    id: bookEditing.id,
    title: $("book-title").value.trim().slice(0, BOOK_TITLE_MAX),
    note: $("book-note").value.trim().slice(0, BOOK_NOTE_MAX),
    image: bookEditing.image || "",
    color: bookEditing.color,
    isNew: !!bookEditing.isNew
  };
}

function applyBookForm() {
  const next = readBookForm();
  if (!next) return false;
  if (!next.title) {
    toast("タイトルを入力してください");
    $("book-title").focus();
    return false;
  }
  const draft = ensureBooksDraft();
  const index = draft.findIndex((item) => item.id === next.id);
  if (index < 0 && draft.length >= BOOK_LIMIT) {
    toast("登録は25冊までです");
    return false;
  }
  const prevLocked = cleanBookUnit(index >= 0 ? draft[index] : bookEditing);
  const stored = {
    id: next.id,
    title: next.title,
    note: next.note,
    image: cleanBookImage(next.image),
    color: bookColorAt(next.color, index >= 0 ? index : draft.length),
    unit: prevLocked.unit,
    total: prevLocked.total
  };
  if (index >= 0) draft[index] = stored;
  else draft.push(stored);
  closeBookEditor();
  renderBookShelf();
  return true;
}

function openBookDelete() {
  if (!bookEditing || bookEditing.isNew) return;
  const name = $("book-delete-name");
  const typed = $("book-title").value.trim() || bookEditing.title;
  if (name) name.textContent = typed;
  $("book-delete-sheet").hidden = false;
  $("book-delete-yes").focus();
}

function closeBookDelete() {
  const sheet = $("book-delete-sheet");
  if (sheet) sheet.hidden = true;
}

function confirmBookDelete() {
  if (!bookEditing) return;
  const id = bookEditing.id;
  const draft = ensureBooksDraft();
  const index = draft.findIndex((item) => item.id === id);
  if (index >= 0) draft.splice(index, 1);
  closeBookDelete();
  closeBookEditor();
  renderBookShelf();
}

function storeBookImage(file) {
  fileToImage(file, { maxEdge: 240, qualities: [0.62, 0.48, 0.36], maxChars: BOOK_IMAGE_MAX }).then((url) => {
    if (!bookEditing) return;
    bookEditing.image = url;
    bookFormDirty = true;
    paintBookImage();
  }).catch((err) => {
    toast(err && err.message === "size" ? "表紙画像が大きすぎます" : "画像ファイルを選んでください");
  });
}

function commitBooks() {
  const editor = $("book-sheet");
  if (editor && !editor.hidden) {
    toast("開いている教材を一覧へ反映してください");
    return;
  }
  if (!booksDraft || booksEqual(savedBooks(), booksDraft)) {
    toast("保存する変更はありません");
    return;
  }
  const data = stateBox.data;
  data.books = normalizeBooks(booksDraft);
  save(data);
  booksDraft = savedBooks().map(copyBook);
  bookFormDirty = false;
  renderBookShelf();
  toast("変更を保存しました");
}

function lookupBook(id) {
  const lists = [booksDraft, stateBox.data && stateBox.data.books];
  for (let i = 0; i < lists.length; i += 1) {
    const list = lists[i];
    if (!Array.isArray(list)) continue;
    const found = list.find((item) => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function todayPlan(data) {
  const today = tokyoToday();
  const rec = data && data.log && data.log[today];
  const pcs = rec && rec.pcs;
  if (!pcs || pcs.date !== today) return null;
  return pcs;
}

function bookTodayMs(bookId, now) {
  const stored = bookTimeOf(stateBox.data && stateBox.data.log, tokyoToday(), bookId);
  let ms = stored.minutes * 60000 + stored.carryMs;
  if (bookRun && bookRun.bookId === bookId && now > bookRun.startedAt) ms += now - bookRun.startedAt;
  return ms;
}

function stopBookTicker() {
  clearInterval(bookTicker);
  bookTicker = 0;
}

function renderBookBadge(now) {
  const badge = $("measure-badge");
  if (!badge) return;
  if (session && sessionShowsTimer(currentView())) return;
  if (!bookRun) {
    if (!session) badge.hidden = true;
    return;
  }
  badge.hidden = false;
  $("measure-clock").textContent = formatElapsed(Math.max(0, now - bookRun.startedAt));
}

function startBookTicker() {
  stopBookTicker();
  const frame = () => {
    if (!bookRun) return;
    const now = Date.now();
    renderBookBadge(now);
    if (bookRunId) paintBookRun();
  };
  frame();
  bookTicker = setInterval(frame, 250);
}

function writeBookSpan(id, start, now) {
  if (!(now > start) || !id) return false;
  const data = stateBox.data;
  data.studied = true;
  const today = tokyoToday();
  const rec = data.log[today] || { minutes: 0, carryMs: 0, questions: 0 };
  const pending = (Number(rec.carryMs) || 0) + (now - start);
  const minutesAfter = (Number(rec.minutes) || 0) + Math.floor(pending / 60000);
  if (minutesAfter >= 1) materializeDemo(data);
  addStudySpan(data, start, now);
  addBookStudySpan(data, id, start, now);
  syncStreak(data, today);
  save(data);
  renderHome();
  return true;
}

function commitBookRun(now) {
  if (!bookRun) return false;
  const start = bookRun.startedAt;
  const id = bookRun.bookId;
  bookRun = null;
  stopBookTicker();
  const wrote = writeBookSpan(id, start, now);
  renderBookBadge(now);
  return wrote;
}

function checkpointBookRun(now) {
  if (!bookRun) return;
  const start = bookRun.startedAt;
  const id = bookRun.bookId;
  if (!(now > start)) return;
  writeBookSpan(id, start, now);
  if (bookRun && bookRun.bookId === id) bookRun.startedAt = now;
}

function closeBookRun() {
  bookRunId = "";
  const panel = $("book-run");
  const host = $("book-run-cover");
  if (host) delete host.dataset.bookId;
  if (panel) panel.hidden = true;
  document.body.classList.remove("is-book-run");
}

function paintBookRun() {
  const book = lookupBook(bookRunId);
  const panel = $("book-run");
  if (!book || !panel) {
    if (bookRun) commitBookRun(Date.now());
    closeBookRun();
    return;
  }
  panel.hidden = false;
  document.body.classList.add("is-book-run");
  const host = $("book-run-cover");
  if (host && host.dataset.bookId !== book.id) {
    host.dataset.bookId = book.id;
    host.replaceChildren(bookCover(book, "book-cover book-run-face"));
  }
  const gauge = bookGauge(book, todayPlan(stateBox.data));
  const fraction = $("book-run-fraction");
  if (fraction) fraction.textContent = bookGaugeLabel(gauge);
  const fill = $("book-run-fill");
  if (fill) {
    const pct = gauge.total > 0 ? (gauge.current / gauge.total) * 100 : 0;
    fill.style.width = Math.max(0, Math.min(100, pct)) + "%";
  }
  const today = $("book-run-today");
  if (today) today.textContent = formatDuration(Math.floor(bookTodayMs(book.id, Date.now()) / 60000));
  const toggle = $("book-run-toggle");
  const running = !!(bookRun && bookRun.bookId === book.id);
  if (toggle) {
    toggle.textContent = running ? "ストップ" : "スタート";
    toggle.classList.toggle("is-stop", running);
    toggle.setAttribute("aria-pressed", running ? "true" : "false");
  }
  renderBookBadge(Date.now());
}

function showBookRun(book) {
  if (!book) return;
  bookRunId = book.id;
  paintBookRun();
}

function paintUnitChoice() {
  document.querySelectorAll("[data-unit-choice]").forEach((button) => {
    const on = button.dataset.unitChoice === unitChoice;
    button.setAttribute("aria-checked", on ? "true" : "false");
    button.classList.toggle("is-on", on);
  });
  const label = $("book-unit-total-label");
  if (!label) return;
  if (unitChoice === "question") label.textContent = "全体の問数";
  else if (unitChoice === "page") label.textContent = "全体のページ数";
  else label.textContent = "全体の数";
}

function openUnitSheet(book) {
  unitTargetId = book.id;
  unitChoice = "";
  const input = $("book-unit-total");
  if (input) input.value = "";
  paintUnitChoice();
  $("book-unit-sheet").hidden = false;
  $("book-unit-total").focus();
}

function closeUnitSheet() {
  unitTargetId = "";
  unitChoice = "";
  const sheet = $("book-unit-sheet");
  if (sheet) sheet.hidden = true;
}

function lockBookUnit() {
  if (unitChoice !== "page" && unitChoice !== "question") {
    toast("P. か 問 を選んでください");
    return;
  }
  const total = Math.round(Number($("book-unit-total").value) || 0);
  if (total < 1 || total > 9999) {
    toast("1から9999までで入力してください");
    return;
  }
  const id = unitTargetId;
  const book = lookupBook(id);
  if (!book) {
    closeUnitSheet();
    return;
  }
  if (!book.unit) {
    book.unit = unitChoice;
    book.total = total;
    const saved = stateBox.data.books.find((item) => item.id === id);
    if (saved && saved !== book && !saved.unit) {
      saved.unit = unitChoice;
      saved.total = total;
    }
    if (saved) save(stateBox.data);
    else if (booksDraft && booksDraft.some((item) => item.id === id)) {
      /* unit stays on the shelf draft until 変更を保存 */
    }
  }
  closeUnitSheet();
  renderBookShelf();
  showBookRun(lookupBook(id));
}

function openRegisteredBook(id) {
  if (bookRun && bookRun.bookId !== id) {
    requestCloseBookRun(() => openRegisteredBook(id));
    return;
  }
  const book = lookupBook(id);
  if (!book) return;
  if (!book.unit) {
    openUnitSheet(book);
    return;
  }
  showBookRun(book);
}

function toggleBookRun() {
  if (!bookRunId) return;
  if (bookRun && bookRun.bookId === bookRunId) {
    const wrote = commitBookRun(Date.now());
    paintBookRun();
    if (wrote) toast("この教材に記録しました");
    return;
  }
  if (bookRun) return;
  if (session) {
    toast("いまの計測を終えてから始めてください");
    return;
  }
  bookRun = { bookId: bookRunId, startedAt: Date.now() };
  startBookTicker();
  paintBookRun();
}

function saveBookRun() {
  const wrote = commitBookRun(Date.now());
  closeBookRun();
  renderBookShelf();
  if (wrote) toast("学習時間を記録しました");
}

function requestCloseBookRun(after) {
  if (bookRun) {
    bookLeaveAction = after || null;
    const sheet = $("book-stop-sheet");
    if (sheet) {
      sheet.hidden = false;
      $("book-stop-yes").focus();
    }
    return;
  }
  closeBookRun();
  if (after) after();
}

function confirmDiscardBookRun() {
  bookRun = null;
  stopBookTicker();
  const after = bookLeaveAction;
  bookLeaveAction = null;
  const sheet = $("book-stop-sheet");
  if (sheet) sheet.hidden = true;
  closeBookRun();
  renderBookBadge(Date.now());
  renderBookShelf();
  if (after) after();
}

function cancelDiscardBookRun() {
  bookLeaveAction = null;
  const sheet = $("book-stop-sheet");
  if (sheet) sheet.hidden = true;
}

function fillSettings() {
  const data = stateBox.data;
  $("exam-fixed").textContent = formatJPDate(computeExamDate(tokyoToday()));
  $("weekly-hours").value = String(data.weeklyGoalHours);
  $("daily-questions").value = String(data.dailyQuestionGoal);
}

let toastTimer = 0;
function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 1600);
}

function saveSettings() {
  const data = stateBox.data;
  const week = clamp(Math.round(Number($("weekly-hours").value) || 0), 1, 168);
  const questions = clamp(Math.round(Number($("daily-questions").value) || 0), 1, 500);
  data.examDate = computeExamDate(tokyoToday());
  data.dailyGoalMinutes = DAILY_GOAL_MINUTES;
  data.weeklyGoalHours = week;
  data.dailyQuestionGoal = questions;
  save(data);
  fillSettings();
  renderHome();
  toast("設定を保存しました");
}

function hideStudyChrome() {
  $("measure-badge").hidden = true;
  $("pom-overlay").hidden = true;
}

function renderStudyChrome(view) {
  const counting = view.screen === "work" || view.screen === "workDone";
  $("measure-badge").hidden = !counting;
  if (counting) $("measure-clock").textContent = view.clock;

  const showOver = view.screen === "workDone";
  const showBreak = view.screen === "break";
  const showAsk = view.screen === "breakDone";
  $("pom-overlay").hidden = !(showOver || showBreak || showAsk);
  $("pom-over").hidden = !showOver;
  $("pom-break").hidden = !showBreak;
  $("pom-ask").hidden = !showAsk;
  if (showBreak) $("break-time").textContent = view.clock;
  if (showAsk) {
    $("break-over").hidden = !view.breakOver;
    if (view.breakOver) $("break-over").textContent = view.breakOver;
    $("ask-foot-label").textContent = view.footer;
  }

  if (view.screen !== lastScreen) {
    const messages = {
      work: "計測中 " + view.clock,
      workDone: "終了してください",
      break: "休憩中。勉強計測は停止中",
      breakDone: "次のセットを始めますか？"
    };
    $("timer-live").textContent = messages[view.screen] || "";
    lastScreen = view.screen;
  }
}

function pulse(el) {
  if (!el) return;
  el.classList.remove("nudge");
  void el.offsetWidth;
  el.classList.add("nudge");
}

function flushSession(now, ending) {
  if (!session) return;
  const detached = detachSpans(session, now);
  session = detached.session;
  let added = 0;
  detached.spans.forEach((pair) => {
    added += Math.max(0, pair[1] - pair[0]);
  });
  if (added > 0) {
    const data = stateBox.data;
    data.studied = true;
    const today = tokyoToday();
    const rec = data.log[today] || { minutes: 0, carryMs: 0 };
    const pending = (Number(rec.carryMs) || 0) + added;
    const minutesAfter = (Number(rec.minutes) || 0) + Math.floor(pending / 60000);
    if (minutesAfter >= 1) materializeDemo(data);
    detached.spans.forEach((pair) => addStudySpan(data, pair[0], pair[1]));
    syncStreak(data, today);
  }
  stateBox.data.activeSession = ending ? null : session;
  save(stateBox.data);
}

function startTicker() {
  stopTicker();
  lastFlush = Date.now();
  const frame = () => {
    if (!session) return;
    const now = Date.now();
    const phase = session.phase;
    session = tickSession(session, now);
    if (session.phase !== phase) {
      flushSession(now, false);
      lastFlush = now;
    }
    const view = presentSession(session, now);
    if (view.nudge >= 1 && view.nudge > session.seenNudge) {
      session = { ...session, seenNudge: view.nudge };
      stateBox.data.activeSession = session;
      save(stateBox.data);
      pulse(view.screen === "workDone" ? $("pom-over") : $("pom-ask"));
    }
    if (sessionShowsTimer(currentView())) renderStudyChrome(view);
    if (now - lastFlush >= 5000) {
      flushSession(now, false);
      lastFlush = now;
    }
  };
  frame();
  ticker = setInterval(frame, 250);
}

function stopTicker() {
  clearInterval(ticker);
  ticker = 0;
}

function armStudyGuard() {
  if (!session) return;
  const view = studyView(session.mode);
  const url = location.pathname + location.search + "#" + view;
  hashGuard = true;
  history.pushState({ studyGuard: true, view }, "", url);
  hashGuard = false;
}

function enterStudy(mode) {
  const view = mode === "guide" ? guideSurface() : studyView(mode);
  navigateTo(view);
  armStudyGuard();
  startTicker();
}

function promptSessionEnd() {
  if (!session) return;
  const view = studyView(session.mode);
  hashGuard = true;
  history.pushState({ studyGuard: true, view }, "", location.pathname + location.search + "#" + view);
  hashGuard = false;
  if (endConfirmOpen) return;
  oxRelease = false;
  show(view);
  if (view === "ox") {
    const frame = $("ox-frame");
    const href = frame ? oxFrameHref(frame) : "";
    if (!href.includes("shoshi-ox")) {
      if (frame) frame.hidden = true;
      ensureOxFrame();
    }
  }
  pendingLeave = "home";
  openEndConfirm();
}

function openStart(mode) {
  if (bookRun) {
    toast("教材の計測を止めてから始めてください");
    return;
  }
  if (session || !ENTRANCES[mode]) return;
  pendingEntrance = mode;
  $("start-mode").textContent = ENTRANCES[mode];
  window.scrollTo(0, 0);
  $("start-sheet").hidden = false;
  $("start-yes").focus();
}

function closeStart() {
  $("start-sheet").hidden = true;
  pendingEntrance = null;
}

function beginFromConfirm() {
  const mode = pendingEntrance;
  closeStart();
  if (!mode || session) return;
  if (mode === "speed") {
    speedUi = { level: "chapters", chapterId: "", topicId: "", qIndex: 0, feedback: null };
    pickedRate = "";
    cloze = { key: "", total: 0, open: new Set() };
  }
  if (mode === "text" || mode === "workbook") {
    textPanel = "read";
    aiDraft = null;
    aiDirty = false;
  }
  session = createSession(mode, Date.now());
  lastScreen = "";
  stateBox.data.activeSession = session;
  save(stateBox.data);
  enterStudy(mode);
}

function openEndConfirm() {
  if (!session || endConfirmOpen) return;
  if (textPanel === "ai" && aiDirty) {
    requestLeaveAi(() => openEndConfirm());
    return;
  }
  endConfirmOpen = true;
  $("end-sheet").hidden = false;
  $("end-title").focus();
}

function closeEndConfirm() {
  endConfirmOpen = false;
  pendingLeave = null;
  $("end-sheet").hidden = true;
}

function finishSession() {
  if (!session) return;
  if (textPanel === "ai" && aiDirty) {
    requestLeaveAi(() => finishSession());
    return;
  }
  const dest = pendingLeave || (session.mode === "guide" ? "today" : "home");
  pendingLeave = null;
  stopTicker();
  flushSession(Date.now(), true);
  session = null;
  guideHold = null;
  pickedRate = "";
  textPanel = "read";
  lastScreen = "";
  closeEndConfirm();
  hideStudyChrome();
  navigateTo(dest, true);
  toast("学習時間を記録しました");
}

function syncPlan() {
  const data = stateBox.data;
  const today = tokyoToday();
  if (!data.log[today]) data.log[today] = { minutes: 0, questions: 0, carryMs: 0 };
  const had = !!(data.log[today].pcs && data.log[today].pcs.date === today);
  const plan = Pcs.ensurePlan(data, today);
  if (!had) save(data);
  return plan;
}

function renderKindRows(model) {
  const list = $("kind-list");
  if (!list) return;
  list.replaceChildren();
  model.rows.forEach((row) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kind-row";
    button.dataset.entrance = row.id;
    button.setAttribute("aria-label", row.label + " " + row.percent + "%");
    const name = document.createElement("span");
    name.className = "kind-name";
    name.textContent = row.label;
    const track = document.createElement("span");
    track.className = "kind-bar";
    track.setAttribute("aria-hidden", "true");
    const fill = document.createElement("i");
    fill.style.width = Math.max(0, Math.min(100, row.percent)) + "%";
    track.append(fill);
    const pct = document.createElement("span");
    pct.className = "kind-pct";
    pct.textContent = row.percent + "%";
    const chev = document.createElement("span");
    chev.className = "kind-chev";
    chev.setAttribute("aria-hidden", "true");
    chev.textContent = "›";
    button.append(name, track, pct, chev);
    list.append(button);
  });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function currentStep() {
  const today = tokyoToday();
  const plan = Pcs.ensurePlan(stateBox.data, today);
  return Pcs.nextStep(plan, todayRecord(stateBox.data).questions);
}

function guideSurface() {
  if (guideHold) return "guide";
  const step = currentStep();
  if (step && step.kind === "ox") return "ox";
  return "guide";
}

function afterPcsChange() {
  save(stateBox.data);
  renderHome();
  if (!(session && session.mode === "guide")) {
    if (currentView() === "notes") renderNotes();
    if (currentView() === "speed") renderSpeed();
    if (currentView() === "today") renderToday();
    if (currentView() === "text") renderRangeInto($("text-root"), "text");
    if (currentView() === "workbook") renderRangeInto($("workbook-root"), "workbook");
    return;
  }
  const surface = guideSurface();
  if (currentView() !== surface) navigateTo(surface);
  else if (surface === "guide") renderGuide();
  else renderOxDock();
}

function prepareCloze(key, total) {
  if (cloze.key !== key) {
    cloze = { key, total, open: new Set() };
    pickedRate = "";
  } else {
    cloze.total = total;
  }
}

function appendBlank(parent, answer, index) {
  const open = cloze.open.has(index);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "blank" + (open ? " is-open" : "");
  button.dataset.act = "blank";
  button.dataset.index = String(index);
  button.textContent = open ? answer : "　";
  button.style.minWidth = Math.max(2.4, answer.length) + "em";
  button.setAttribute("aria-pressed", open ? "true" : "false");
  button.setAttribute("aria-label", open ? answer : "空欄");
  parent.append(button);
}

function appendEye(pad) {
  const eye = el("button", "eye-btn");
  eye.type = "button";
  eye.dataset.act = "eye";
  const open = cloze.total > 0 && cloze.open.size >= cloze.total;
  eye.textContent = open ? "答えを隠す" : "答えを表示";
  eye.setAttribute("aria-pressed", open ? "true" : "false");
  pad.append(eye);
}

function appendStop(pad) {
  if (!session) return;
  const stop = el("button", "btn-quiet", "いったん終了");
  stop.type = "button";
  stop.dataset.act = "stop-study";
  pad.append(stop);
}

function bookMark() {
  const wrap = el("div", "text-book");
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = '<svg viewBox="0 0 48 48"><path fill="#F0D078" d="M23.4 13.2c-4.4-2.5-9.6-3.6-15.2-2.2-.5.1-1 .6-1 1.2v20.6c0 .7.6 1.2 1.3 1.1 5.6-1.2 10.2-.2 14.9 2.4V13.2z"/><path fill="#E2B84C" d="M24.6 13.2c4.4-2.5 9.6-3.6 15.2-2.2.5.1 1 .6 1 1.2v20.6c0 .7-.6 1.2-1.3 1.1-5.6-1.2-10.2-.2-14.9 2.4V13.2z"/><path fill="#fff6d4" d="M22.7 14.4h2.6V35h-2.6z"/></svg>';
  return wrap;
}

function paintTextRange(input) {
  const max = Number(input.max) || 1;
  const pct = Math.max(0, Math.min(100, (Number(input.value) / max) * 100));
  input.style.setProperty("--fill", pct + "%");
}

const RANGE_SCREENS = {
  text: {
    scope: "text",
    title: "テキスト",
    subtitle: () => "Vマジック",
    quota: (item) => Pcs.textQuotaLine(item),
    range: (item) => Pcs.textRangeLabel(item),
    meta: (item) => Pcs.textMetaLine(item),
    count: (value, total) => Pcs.textCountLabel(value, total),
    total: (item) => item.pages,
    value: (item) => item.read,
    sliderLabel: "読んだページ",
    confirmLabel: "この範囲を読んだ",
    toast: "読んだページを記録しました"
  },
  workbook: {
    scope: "workbook",
    title: "問題集",
    subtitle: (item) => (item && item.subtitle) || "合格ゾーン択一",
    quota: (item) => Pcs.workbookQuotaLine(item),
    range: (item) => Pcs.workbookRangeLabel(item),
    meta: (item) => Pcs.workbookMetaLine(item),
    count: (value, total) => Pcs.workbookCountLabel(value, total),
    total: (item) => item.count,
    value: (item) => item.solved,
    sliderLabel: "解いた問題数",
    confirmLabel: "この範囲を解いた",
    toast: "解いた問題数を記録しました"
  }
};

function rangeSpec(kind) {
  return kind === "workbook" ? RANGE_SCREENS.workbook : RANGE_SCREENS.text;
}

function rangeItem(kind) {
  const plan = Pcs.ensurePlan(stateBox.data, tokyoToday());
  return kind === "workbook" ? plan.workbook : plan.text;
}

function renderRangeScreen(parent, kind) {
  const spec = rangeSpec(kind);
  const item = rangeItem(spec.scope);
  const total = spec.total(item);
  const screen = el("div", "text-screen" + (sessionShowsTimer(currentView()) ? " has-timer" : ""));
  const head = el("header", "text-head");
  head.append(bookMark());
  const main = el("div", "text-titles");
  main.append(el("h1", "", spec.title));
  main.append(el("p", "text-source", spec.subtitle(item)));
  const ai = el("button", "ai-pill", "AIサポート");
  ai.type = "button";
  ai.dataset.act = "open-ai";
  ai.dataset.scope = spec.scope;
  head.append(main, ai);
  screen.append(head);

  const quota = el("section", "card text-quota-card");
  quota.append(el("p", "text-kicker", "今日のノルマ"));
  quota.append(el("p", "text-quota", spec.quota(item)));
  screen.append(quota);

  const rangeCard = el("section", "card text-range-card");
  rangeCard.append(el("p", "text-kicker", "今日の範囲"));
  rangeCard.append(el("p", "text-span", spec.range(item)));
  rangeCard.append(el("p", "text-meta", spec.meta(item)));
  const range = document.createElement("input");
  range.type = "range";
  range.className = "text-range";
  range.min = "0";
  range.max = String(total);
  range.step = "1";
  range.value = String(spec.value(item));
  range.setAttribute("aria-label", spec.sliderLabel);
  const count = el("p", "text-pages", spec.count(spec.value(item), total));
  range.addEventListener("input", () => {
    count.textContent = spec.count(range.value, total);
    paintTextRange(range);
  });
  rangeCard.append(range);
  rangeCard.append(count);
  paintTextRange(range);
  const done = el("button", "btn-gold", spec.confirmLabel);
  done.type = "button";
  done.dataset.act = "confirm-range";
  done.dataset.kind = spec.scope;
  const home = el("button", "text-home", "ホームへ戻る");
  home.type = "button";
  home.dataset.act = "text-home";
  rangeCard.append(done, home);
  screen.append(rangeCard);
  parent.replaceChildren(screen);
}

function fileToImage(file, options) {
  const opts = options || {};
  const maxEdge = Math.max(32, Math.round(Number(opts.maxEdge) || 800));
  const qualities = Array.isArray(opts.qualities) && opts.qualities.length ? opts.qualities : [0.65];
  const maxChars = Math.max(0, Math.round(Number(opts.maxChars) || 0));
  return new Promise((resolve, reject) => {
    if (!file || !file.type || file.type.indexOf("image/") !== 0) {
      reject(new Error("type"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const longest = Math.max(img.width || maxEdge, img.height || maxEdge, 1);
        const fit = Math.min(1, maxEdge / longest);
        const baseW = Math.max(1, Math.round((img.width || maxEdge) * fit));
        const baseH = Math.max(1, Math.round((img.height || maxEdge) * fit));
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const scales = maxChars ? [1, 0.85, 0.7, 0.55, 0.4] : [1];
        let last = "";
        for (let s = 0; s < scales.length; s += 1) {
          const width = Math.max(1, Math.round(baseW * scales[s]));
          const height = Math.max(1, Math.round(baseH * scales[s]));
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);
          for (let q = 0; q < qualities.length; q += 1) {
            last = canvas.toDataURL("image/jpeg", qualities[q]);
            if (!maxChars || last.length <= maxChars) {
              resolve(last);
              return;
            }
          }
        }
        if (maxChars && last.length > maxChars) reject(new Error("size"));
        else resolve(last);
      };
      img.onerror = () => reject(new Error("img"));
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

function rerenderRangeSurface() {
  const view = currentView();
  if (view === "text") renderRangeInto($("text-root"), "text");
  else if (view === "workbook") renderRangeInto($("workbook-root"), "workbook");
  else if (view === "guide") renderGuide();
}

function storeSlotImage(index, file) {
  if (!aiDraft) aiDraft = normalizeAiSlots(ensureAiSlots(aiScope));
  fileToImage(file).then((url) => {
    if (!aiDraft[index]) return;
    aiDraft[index].image = url;
    syncAiDirty();
    rerenderRangeSurface();
  }).catch(() => {
    toast("画像ファイルを選んでください");
  });
}

function commitAiDraft() {
  if (!aiDraft) aiDraft = normalizeAiSlots(ensureAiSlots(aiScope));
  if (!saveAiSlots(aiDraft, aiScope)) {
    toast("この端末に保存できませんでした");
    return;
  }
  aiDraft = normalizeAiSlots(aiSaved[aiScope === "workbook" ? "workbook" : "text"]);
  aiDirty = false;
  toast("変更を保存しました");
}

function renderAiSupport(parent) {
  if (!aiDraft) aiDraft = normalizeAiSlots(ensureAiSlots(aiScope));
  const slots = aiDraft;
  const screen = el("div", "text-screen ai-screen" + (sessionShowsTimer(currentView()) ? " has-timer" : ""));
  const head = el("header", "ai-head");
  const back = el("button", "ai-back", "‹");
  back.type = "button";
  back.dataset.act = "back-text";
  back.setAttribute("aria-label", aiScope === "workbook" ? "問題集へ戻る" : "テキストへ戻る");
  head.append(back);
  head.append(el("h1", "ai-title", "AIサポート"));
  head.append(el("p", "ai-count", "20枠"));
  screen.append(head);
  const list = el("div", "ai-list");
  slots.forEach((slot, index) => {
    const row = el("div", "ai-slot");
    row.append(el("span", "ai-num", String(index + 1).padStart(2, "0")));
    const wrap = el("div", "ai-pick-wrap");
    const pick = el("label", "ai-pick");
    pick.tabIndex = 0;
    if (slot.image) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = slot.image;
      pick.append(img);
      const clear = el("button", "ai-x", "×");
      clear.type = "button";
      clear.dataset.act = "clear-ai-image";
      clear.dataset.index = String(index);
      clear.setAttribute("aria-label", (index + 1) + "枠の画像を消す");
      wrap.append(pick, clear);
    } else {
      pick.append(el("span", "ai-ph", "画像"));
      wrap.append(pick);
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.setAttribute("aria-label", (index + 1) + "枠の画像");
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (file) storeSlotImage(index, file);
    });
    pick.addEventListener("paste", (event) => {
      const items = event.clipboardData && event.clipboardData.items;
      if (!items) return;
      for (let i = 0; i < items.length; i += 1) {
        if (items[i].type && items[i].type.indexOf("image/") === 0) {
          event.preventDefault();
          storeSlotImage(index, items[i].getAsFile());
          break;
        }
      }
    });
    pick.append(input);
    const memo = document.createElement("textarea");
    memo.className = "ai-memo";
    memo.placeholder = "メモ・質問";
    memo.value = slot.text;
    memo.setAttribute("aria-label", (index + 1) + "枠のメモ");
    memo.addEventListener("input", () => {
      if (!aiDraft[index]) return;
      aiDraft[index].text = memo.value;
      syncAiDirty();
    });
    row.append(wrap, memo);
    list.append(row);
  });
  screen.append(list);
  const saveBar = el("div", "ai-save");
  const save = el("button", "btn-gold", "変更を保存");
  save.type = "button";
  save.dataset.act = "save-ai";
  saveBar.append(save);
  screen.append(saveBar);
  parent.replaceChildren(screen);
}

function renderRangeInto(parent, kind) {
  if (!parent) return;
  if (textPanel === "ai") renderAiSupport(parent);
  else renderRangeScreen(parent, kind);
}

function leaveTextHome() {
  if (!session) {
    navigateTo("home");
    return;
  }
  pendingLeave = "home";
  openEndConfirm();
}

function renderToday() {
  const root = $("today-root");
  if (!root) return;
  const today = tokyoToday();
  const plan = Pcs.ensurePlan(stateBox.data, today);
  const questions = todayRecord(stateBox.data).questions;
  const list = Pcs.taskList(plan, questions);
  const model = Pcs.progress(plan, questions);
  const step = Pcs.nextStep(plan, questions);
  root.replaceChildren();
  const head = el("header", "subhead");
  head.append(el("h1", "", "今日の課題"));
  root.append(head);
  root.append(el("p", "lead", "この順に進みます。途中でやめても、残りから再開できます。"));
  const overall = el("p", "task-overall");
  overall.append(document.createTextNode("総合 "));
  overall.append(el("b", "gold-text", model.overall + "%"));
  root.append(overall);
  const ol = el("ol", "task-list");
  list.forEach((item, index) => {
    const li = el("li", "task-item" + (item.current ? " is-current" : "") + (item.finished ? " is-done" : ""));
    li.append(el("span", "task-no", String(index + 1)));
    li.append(el("span", "task-label", item.label));
    li.append(el("span", "task-status", item.status));
    ol.append(li);
  });
  root.append(ol);
  if (!step) {
    root.append(el("p", "hint", "今日の分は終わりました。"));
    return;
  }
  if (Pcs.hasResume(plan, questions)) root.append(el("p", "hint", "残りから再開します。"));
  const begin = el("button", "cta today-begin");
  begin.type = "button";
  begin.dataset.act = "begin-today";
  begin.append(el("strong", "", "はじめる"));
  root.append(begin);
}

function renderPlaceholder(parent, step) {
  const row = Pcs.ROWS.find((item) => item.id === step.kind);
  parent.replaceChildren();
  const pad = el("div", "study-pad center-pad");
  pad.append(el("p", "eyebrow", Pcs.stepLabel(step)));
  pad.append(el("h2", "study-title", row ? row.label : ""));
  pad.append(el("p", "ph-badge", "準備中"));
  pad.append(el("p", "hint center-copy", "この項目は、まだ使えません。次の課題へ進みます。"));
  const next = el("button", "btn-gold", "次へ");
  next.type = "button";
  next.dataset.act = "pass-placeholder";
  pad.append(next);
  appendStop(pad);
  parent.append(pad);
}

function renderNoteCard(parent, topic, meta) {
  parent.replaceChildren();
  const pad = el("div", "study-pad");
  if (!topic) {
    parent.append(pad);
    return;
  }
  pad.append(el("p", "eyebrow", meta.eyebrow));
  pad.append(el("h2", "study-title", topic.title));
  const chips = el("div", "chip-line");
  chips.append(el("span", "pill", meta.role === "review" ? "復習" : "新規"));
  chips.append(el("span", "pill", "出典 " + Pcs.sourceName(topic.source)));
  chips.append(el("span", "pill pill-dim", meta.countLabel));
  pad.append(chips);
  const sentence = el("p", "cloze");
  const total = topic.parts.filter((part) => typeof part !== "string").length;
  prepareCloze("note:" + topic.id, total);
  let cursor = 0;
  topic.parts.forEach((part) => {
    if (typeof part === "string") {
      sentence.append(document.createTextNode(part));
      return;
    }
    appendBlank(sentence, part.a, cursor);
    cursor += 1;
  });
  pad.append(sentence);
  appendEye(pad);
  const row = el("div", "rate-row");
  ["わかった", "わからない"].forEach((label, index) => {
    const result = index === 0 ? "known" : "unknown";
    const button = el("button", "tbtn " + (result === "known" ? "tbtn-gold" : "tbtn-ghost"), label);
    button.type = "button";
    button.dataset.act = "rate-note";
    button.dataset.result = result;
    row.append(button);
  });
  pad.append(row);
  pad.append(el("p", "hint", "理解度は明日の優先に使います。今日の達成率には、どちらの答えも同じように入ります。"));
  appendStop(pad);
  parent.append(pad);
}

function renderNotes() {
  const root = $("notes-root");
  if (!root) return;
  const plan = Pcs.ensurePlan(stateBox.data, tokyoToday());
  const id = plan.notes.ids.find((item) => plan.notes.done.indexOf(item) === -1);
  if (!id) {
    root.replaceChildren();
    const pad = el("div", "study-pad center-pad");
    pad.append(el("h2", "study-title", "今日のテキストまとめは終わりました"));
    const home = el("a", "ph-back", "ホームへ戻る");
    home.href = "#home";
    pad.append(home);
    appendStop(pad);
    root.append(pad);
    return;
  }
  renderNoteCard(root, Pcs.noteById(id), {
    eyebrow: "テキストまとめ",
    role: plan.notes.roles[id] || "new",
    countLabel: (plan.notes.done.length + 1) + "/" + plan.notes.ids.length
  });
}

function renderSpeedPoints(parent, topic, meta) {
  parent.replaceChildren();
  const pad = el("div", "study-pad");
  if (!topic) {
    pad.append(el("p", "hint", "論点を表示できません。"));
    parent.append(pad);
    return;
  }
  pad.append(el("p", "eyebrow", meta.eyebrow));
  if (!meta.guide) {
    const back = el("button", "text-back", "論点一覧へ");
    back.type = "button";
    back.dataset.act = "speed-back";
    pad.append(back);
  }
  pad.append(el("h2", "study-title", topic.title));
  const total = topic.points.reduce((sum, parts) => sum + parts.filter((part) => typeof part !== "string").length, 0);
  prepareCloze("speed:" + topic.id, total);
  const points = el("div", "point-list");
  let cursor = 0;
  topic.points.forEach((parts) => {
    const line = el("p", "cloze");
    parts.forEach((part) => {
      if (typeof part === "string") {
        line.append(document.createTextNode(part));
        return;
      }
      appendBlank(line, part.a, cursor);
      cursor += 1;
    });
    points.append(line);
  });
  pad.append(points);
  appendEye(pad);
  const go = el("button", "btn-gold", "ここから出題する");
  go.type = "button";
  go.dataset.act = "speed-go";
  go.dataset.topic = topic.id;
  pad.append(go);
  pad.append(el("p", "hint", "理解度を選んでから出題します。選ばないときは、わかったとして進みます。"));
  const rates = el("div", "rate-row");
  ["わかった", "わからない"].forEach((label, index) => {
    const result = index === 0 ? "known" : "unknown";
    const button = el("button", "tbtn " + (result === "known" ? "tbtn-gold" : "tbtn-ghost") + (pickedRate === result ? " is-picked" : ""), label);
    button.type = "button";
    button.dataset.act = "pick-rate";
    button.dataset.result = result;
    rates.append(button);
  });
  pad.append(rates);
  appendStop(pad);
  parent.append(pad);
}

function renderChapters(parent) {
  parent.replaceChildren();
  const pad = el("div", "study-pad");
  pad.append(el("p", "eyebrow", "スピードチェック"));
  pad.append(el("h2", "study-title", "章を選ぶ"));
  Pcs.SPEED_CHAPTERS.forEach((chapter) => {
    const button = el("button", "nav-card");
    button.type = "button";
    button.dataset.act = "speed-chapter";
    button.dataset.id = chapter.id;
    button.append(el("span", "", chapter.title));
    button.append(el("small", "", chapter.topics.length + "論点"));
    pad.append(button);
  });
  appendStop(pad);
  parent.append(pad);
}

function renderTopicList(parent) {
  const chapter = Pcs.SPEED_CHAPTERS.find((item) => item.id === speedUi.chapterId) || Pcs.SPEED_CHAPTERS[0];
  const plan = Pcs.ensurePlan(stateBox.data, tokyoToday());
  parent.replaceChildren();
  const pad = el("div", "study-pad");
  const back = el("button", "text-back", "章一覧へ");
  back.type = "button";
  back.dataset.act = "speed-back";
  pad.append(back);
  pad.append(el("h2", "study-title", chapter.title));
  chapter.topics.forEach((topic) => {
    const button = el("button", "nav-card");
    button.type = "button";
    button.dataset.act = "speed-topic";
    button.dataset.id = topic.id;
    button.append(el("span", "", topic.title));
    if (plan.speed.topics.indexOf(topic.id) !== -1) button.append(el("small", "", "今日"));
    pad.append(button);
  });
  appendStop(pad);
  parent.append(pad);
}

function currentBrowseQuestionId() {
  const topic = Pcs.speedTopicById(speedUi.topicId);
  if (!topic || !topic.questions.length) return "";
  const index = Math.min(speedUi.qIndex, topic.questions.length - 1);
  return topic.questions[index].id;
}

function renderQuiz(parent, qid, guide) {
  const question = Pcs.speedQuestionById(qid);
  const topic = Pcs.speedTopicById(Pcs.topicIdOfQuestion(qid));
  const hold = guide ? guideHold : speedUi.feedback;
  parent.replaceChildren();
  const pad = el("div", "study-pad");
  if (!question) {
    pad.append(el("p", "hint", "問題がありません。"));
    parent.append(pad);
    return;
  }
  pad.append(el("p", "eyebrow", guide ? Pcs.stepLabel({ kind: "speed" }) : "スピードチェック"));
  if (!guide) {
    const back = el("button", "text-back", "要点へ");
    back.type = "button";
    back.dataset.act = "speed-back";
    pad.append(back);
  }
  pad.append(el("h2", "study-title", topic ? topic.title : "○×"));
  const plan = Pcs.ensurePlan(stateBox.data, tokyoToday());
  const list = (topic ? topic.questions : []).map((item) => item.id);
  const index = Math.max(0, list.indexOf(qid));
  pad.append(el("p", "pill pill-dim", "○× " + (index + 1) + "/" + list.length));
  pad.append(el("p", "quiz-prompt", question.prompt));
  if (hold && hold.questionId === qid) {
    pad.append(el("p", "judge " + (hold.correct ? "ok" : "ng"), hold.correct ? "正解" : "不正解"));
    pad.append(el("p", "hint", question.explain));
    const next = el("button", "btn-gold", "次へ");
    next.type = "button";
    next.dataset.act = guide ? "guide-next" : "speed-next";
    pad.append(next);
  } else {
    const row = el("div", "ox-choices");
    const yes = el("button", "choice", "○");
    yes.type = "button";
    yes.dataset.act = "speed-answer";
    yes.dataset.choice = "o";
    yes.dataset.qid = qid;
    yes.setAttribute("aria-label", "正しい");
    const no = el("button", "choice", "×");
    no.type = "button";
    no.dataset.act = "speed-answer";
    no.dataset.choice = "x";
    no.dataset.qid = qid;
    no.setAttribute("aria-label", "誤り");
    row.append(yes, no);
    pad.append(row);
  }
  if (plan) appendStop(pad);
  parent.append(pad);
}

function renderSpeed() {
  const root = $("speed-root");
  if (!root) return;
  if (speedUi.level === "topics") renderTopicList(root);
  else if (speedUi.level === "points") renderSpeedPoints(root, Pcs.speedTopicById(speedUi.topicId), { eyebrow: "スピードチェック", guide: false });
  else if (speedUi.level === "quiz") renderQuiz(root, currentBrowseQuestionId(), false);
  else renderChapters(root);
}

function renderAllDone(parent) {
  const plan = Pcs.ensurePlan(stateBox.data, tokyoToday());
  const model = Pcs.progress(plan, todayRecord(stateBox.data).questions);
  parent.replaceChildren();
  const pad = el("div", "study-pad center-pad");
  pad.append(el("p", "eyebrow", "今日の課題"));
  pad.append(el("h2", "study-title", "今日の分は終わりました"));
  pad.append(el("p", "today-pct gold-text", model.overall + "%"));
  const btn = el("button", "btn-gold", "終了してホームへ");
  btn.type = "button";
  btn.dataset.act = "finish-done";
  pad.append(btn);
  parent.append(pad);
}

function renderGuide() {
  const root = $("guide-root");
  if (!root) return;
  if (guideHold) {
    renderQuiz(root, guideHold.questionId, true);
    return;
  }
  const step = currentStep();
  if (!step) {
    renderAllDone(root);
    return;
  }
  if (step.kind === "ox") return;
  if ((step.kind === "text" || step.kind === "workbook") && !step.placeholder) {
    renderRangeInto(root, step.kind);
    return;
  }
  textPanel = "read";
  aiDraft = null;
  aiDirty = false;
  if (step.placeholder) {
    renderPlaceholder(root, step);
    return;
  }
  if (step.kind === "notes") {
    const plan = Pcs.ensurePlan(stateBox.data, tokyoToday());
    renderNoteCard(root, Pcs.noteById(step.id), {
      eyebrow: Pcs.stepLabel(step),
      role: step.role,
      countLabel: (plan.notes.done.length + 1) + "/" + plan.notes.ids.length
    });
    return;
  }
  if (step.kind === "speed" && step.type === "topic") {
    renderSpeedPoints(root, Pcs.speedTopicById(step.id), { eyebrow: Pcs.stepLabel(step), guide: true });
    return;
  }
  if (step.kind === "speed" && step.type === "question") renderQuiz(root, step.id, true);
}

function renderOxDock() {
  const dock = $("ox-dock");
  if (!dock) return;
  const step = currentStep();
  const on = !!(session && session.mode === "guide" && step && step.kind === "ox" && !guideHold);
  dock.hidden = !on;
  document.body.classList.toggle("is-guide-ox", on);
  if (!on) return;
  $("ox-dock-label").textContent = "択一対策　今日 " + step.done + "問 / 目標 " + step.target + "問。1問終えたら押します。";
}

function beginToday() {
  if (session) return;
  const data = stateBox.data;
  const today = tokyoToday();
  const plan = Pcs.ensurePlan(data, today);
  save(data);
  if (!Pcs.nextStep(plan, todayRecord(data).questions)) {
    renderToday();
    return;
  }
  guideHold = null;
  pickedRate = "";
  textPanel = "read";
  cloze = { key: "", total: 0, open: new Set() };
  session = createSession("guide", Date.now());
  lastScreen = "";
  data.activeSession = session;
  save(data);
  enterStudy("guide");
}

function requestStop() {
  if (!session) {
    navigateTo("home");
    return;
  }
  pendingLeave = session.mode === "guide" ? "today" : "home";
  openEndConfirm();
}

function rerenderSurface() {
  const view = currentView();
  if (view === "guide") renderGuide();
  else if (view === "notes") renderNotes();
  else if (view === "speed") renderSpeed();
}

function noteOnScreen() {
  if (session && session.mode === "guide") {
    const step = currentStep();
    return step && step.kind === "notes" ? step.id : "";
  }
  const plan = Pcs.ensurePlan(stateBox.data, tokyoToday());
  return plan.notes.ids.find((id) => plan.notes.done.indexOf(id) === -1) || "";
}

function handleAct(node) {
  const act = node.dataset.act;
  if (act === "begin-today") beginToday();
  else if (act === "finish-done") {
    if (!session) navigateTo("home");
    else {
      pendingLeave = "home";
      openEndConfirm();
    }
  } else if (act === "stop-study") requestStop();
  else if (act === "blank") {
    const index = Number(node.dataset.index);
    if (cloze.open.has(index)) cloze.open.delete(index);
    else cloze.open.add(index);
    rerenderSurface();
  } else if (act === "eye") {
    if (!cloze.total) return;
    if (cloze.open.size >= cloze.total) cloze.open = new Set();
    else {
      const next = new Set();
      for (let i = 0; i < cloze.total; i += 1) next.add(i);
      cloze.open = next;
    }
    rerenderSurface();
  } else if (act === "rate-note") {
    const id = noteOnScreen();
    if (!id) return;
    Pcs.completeNote(stateBox.data, tokyoToday(), id, node.dataset.result);
    cloze = { key: "", total: 0, open: new Set() };
    afterPcsChange();
  } else if (act === "pick-rate") {
    pickedRate = node.dataset.result || "";
    rerenderSurface();
  } else if (act === "speed-go") {
    const topicId = node.dataset.topic;
    Pcs.reviewSpeedTopic(stateBox.data, tokyoToday(), topicId, pickedRate === "unknown" ? "unknown" : "known");
    pickedRate = "";
    cloze = { key: "", total: 0, open: new Set() };
    if (session && session.mode === "guide") afterPcsChange();
    else {
      speedUi.level = "quiz";
      speedUi.topicId = topicId;
      speedUi.qIndex = 0;
      speedUi.feedback = null;
      afterPcsChange();
    }
  } else if (act === "speed-answer") {
    const qid = node.dataset.qid;
    const question = Pcs.speedQuestionById(qid);
    if (!question) return;
    const pickedYes = node.dataset.choice === "o";
    Pcs.answerSpeed(stateBox.data, tokyoToday(), qid);
    const payload = {
      questionId: qid,
      correct: !!question.answer === pickedYes,
      explain: question.explain
    };
    if (session && session.mode === "guide") guideHold = payload;
    else speedUi.feedback = payload;
    afterPcsChange();
  } else if (act === "guide-next") {
    guideHold = null;
    const surface = guideSurface();
    if (currentView() !== surface) navigateTo(surface);
    else if (surface === "guide") renderGuide();
    else renderOxDock();
  } else if (act === "speed-next") {
    speedUi.feedback = null;
    const topic = Pcs.speedTopicById(speedUi.topicId);
    speedUi.qIndex += 1;
    if (!topic || speedUi.qIndex >= topic.questions.length) {
      speedUi.level = "topics";
      speedUi.qIndex = 0;
    }
    renderSpeed();
  } else if (act === "open-ai") {
    aiScope = node.dataset.scope === "workbook" ? "workbook" : "text";
    aiDraft = normalizeAiSlots(ensureAiSlots(aiScope));
    aiDirty = false;
    textPanel = "ai";
    rerenderRangeSurface();
    window.scrollTo(0, 0);
  } else if (act === "back-text") {
    requestLeaveAi(() => {
      textPanel = "read";
      aiDraft = null;
      rerenderRangeSurface();
      window.scrollTo(0, 0);
    });
  } else if (act === "clear-ai-image") {
    const index = Number(node.dataset.index);
    if (!aiDraft || !aiDraft[index]) return;
    aiDraft[index].image = "";
    syncAiDirty();
    rerenderRangeSurface();
  } else if (act === "save-ai") {
    commitAiDraft();
  } else if (act === "add-book") {
    openBookEditor(null);
  } else if (act === "open-book") {
    openRegisteredBook(node.dataset.id);
  } else if (act === "edit-book") {
    const book = ensureBooksDraft().find((item) => item.id === node.dataset.id);
    if (book) openBookEditor(book);
  } else if (act === "confirm-range") {
    const kind = node.dataset.kind === "workbook" ? "workbook" : "text";
    const spec = rangeSpec(kind);
    const view = node.closest(".view");
    const range = view ? view.querySelector("input.text-range") : null;
    const value = range ? Number(range.value) : 0;
    if (kind === "workbook") Pcs.confirmWorkbookSolved(stateBox.data, tokyoToday(), value);
    else Pcs.confirmTextPages(stateBox.data, tokyoToday(), value);
    afterPcsChange();
    toast(spec.toast);
  } else if (act === "text-home") {
    leaveTextHome();
  } else if (act === "pass-placeholder") {
    const step = currentStep();
    if (!step || !step.placeholder) return;
    Pcs.passPlaceholder(stateBox.data, tokyoToday(), step.kind);
    afterPcsChange();
  } else if (act === "ox-one") {
    if (!(session && session.mode === "guide")) return;
    const result = Pcs.completeOxOne(stateBox.data, tokyoToday());
    if (!result.changed) return;
    afterPcsChange();
  } else if (act === "speed-chapter") {
    speedUi.level = "topics";
    speedUi.chapterId = node.dataset.id;
    speedUi.feedback = null;
    renderSpeed();
  } else if (act === "speed-topic") {
    speedUi.level = "points";
    speedUi.topicId = node.dataset.id;
    speedUi.feedback = null;
    pickedRate = "";
    cloze = { key: "", total: 0, open: new Set() };
    renderSpeed();
  } else if (act === "speed-back") {
    cloze = { key: "", total: 0, open: new Set() };
    pickedRate = "";
    speedUi.feedback = null;
    if (speedUi.level === "quiz") speedUi.level = "points";
    else if (speedUi.level === "points") speedUi.level = "topics";
    else speedUi.level = "chapters";
    renderSpeed();
  }
}

function bind() {
  function onRoute(view) {
    if (session && !routeAllowed(view)) {
      promptSessionEnd();
      return;
    }
    show(view);
  }

  function leaveFor(view) {
    if (session && !routeAllowed(view)) {
      pendingLeave = document.getElementById("view-" + view) ? view : "home";
      show(studyView(session.mode));
      openEndConfirm();
      return;
    }
    navigateTo(document.getElementById("view-" + view) ? view : "home");
  }

  function afterAiLeave(view, proceed) {
    if (booksNeedConfirm() && view !== "record") requestLeaveBooks(proceed);
    else proceed();
  }

  window.addEventListener("hashchange", () => {
    if (hashGuard || discardSheetOpen()) return;
    const view = currentView();
    if (textPanel === "ai" && aiDirty && view !== aiHostView()) {
      hashGuard = true;
      history.replaceState({ view: aiHostView() }, "", location.pathname + location.search + "#" + aiHostView());
      hashGuard = false;
      requestLeaveAi(() => afterAiLeave(view, () => onRoute(view)));
      return;
    }
    if (bookRunId && view !== "record") {
      hashGuard = true;
      history.replaceState({ view: "record" }, "", location.pathname + location.search + "#record");
      hashGuard = false;
      requestCloseBookRun(() => navigateTo(view));
      return;
    }
    if (booksNeedConfirm() && view !== "record") {
      hashGuard = true;
      history.replaceState({ view: "record" }, "", location.pathname + location.search + "#record");
      hashGuard = false;
      requestLeaveBooks(() => navigateTo(view));
      return;
    }
    onRoute(view);
  });
  window.addEventListener("popstate", () => {
    if (hashGuard || discardSheetOpen()) return;
    const view = currentView();
    if (textPanel === "ai" && aiDirty && view !== aiHostView()) {
      hashGuard = true;
      history.pushState({ view: aiHostView() }, "", location.pathname + location.search + "#" + aiHostView());
      hashGuard = false;
      requestLeaveAi(() => afterAiLeave(view, () => {
        if (session) {
          promptSessionEnd();
          return;
        }
        if (view === "notes" || view === "speed" || view === "ox" || view === "text" || view === "workbook" || view === "guide") {
          navigateTo("home", true);
          return;
        }
        show(view);
      }));
      return;
    }
    if (bookRunId && view !== "record") {
      hashGuard = true;
      history.pushState({ view: "record" }, "", location.pathname + location.search + "#record");
      hashGuard = false;
      requestCloseBookRun(() => {
        if (session) {
          promptSessionEnd();
          return;
        }
        if (view === "notes" || view === "speed" || view === "ox" || view === "text" || view === "workbook" || view === "guide") {
          navigateTo("home", true);
          return;
        }
        navigateTo(view);
      });
      return;
    }
    if (booksNeedConfirm() && view !== "record") {
      hashGuard = true;
      history.pushState({ view: "record" }, "", location.pathname + location.search + "#record");
      hashGuard = false;
      requestLeaveBooks(() => {
        if (session) {
          promptSessionEnd();
          return;
        }
        if (view === "notes" || view === "speed" || view === "ox" || view === "text" || view === "workbook" || view === "guide") {
          navigateTo("home", true);
          return;
        }
        navigateTo(view);
      });
      return;
    }
    if (session) {
      promptSessionEnd();
      return;
    }
    if (view === "notes" || view === "speed" || view === "ox" || view === "text" || view === "workbook" || view === "guide") {
      navigateTo("home", true);
      return;
    }
    show(view);
  });

  document.querySelectorAll("a[href^='#']").forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href") || "";
      if (!href.startsWith("#") || href.length < 2) return;
      event.preventDefault();
      const view = href.slice(1);
      if (textPanel === "ai" && aiDirty) {
        requestLeaveAi(() => afterAiLeave(view, () => leaveFor(view)));
        return;
      }
      if (bookRunId) {
        requestCloseBookRun(() => leaveFor(view));
        return;
      }
      if (booksNeedConfirm() && view !== "record") {
        requestLeaveBooks(() => leaveFor(view));
        return;
      }
      leaveFor(view);
    });
  });

  document.addEventListener("click", (event) => {
    const act = event.target.closest("[data-act]");
    if (act) {
      handleAct(act);
      return;
    }
    const entrance = event.target.closest("[data-entrance]");
    if (entrance && entrance.dataset.entrance) openStart(entrance.dataset.entrance);
  });

  $("start-today").addEventListener("click", () => {
    if (session) return;
    navigateTo("today");
  });

  $("subject-toggle").addEventListener("click", () => {
    const panel = $("subject-panel");
    const open = panel.hidden;
    panel.hidden = !open;
    $("subject-toggle").setAttribute("aria-expanded", open ? "true" : "false");
  });

  $("start-yes").addEventListener("click", beginFromConfirm);
  $("start-no").addEventListener("click", closeStart);
  $("start-sheet").addEventListener("click", (event) => {
    if (event.target === $("start-sheet")) closeStart();
  });

  $("btn-end-over").addEventListener("click", () => {
    pendingLeave = null;
    openEndConfirm();
  });
  $("btn-break").addEventListener("click", () => {
    if (!session) return;
    const now = Date.now();
    session = tickSession(session, now);
    session = startBreak(session, now);
    flushSession(now, false);
    renderStudyChrome(presentSession(session, now));
  });
  $("btn-end-break").addEventListener("click", finishSession);
  $("btn-next-yes").addEventListener("click", () => {
    if (!session || session.phase !== "breakDone") return;
    const now = Date.now();
    session = confirmNextSet(session, now);
    flushSession(now, false);
    renderStudyChrome(presentSession(session, now));
  });
  $("btn-next-no").addEventListener("click", finishSession);

  $("ai-discard-yes").addEventListener("click", confirmDiscardAi);
  $("ai-discard-no").addEventListener("click", cancelDiscardAi);
  $("ai-discard-sheet").addEventListener("click", (event) => {
    if (event.target === $("ai-discard-sheet")) cancelDiscardAi();
  });

  $("end-yes").addEventListener("click", finishSession);
  $("end-no").addEventListener("click", closeEndConfirm);
  $("end-sheet").addEventListener("click", (event) => {
    if (event.target === $("end-sheet")) closeEndConfirm();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const remove = $("book-delete-sheet");
    const editor = $("book-sheet");
    const stop = $("book-stop-sheet");
    const unit = $("book-unit-sheet");
    if (stop && !stop.hidden) cancelDiscardBookRun();
    else if (unit && !unit.hidden) closeUnitSheet();
    else if (remove && !remove.hidden) closeBookDelete();
    else if (discardSheetOpen()) cancelDiscardAi();
    else if (editor && !editor.hidden) closeBookEditor();
    else if (bookRunId) requestCloseBookRun();
    else if (!$("start-sheet").hidden) closeStart();
    else if (!$("end-sheet").hidden) closeEndConfirm();
  });

  $("save-books").addEventListener("click", commitBooks);
  $("book-apply").addEventListener("click", applyBookForm);
  $("book-close").addEventListener("click", closeBookEditor);
  $("book-delete").addEventListener("click", openBookDelete);
  $("book-delete-yes").addEventListener("click", confirmBookDelete);
  $("book-delete-no").addEventListener("click", closeBookDelete);
  $("book-delete-sheet").addEventListener("click", (event) => {
    if (event.target === $("book-delete-sheet")) closeBookDelete();
  });
  $("book-sheet").addEventListener("click", (event) => {
    if (event.target === $("book-sheet")) closeBookEditor();
  });
  $("book-clear-image").addEventListener("click", () => {
    if (!bookEditing) return;
    bookEditing.image = "";
    bookFormDirty = true;
    const file = $("book-file");
    if (file) file.value = "";
    paintBookImage();
  });
  $("book-file").addEventListener("change", () => {
    const file = $("book-file").files && $("book-file").files[0];
    if (file) storeBookImage(file);
  });
  $("book-pick").addEventListener("paste", (event) => {
    const items = event.clipboardData && event.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].type && items[i].type.indexOf("image/") === 0) {
        event.preventDefault();
        storeBookImage(items[i].getAsFile());
        break;
      }
    }
  });
  ["book-title", "book-note"].forEach((id) => {
    $(id).addEventListener("input", () => {
      if (bookEditing) bookFormDirty = true;
    });
  });

  $("book-run-close").addEventListener("click", () => requestCloseBookRun());
  $("book-run-save").addEventListener("click", saveBookRun);
  $("book-run-toggle").addEventListener("click", toggleBookRun);
  $("book-stop-yes").addEventListener("click", confirmDiscardBookRun);
  $("book-stop-no").addEventListener("click", cancelDiscardBookRun);
  $("book-stop-sheet").addEventListener("click", (event) => {
    if (event.target === $("book-stop-sheet")) cancelDiscardBookRun();
  });
  $("book-unit-lock").addEventListener("click", lockBookUnit);
  $("book-unit-cancel").addEventListener("click", closeUnitSheet);
  $("book-unit-sheet").addEventListener("click", (event) => {
    if (event.target === $("book-unit-sheet")) closeUnitSheet();
  });
  document.querySelectorAll("[data-unit-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      unitChoice = button.dataset.unitChoice === "question" ? "question" : "page";
      paintUnitChoice();
    });
  });

  $("save-settings").addEventListener("click", saveSettings);
  $("reset-demo").addEventListener("click", () => {
    if (!confirm("表示を初期のデモデータに戻しますか？")) return;
    stopTicker();
    session = null;
    guideHold = null;
    pickedRate = "";
    pendingLeave = null;
    closeEndConfirm();
    const dock = $("ox-dock");
    if (dock) dock.hidden = true;
    document.body.classList.remove("is-guide-ox");
    hideStudyChrome();
    textPanel = "read";
    aiScope = "text";
    aiSaved = { text: null, workbook: null };
    aiDraft = null;
    aiDirty = false;
    booksDraft = null;
    bookEditing = null;
    bookFormDirty = false;
    bookRun = null;
    bookRunId = "";
    bookLeaveAction = null;
    stopBookTicker();
    closeBookRun();
    closeUnitSheet();
    closeBookSheets();
    stateBox.data = seed();
    save(stateBox.data);
    fillSettings();
    renderHome();
    toast("初期表示に戻しました");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (bookRun) checkpointBookRun(Date.now());
      if (session) flushSession(Date.now(), false);
      return;
    }
    if (bookRunId) paintBookRun();
    if (!session) renderHome();
  });
  window.addEventListener("pagehide", () => {
    if (bookRun) checkpointBookRun(Date.now());
    if (session) flushSession(Date.now(), false);
  });
}

function refreshAfterCloud() {
  const view = currentView();
  renderHome();
  if (view === "record") fillRecord();
  if (view === "settings") fillSettings();
  const editingAi = textPanel === "ai" && aiDirty;
  if (view === "today") renderToday();
  if (view === "guide" && !editingAi) renderGuide();
  if (view === "notes") renderNotes();
  if (view === "speed") renderSpeed();
  if (view === "text" && !editingAi) renderRangeInto($("text-root"), "text");
  if (view === "workbook" && !editingAi) renderRangeInto($("workbook-root"), "workbook");
  if (view === "ox") renderOxDock();
  if (sessionShowsTimer(view)) renderStudyChrome(presentSession(session, Date.now()));
  else if (!session) hideStudyChrome();
  if (bookRunId) paintBookRun();
  else if (bookRun) renderBookBadge(Date.now());
}

function adoptCloudSession(data) {
  const next = data.activeSession;
  if (next) {
    session = next;
    const now = Date.now();
    if (session.phase === "paused") session = resumeSession(session, now);
    session = tickSession(session, now);
    data.activeSession = session;
    if (!ticker) startTicker();
  } else if (session) {
    session = null;
    stopTicker();
    guideHold = null;
    hideStudyChrome();
    const dock = $("ox-dock");
    if (dock) dock.hidden = true;
    document.body.classList.remove("is-guide-ox");
    data.activeSession = null;
  }
}

function applyCloudState(raw) {
  const dirtyBooks = bookFormDirty || (booksDraft != null && !booksEqual(savedBooks(), booksDraft));
  const data = normalize(raw);
  settle(data);
  cloudQuiet = true;
  try {
    save(data);
    adoptCloudSession(data);
    save(data);
  } finally {
    cloudQuiet = false;
  }
  if (!dirtyBooks) booksDraft = null;
  if (bookRun && session) {
    bookRun = null;
    stopBookTicker();
    bookLeaveAction = null;
    const stop = $("book-stop-sheet");
    if (stop) stop.hidden = true;
    closeBookRun();
    toast("別の計測が続いているため、教材の計測を止めました");
  }
  const view = currentView();
  if (session && !routeAllowed(view)) {
    const target = session.mode === "guide" ? guideSurface() : studyView(session.mode);
    navigateTo(target, true);
  } else {
    refreshAfterCloud();
  }
  return true;
}

function applyCloudAi(scope, slots) {
  const which = scope === "workbook" ? "workbook" : "text";
  if (textPanel === "ai" && aiScope === which && aiDirty) return false;
  aiSaved[which] = normalizeAiSlots(slots);
  try {
    localStorage.setItem(aiStorageKey(which), JSON.stringify(aiSaved[which]));
  } catch (err) {
    /* private mode */
  }
  if (textPanel === "ai" && aiScope === which) {
    aiDraft = normalizeAiSlots(aiSaved[which]);
    aiDirty = false;
    rerenderRangeSurface();
  }
  return true;
}

function startCloud() {
  if (typeof window === "undefined" || !window.ShoshiSync || !window.ShoshiSync.start) return;
  window.ShoshiSync.start({
    getState: () => stateBox.data,
    getAi: (scope) => ensureAiSlots(scope),
    aiDirty: (scope) => {
      const which = scope === "workbook" ? "workbook" : "text";
      return textPanel === "ai" && aiScope === which && aiDirty;
    },
    aiDirtyAny: () => textPanel === "ai" && aiDirty,
    applyState: applyCloudState,
    applyAi: applyCloudAi,
    toast: toast,
    openSettings: () => {
      if ((location.hash || "") !== "#settings") location.hash = "#settings";
      else show("settings");
    }
  });
}

function boot() {
  stateBox.data = load();
  document.querySelectorAll('a[data-external="ox"]').forEach((node) => {
    node.href = OX_URL;
  });
  bind();
  session = stateBox.data.activeSession;
  if (session) {
    const now = Date.now();
    if (session.phase === "paused") session = resumeSession(session, now);
    session = tickSession(session, now);
    flushSession(now, false);
    navigateTo(session.mode === "guide" ? guideSurface() : studyView(session.mode), true);
    armStudyGuard();
    startTicker();
  } else if (location.hash && location.hash !== "#home") {
    show(currentView());
  } else {
    navigateTo("home", true);
  }
  if ("serviceWorker" in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  setInterval(() => {
    if (!session) renderHome();
  }, 30000);
  startCloud();
}

if (typeof document !== "undefined") boot();

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    oxFrameUrl,
    queueOpensOx,
    OX_URL,
    OX_QUEUE_URL,
    normalizeAiSlots,
    aiSlotsDirty,
    AI_KEYS,
    aiStorageKey,
    BOOK_LIMIT,
    normalizeBooks,
    booksEqual,
    emptyBookSlots,
    normalize,
    bookGauge,
    bookGaugeLabel
  };
}
