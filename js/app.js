"use strict";

const OX_URL = "https://tanatos0209.github.io/shoshi-ox/";
const STORAGE_KEY = "shoshi-progress-v1";
const DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];
const DEMO_HOURS = [1.5, 2.0, 1.0, 2.5, 1.5, 3.0, 2.8];
const DEMO_GOLD = [false, false, false, true, false, true, false];

const stateBox = { data: null };

function tokyoToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function weekdayMon0(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function mondayOf(iso) {
  return addDays(iso, -weekdayMon0(iso));
}

function daysUntil(examIso, todayIso) {
  const a = Date.parse(todayIso + "T00:00:00Z");
  const b = Date.parse(examIso + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

function formatJPDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = "日月火水木金土"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}年${m}月${d}日（${wd}）`;
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
    examDate: addDays(today, 150),
    dailyGoalMinutes: 180,
    weeklyGoalHours: 30,
    dailyQuestionGoal: 20,
    streak: 1,
    lastStudyDate: today,
    demo: true,
    subjects: {
      main: { choice: 18, written: 0 },
      minor: { choice: 5, written: 0 }
    },
    log: {
      [today]: { minutes: 165, questions: 6 }
    }
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
    demo: typeof data.demo === "boolean" ? data.demo : true
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (err) {
    /* keep the in-memory seed when storage is blocked */
  }
  const fresh = seed();
  save(fresh);
  return fresh;
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

function displayStreak(data) {
  const today = tokyoToday();
  const yesterday = addDays(today, -1);
  if (data.lastStudyDate === today || data.lastStudyDate === yesterday) {
    return Math.max(0, Math.round(Number(data.streak) || 0));
  }
  return 0;
}

function touchStreak(data) {
  const today = tokyoToday();
  const yesterday = addDays(today, -1);
  if (data.lastStudyDate === yesterday) data.streak = (Number(data.streak) || 0) + 1;
  else if (data.lastStudyDate !== today) data.streak = 1;
  data.lastStudyDate = today;
}

function materializeDemo(data) {
  if (!data.demo) return;
  const today = tokyoToday();
  const mon = mondayOf(today);
  const current = data.log[today] || { minutes: 0, questions: 0 };
  for (let i = 0; i < 7; i += 1) {
    const key = addDays(mon, i);
    if (key === today) {
      data.log[key] = {
        minutes: Math.max(0, Math.round(Number(current.minutes) || 0)),
        questions: Math.max(0, Math.round(Number(current.questions) || 0))
      };
    } else {
      const prev = data.log[key] || {};
      data.log[key] = {
        minutes: Math.round(DEMO_HOURS[i] * 60),
        questions: Math.max(0, Math.round(Number(prev.questions) || 0))
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
  const maxHours = Math.max(3, ...minutes.map((min) => min / 60));
  return minutes.map((min, index) => {
    const hours = min / 60;
    return {
      hours,
      maxHours,
      gold: index === 3 || index === 5,
      label: (Math.round(hours * 10) / 10).toFixed(1) + "h"
    };
  });
}

function $(id) { return document.getElementById(id); }

function renderHome() {
  const data = stateBox.data;
  const today = tokyoToday();
  const left = daysUntil(data.examDate, today);
  $("days-left").textContent = String(Math.max(0, left));
  $("past-note").hidden = left >= 0;

  const rec = todayRecord(data);
  $("today-time").textContent = formatDuration(rec.minutes);
  $("daily-goal").textContent = formatGoalHours(data.dailyGoalMinutes);
  $("streak-n").textContent = String(displayStreak(data));
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
  const known = ["home", "notes", "speed", "record", "perfect", "calendar", "settings"];
  return known.includes(hash) ? hash : "home";
}

function show(view) {
  document.querySelectorAll(".view").forEach((node) => {
    node.hidden = node.id !== "view-" + view;
  });
  const tab = view === "notes" || view === "speed" ? "home" : view;
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
    settings: "設定"
  };
  document.title = view === "home" ? "進捗管理" : titles[view] + " | 進捗管理";
  if (view === "record") fillRecord();
  if (view === "settings") fillSettings();
  renderHome();
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
  $("exam-date").value = data.examDate;
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
  const rec = data.log[today] || { minutes: 0, questions: 0 };
  const add = Math.max(0, Math.round(Number(extraMinutes) || 0));
  const questions = clamp(Math.round(Number($("q-input").value) || 0), 0, 9999);
  const beforeQ = Math.round(Number(rec.questions) || 0);
  rec.minutes = Math.max(0, Math.round(Number(rec.minutes) || 0)) + add;
  rec.questions = questions;
  data.log[today] = rec;
  data.subjects = readSubjectsFromForm();
  if (add > 0 || questions !== beforeQ) touchStreak(data);
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
  const exam = $("exam-date").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exam)) {
    toast("試験日を確認してください");
    return;
  }
  const hours = clamp(Number($("daily-hours").value) || 0, 0.5, 24);
  const week = clamp(Math.round(Number($("weekly-hours").value) || 0), 1, 168);
  const questions = clamp(Math.round(Number($("daily-questions").value) || 0), 1, 500);
  data.examDate = exam;
  data.dailyGoalMinutes = Math.round(hours * 60);
  data.weeklyGoalHours = week;
  data.dailyQuestionGoal = questions;
  save(data);
  fillSettings();
  renderHome();
  toast("設定を保存しました");
}

function bind() {
  window.addEventListener("hashchange", () => show(currentView()));

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
    stateBox.data = seed();
    save(stateBox.data);
    fillSettings();
    renderHome();
    toast("初期表示に戻しました");
  });
}

function boot() {
  stateBox.data = load();
  document.querySelectorAll('a[data-external="ox"]').forEach((node) => {
    node.href = OX_URL;
  });
  bind();
  if (!location.hash) location.hash = "#home";
  show(currentView());
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

boot();
