"use strict";

const {
  ENTRANCES,
  tokyoToday,
  addDays,
  weekdayMon0,
  mondayOf,
  formatJPDate,
  formatExamDate,
  computeExamDate,
  examSummary,
  syncStreak,
  addStudySpan,
  createSession,
  tickSession,
  pauseSession,
  resumeSession,
  startBreak,
  confirmNextSet,
  detachSpans,
  presentSession,
  sanitizeSession
} = ProgressRules;

const OX_URL = "https://tanatos0209.github.io/shoshi-ox/";
const STORAGE_KEY = "shoshi-progress-v1";
const DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];
const DEMO_HOURS = [1.5, 2.0, 1.0, 2.5, 1.5, 3.0, 2.8];
const DEMO_GOLD = [false, false, false, true, false, true, false];

const MODE_ICONS = {
  notes: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 3.5h8.2L19 8.2V20.5H6V3.5zm7.2 1.5V9H18"/></svg>',
  ox: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M5 12.2 9.2 16.5 19 7"/></svg>',
  speed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.2 2.5 6 13.2h4.2L9.4 21.5 18 10.2h-4.4z"/></svg>'
};

const stateBox = { data: null };
let session = null;
let ticker = 0;
let lastFlush = 0;
let pendingEntrance = null;
let endConfirmOpen = false;
let hashGuard = false;
let lastScreen = "";

function formatDuration(min) {
  const value = Math.max(0, Math.round(Number(min) || 0));
  return `${Math.floor(value / 60)}時間${value % 60}分`;
}

function formatGoalHours(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value % 60 === 0) return `${value / 60}時間`;
  return formatDuration(value);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function seed() {
  const today = tokyoToday();
  return {
    v: 1,
    examDate: computeExamDate(today),
    dailyGoalMinutes: 180,
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
    activeSession: null
  };
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
    demo: typeof data.demo === "boolean" ? data.demo : true,
    studied: data.studied === true,
    streak: Math.max(0, Math.round(Number(data.streak) || 0)),
    lastStudyDate: typeof data.lastStudyDate === "string" ? data.lastStudyDate : "",
    activeSession: sanitizeSession(data.activeSession)
  };
}

/* Untouched demo seeds are not real study. A saved session or real minutes stay. */
function settle(data) {
  const today = tokyoToday();
  data.examDate = computeExamDate(today);
  if (data.demo && !data.studied && !data.activeSession) {
    data.log = {
      [today]: { minutes: 0, questions: 0, carryMs: 0 }
    };
    data.streak = 0;
    data.lastStudyDate = "";
    return;
  }
  syncStreak(data, today);
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
        carryMs: Math.max(0, Number(current.carryMs) || 0)
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
  const today = tokyoToday();
  const mon = mondayOf(today);
  const minutes = DAY_LABELS.map((_, index) => {
    const rec = data.log[addDays(mon, index)];
    return rec ? Math.max(0, Math.round(Number(rec.minutes) || 0)) : 0;
  });
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
  $("today-time").textContent = formatDuration(rec.minutes);
  $("daily-goal").textContent = formatGoalHours(data.dailyGoalMinutes);
  $("streak-n").textContent = String(Math.max(0, data.streak));
  $("week-goal").textContent = String(data.weeklyGoalHours);

  if (data.demo) {
    $("sum-h").textContent = "12";
    $("sum-m").textContent = "30";
  } else {
    const mon = mondayOf(today);
    let total = 0;
    for (let i = 0; i < 7; i += 1) {
      const row = data.log[addDays(mon, i)];
      total += row ? Math.max(0, Math.round(Number(row.minutes) || 0)) : 0;
    }
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

  const goalQ = Math.max(1, Math.round(Number(data.dailyQuestionGoal) || 1));
  const percent = clamp(Math.round((rec.questions / goalQ) * 100), 0, 999);
  const shown = Math.min(100, percent);
  $("q-done").textContent = String(rec.questions);
  $("q-goal").textContent = String(goalQ);
  $("q-fill").style.width = shown + "%";
  $("q-pct").textContent = percent + "%";
  $("meter").classList.toggle("low", shown < 16);
  $("meter-out").textContent = percent + "%";

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
  const known = ["home", "notes", "speed", "record", "perfect", "calendar", "settings", "timer"];
  return known.includes(hash) ? hash : "home";
}

function show(view) {
  if (session) view = "timer";
  else if (view === "timer") view = "home";

  document.querySelectorAll(".view").forEach((node) => {
    node.hidden = node.id !== "view-" + view;
  });
  const timing = view === "timer";
  document.body.classList.toggle("is-timing", timing);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", timing ? "#050814" : "#03150f");

  const tab = view === "notes" || view === "speed" || view === "timer" ? "home" : view;
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
    record: "記録する",
    perfect: "パーフェクトコントロール",
    calendar: "カレンダー",
    settings: "設定",
    timer: "勉強時間計測"
  };
  document.title = view === "home" ? "進捗管理" : titles[view] + " | 進捗管理";
  if (view === "record") fillRecord();
  if (view === "settings") fillSettings();
  if (view === "timer" && session) renderTimer(presentSession(session, Date.now()));
  else renderHome();
  window.scrollTo(0, 0);
}

