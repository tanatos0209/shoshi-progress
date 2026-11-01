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

function studyView(mode) {
  if (mode === "notes" || mode === "speed" || mode === "ox") return mode;
  return "home";
}

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
  const known = ["home", "notes", "ox", "speed", "record", "perfect", "calendar", "settings"];
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
        if (!href || href === "about:blank") win.location.replace(OX_URL);
        else win.history.pushState({ shoshiGuard: 1 }, "", href);
      } catch (err) { /* parent session still owns the back gesture */ }
      promptSessionEnd();
    });
  } catch (err) {
    /* cross-origin frame: the parent history guard handles swipe-back */
  }
}

function ensureOxFrame() {
  const frame = $("ox-frame");
  if (!frame || oxRelease) return;
  const href = oxFrameHref(frame);
  if (frame.dataset.loaded === "1" && href.includes("shoshi-ox")) {
    frame.hidden = false;
    return;
  }
  frame.dataset.loaded = "1";
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
  frame.src = OX_URL;
}

function releaseOxFrame() {
  const frame = $("ox-frame");
  if (!frame) return;
  oxRelease = true;
  frame.hidden = true;
  frame.dataset.loaded = "";
  frame.onload = null;
  if (frame.getAttribute("src")) frame.src = "about:blank";
}

function show(view) {
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

  const tab = view === "notes" || view === "speed" || view === "ox" ? "home" : view;
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
    ox: "択一対策"
  };
  document.title = view === "home" ? "進捗管理" : titles[view] + " | 進捗管理";
  if (view === "record") fillRecord();
  if (view === "settings") fillSettings();
  renderHome();
  if (session && view === studyView(session.mode)) renderStudyChrome(presentSession(session, Date.now()));
  else hideStudyChrome();
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
    if (currentView() === studyView(session.mode)) renderStudyChrome(view);
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
  navigateTo(studyView(mode));
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
  session = createSession(mode, Date.now());
  lastScreen = "";
  stateBox.data.activeSession = session;
  save(stateBox.data);
  enterStudy(mode);
}

function openEndConfirm() {
  if (!session || endConfirmOpen) return;
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
  const dest = pendingLeave || "home";
  pendingLeave = null;
  stopTicker();
  flushSession(Date.now(), true);
  session = null;
  lastScreen = "";
  closeEndConfirm();
  hideStudyChrome();
  navigateTo(dest, true);
  toast("学習時間を記録しました");
}

function bind() {
  function onRoute(view) {
    if (!session) {
      show(view);
      return;
    }
    if (view === studyView(session.mode)) {
      show(view);
      return;
    }
    promptSessionEnd();
  }

  window.addEventListener("hashchange", () => {
    if (hashGuard) return;
    onRoute(currentView());
  });
  window.addEventListener("popstate", () => {
    if (hashGuard) return;
    if (session) {
      promptSessionEnd();
      return;
    }
    const view = currentView();
    if (view === "notes" || view === "speed" || view === "ox") {
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
      if (session && view !== studyView(session.mode)) {
        pendingLeave = document.getElementById("view-" + view) ? view : "home";
        show(studyView(session.mode));
        openEndConfirm();
        return;
      }
      navigateTo(document.getElementById("view-" + view) ? view : "home");
    });
  });

  document.querySelectorAll("[data-entrance]").forEach((button) => {
    button.addEventListener("click", () => openStart(button.dataset.entrance));
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
    pendingLeave = null;
    closeEndConfirm();
    hideStudyChrome();
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
    if (session.phase === "paused") session = resumeSession(session, now);
    session = tickSession(session, now);
    flushSession(now, false);
    navigateTo(studyView(session.mode), true);
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
}

boot();