function fillRecord() {
  const data = stateBox.data;
  const rec = todayRecord(data);
  $("record-date").textContent = formatJPDate(tokyoToday());
  $("record-now").textContent = formatDuration(rec.minutes);
  $("record-questions").textContent = String(rec.questions);
  $("q-input").value = String(rec.questions);
  $("add-minutes").value = "";
  $("main-choice-input").value = String(data.subjects.main.choice);
  $("main-written-input").value = String(data.subjects.main.written);
  $("minor-choice-input").value = String(data.subjects.minor.choice);
  $("minor-written-input").value = String(data.subjects.minor.written);
  $("main-choice-val").textContent = data.subjects.main.choice + "%";
  $("main-written-val").textContent = data.subjects.main.written + "%";
  $("minor-choice-val").textContent = data.subjects.minor.choice + "%";
  $("minor-written-val").textContent = data.subjects.minor.written + "%";
}

function fillSettings() {
  const data = stateBox.data;
  $("exam-fixed").textContent = formatJPDate(computeExamDate(tokyoToday()));
  $("daily-hours").value = String(Math.round((data.dailyGoalMinutes / 60) * 10) / 10);
  $("weekly-hours").value = String(data.weeklyGoalHours);
  $("daily-questions").value = String(data.dailyQuestionGoal);
}

function readSubjectsFromForm() {
  return {
    main: {
      choice: clamp(Math.round(Number($("main-choice-input").value) || 0), 0, 100),
      written: clamp(Math.round(Number($("main-written-input").value) || 0), 0, 100)
    },
    minor: {
      choice: clamp(Math.round(Number($("minor-choice-input").value) || 0), 0, 100),
      written: clamp(Math.round(Number($("minor-written-input").value) || 0), 0, 100)
    }
  };
}

function commitRecord(extraMinutes) {
  const data = stateBox.data;
  materializeDemo(data);
  const today = tokyoToday();
  const rec = data.log[today] || { minutes: 0, questions: 0, carryMs: 0 };
  const add = Math.max(0, Math.round(Number(extraMinutes) || 0));
  const questions = clamp(Math.round(Number($("q-input").value) || 0), 0, 9999);
  rec.minutes = Math.max(0, Math.round(Number(rec.minutes) || 0)) + add;
  rec.questions = questions;
  rec.carryMs = Math.max(0, Number(rec.carryMs) || 0);
  delete rec.sample;
  data.log[today] = rec;
  data.subjects = readSubjectsFromForm();
  if (add > 0) data.studied = true;
  syncStreak(data, today);
  save(data);
  fillRecord();
  renderHome();
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
  const hours = clamp(Number($("daily-hours").value) || 0, 0.5, 24);
  const week = clamp(Math.round(Number($("weekly-hours").value) || 0), 1, 168);
  const questions = clamp(Math.round(Number($("daily-questions").value) || 0), 1, 500);
  data.examDate = computeExamDate(tokyoToday());
  data.dailyGoalMinutes = Math.round(hours * 60);
  data.weeklyGoalHours = week;
  data.dailyQuestionGoal = questions;
  save(data);
  fillSettings();
  renderHome();
  toast("設定を保存しました");
}

function renderTimer(view) {
  const work = view.screen === "work" || view.screen === "workDone";
  $("timer-title").hidden = !work;
  $("timer-pill").hidden = !work;
  $("stage-work").hidden = !work;
  $("stage-break").hidden = view.screen !== "break";
  $("stage-ask").hidden = view.screen !== "breakDone";
  $("timer-mode-label").textContent = view.modeLabel;
  if (session) $("timer-ico").innerHTML = MODE_ICONS[session.mode] || "";

  if (work) {
    $("time-main").textContent = view.clock;
    $("time-over").hidden = !view.overtime;
    if (view.overtime) $("time-over").textContent = view.overtime;
    $("set-label").hidden = !view.setLabel;
    if (view.setLabel) $("set-label").textContent = view.setLabel;
    $("work-prompt").hidden = !view.prompt;
    $("work-actions").hidden = view.screen !== "work";
    $("overtime-actions").hidden = view.screen !== "workDone";
    $("ring-wrap").classList.toggle("is-over", !!view.overtimeMode);
    $("pause-label").textContent = view.paused ? "再開" : "一時停止";
    $("btn-pause").setAttribute("aria-pressed", view.paused ? "true" : "false");
    $("btn-pause").querySelector(".ico-pause").hidden = view.paused;
    $("btn-pause").querySelector(".ico-play").hidden = !view.paused;
    const ring = $("ring-value");
    const length = 2 * Math.PI * 86;
    ring.style.strokeDasharray = String(length);
    ring.style.strokeDashoffset = String(length * (1 - view.ring));
  } else if (view.screen === "break") {
    $("break-time").textContent = view.clock;
  } else {
    $("ask-time").textContent = view.clock;
    $("break-over").hidden = !view.breakOver;
    if (view.breakOver) $("break-over").textContent = view.breakOver;
    $("ask-foot-label").textContent = view.footer;
  }

  if (view.screen !== lastScreen) {
    const messages = {
      work: view.paused ? "一時停止中" : view.setLabel,
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
      pulse(view.screen === "workDone" ? $("work-prompt") : $("ask-prompt"));
    }
    renderTimer(view);
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

function enterTimer() {
  if (location.hash !== "#timer") {
    hashGuard = true;
    location.hash = "#timer";
    hashGuard = false;
  }
  show("timer");
  startTicker();
}

function openStart(mode) {
  if (session || !ENTRANCES[mode]) return;
  pendingEntrance = mode;
  $("start-mode").textContent = ENTRANCES[mode];
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
  session = createSession(mode, Date.now());
  lastScreen = "";
  stateBox.data.activeSession = session;
  save(stateBox.data);
  enterTimer();
}

function openEndConfirm() {
  if (!session || endConfirmOpen) return;
  if (session.phase !== "work" && session.phase !== "paused" && session.phase !== "workDone") return;
  endConfirmOpen = true;
  $("end-sheet").hidden = false;
  $("end-no").focus();
}

function closeEndConfirm() {
  endConfirmOpen = false;
  $("end-sheet").hidden = true;
}

function finishSession() {
  if (!session) return;
  const mode = session.mode;
  stopTicker();
  flushSession(Date.now(), true);
  session = null;
  lastScreen = "";
  closeEndConfirm();
  document.body.classList.remove("is-timing");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", "#03150f");
  if (mode === "ox") {
    location.assign(OX_URL);
    return;
  }
  hashGuard = true;
  location.hash = "#home";
  hashGuard = false;
  show("home");
  toast("学習時間を記録しました");
}

function bind() {
  window.addEventListener("hashchange", () => {
    if (hashGuard) return;
    if (session && currentView() !== "timer") {
      openEndConfirm();
      hashGuard = true;
      location.hash = "#timer";
      hashGuard = false;
      return;
    }
    show(currentView());
  });

  document.querySelectorAll("[data-entrance]").forEach((button) => {
    button.addEventListener("click", () => openStart(button.dataset.entrance));
  });

  $("start-yes").addEventListener("click", beginFromConfirm);
  $("start-no").addEventListener("click", closeStart);
  $("start-sheet").addEventListener("click", (event) => {
    if (event.target === $("start-sheet")) closeStart();
  });

  $("btn-pause").addEventListener("click", () => {
    if (!session) return;
    const now = Date.now();
    if (session.phase === "paused") session = resumeSession(session, now);
    else session = pauseSession(session, now);
    flushSession(now, false);
    renderTimer(presentSession(session, now));
  });
  $("btn-end-study").addEventListener("click", openEndConfirm);
  $("btn-end-over").addEventListener("click", openEndConfirm);
  $("btn-break").addEventListener("click", () => {
    if (!session) return;
    const now = Date.now();
    session = tickSession(session, now);
    session = startBreak(session, now);
    flushSession(now, false);
    renderTimer(presentSession(session, now));
  });
  $("btn-end-break").addEventListener("click", finishSession);
  $("btn-next-yes").addEventListener("click", () => {
    if (!session || session.phase !== "breakDone") return;
    const now = Date.now();
    session = confirmNextSet(session, now);
    flushSession(now, false);
    renderTimer(presentSession(session, now));
  });
  $("btn-next-no").addEventListener("click", finishSession);

  $("end-yes").addEventListener("click", finishSession);
  $("end-no").addEventListener("click", closeEndConfirm);
  $("end-sheet").addEventListener("click", (event) => {
    if (event.target === $("end-sheet")) closeEndConfirm();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("start-sheet").hidden) closeStart();
    else if (!$("end-sheet").hidden) closeEndConfirm();
  });

  document.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const amount = Number(button.dataset.add);
      commitRecord(amount);
      toast(amount + "分を記録しました");
    });
  });

  $("add-custom").addEventListener("click", () => {
    const amount = Math.round(Number($("add-minutes").value) || 0);
    if (amount <= 0) {
      toast("追加する分数を入力してください");
      return;
    }
    commitRecord(clamp(amount, 1, 24 * 60));
    toast(amount + "分を記録しました");
  });

  $("save-record").addEventListener("click", () => {
    const typed = Math.round(Number($("add-minutes").value) || 0);
    commitRecord(typed > 0 ? clamp(typed, 1, 24 * 60) : 0);
    toast("記録しました");
  });

  $("q-dec").addEventListener("click", () => {
    $("q-input").value = String(Math.max(0, Number($("q-input").value) - 1));
  });
  $("q-inc").addEventListener("click", () => {
    $("q-input").value = String(Math.min(9999, Number($("q-input").value) + 1));
  });

  ["main-choice", "main-written", "minor-choice", "minor-written"].forEach((key) => {
    $(key + "-input").addEventListener("input", () => {
      $(key + "-val").textContent = $(key + "-input").value + "%";
    });
  });

  $("save-settings").addEventListener("click", saveSettings);
  $("reset-demo").addEventListener("click", () => {
    if (!confirm("表示を初期のデモデータに戻しますか？")) return;
    stopTicker();
    session = null;
    closeEndConfirm();
    stateBox.data = seed();
    save(stateBox.data);
    fillSettings();
    renderHome();
    toast("初期表示に戻しました");
  });

  document.addEventListener("visibilitychange", () => {
    if (!session) {
      if (document.visibilityState === "visible") renderHome();
      return;
    }
    if (document.visibilityState === "hidden") flushSession(Date.now(), false);
  });
  window.addEventListener("pagehide", () => {
    if (session) flushSession(Date.now(), false);
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
    session = tickSession(session, now);
    flushSession(now, false);
    enterTimer();
  } else {
    if (!location.hash) location.hash = "#home";
    show(currentView());
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  setInterval(() => {
    if (!session) renderHome();
  }, 30000);
}

boot();
