"use strict";

/* Calendar, streak, and study-timer rules. No DOM. */
const ProgressRules = (function () {
  const WORK_MS = 25 * 60 * 1000;
  const BREAK_MS = 5 * 60 * 1000;
  const NUDGE_MS = 10 * 60 * 1000;
  const STREAK_MINUTES = 30;
  const ENTRANCES = {
    notes: "テキストまとめ",
    ox: "択一対策",
    speed: "スピードチェック"
  };
  const PHASES = ["work", "paused", "workDone", "break", "breakDone"];

  function tokyoToday(now) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now instanceof Date ? now : new Date(now == null ? Date.now() : now));
  }

  function tokyoDateFromMs(ms) {
    return tokyoToday(ms);
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

  /* Monday of the Tokyo civil week that contains iso. Monday = 0. */
  function mondayOf(iso) {
    return addDays(iso, -weekdayMon0(iso));
  }

  /*
   * The week shown on the home chart. todayIso is the Tokyo calendar date
   * (tokyoToday), so the window moves at Monday 00:00 Asia/Tokyo.
   * Returns Monday through Sunday. Callers only read these keys; older logs stay stored.
   */
  function weekDates(todayIso) {
    const start = mondayOf(todayIso);
    const dates = [];
    for (let i = 0; i < 7; i += 1) dates.push(addDays(start, i));
    return dates;
  }

  function weekLogMinutes(log, todayIso) {
    return weekDates(todayIso).map((iso) => {
      const rec = log && log[iso];
      return rec ? Math.max(0, Math.round(Number(rec.minutes) || 0)) : 0;
    });
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

  function formatExamDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return `${y}年${m}月${d}日`;
  }

  /* First Sunday of July for a calendar year, as YYYY-MM-DD. */
  function firstSundayOfJuly(year) {
    const dow = new Date(Date.UTC(year, 6, 1)).getUTCDay();
    const offset = dow === 0 ? 0 : 7 - dow;
    return addDays(year + "-07-01", offset);
  }

  /*
   * Nearest exam day: first Sunday of July.
   * On the exam day itself N is 0 and the date stays.
   * The next Tokyo calendar day rolls to the following year.
   */
  function computeExamDate(todayIso) {
    const year = Number(String(todayIso).slice(0, 4));
    const thisYear = firstSundayOfJuly(year);
    if (thisYear < todayIso) return firstSundayOfJuly(year + 1);
    return thisYear;
  }

  function examSummary(todayIso) {
    const examDate = computeExamDate(todayIso);
    const days = daysUntil(examDate, todayIso);
    return {
      examDate,
      days,
      label: `本試験　${formatExamDate(examDate)}　あと${days}日`
    };
  }

  function dayQualifies(log, iso) {
    const rec = log && log[iso];
    if (!rec || rec.sample) return false;
    return Math.round(Number(rec.minutes) || 0) >= STREAK_MINUTES;
  }

  /* Consecutive qualifying days ending today, or yesterday if today is still short. */
  function syncStreak(data, todayIso) {
    const today = todayIso || tokyoToday();
    const log = data.log || {};
    let cursor = dayQualifies(log, today) ? today : addDays(today, -1);
    let streak = 0;
    let last = "";
    while (dayQualifies(log, cursor)) {
      if (!last) last = cursor;
      streak += 1;
      cursor = addDays(cursor, -1);
      if (streak > 20000) break;
    }
    data.streak = streak;
    data.lastStudyDate = last;
    return streak;
  }

  function tokyoMidnightMs(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d) - 9 * 60 * 60 * 1000;
  }

  function ensureDay(data, iso) {
    const rec = data.log[iso] || { minutes: 0, questions: 0, carryMs: 0 };
    rec.minutes = Math.max(0, Math.round(Number(rec.minutes) || 0));
    rec.questions = Math.max(0, Math.round(Number(rec.questions) || 0));
    rec.carryMs = Math.max(0, Number(rec.carryMs) || 0);
    data.log[iso] = rec;
    return rec;
  }

  function addStudyMs(data, iso, ms) {
    if (!(ms > 0)) return;
    const rec = ensureDay(data, iso);
    if (rec.sample) {
      rec.minutes = 0;
      rec.carryMs = 0;
      delete rec.sample;
    }
    const total = rec.carryMs + ms;
    const addMin = Math.floor(total / 60000);
    rec.minutes += addMin;
    rec.carryMs = total - addMin * 60000;
  }

  /* Split a study span across Tokyo midnights so each calendar day keeps its own minutes. */
  function addStudySpan(data, startMs, endMs) {
    if (!(endMs > startMs)) return 0;
    let cursor = startMs;
    let guard = 0;
    while (cursor < endMs && guard < 4000) {
      const iso = tokyoDateFromMs(cursor);
      const boundary = tokyoMidnightMs(addDays(iso, 1));
      const sliceEnd = Math.min(endMs, boundary);
      if (!(sliceEnd > cursor)) break;
      addStudyMs(data, iso, sliceEnd - cursor);
      cursor = sliceEnd;
      guard += 1;
    }
    return endMs - startMs;
  }

  function createSession(mode, now) {
    return {
      mode,
      setNo: 1,
      phase: "work",
      priorSetsMs: 0,
      setAccumMs: 0,
      runStartedAt: now,
      breakEndsAt: 0,
      breakOverStartedAt: 0,
      seenNudge: 0,
      spans: []
    };
  }

  function liveSetMs(session, now) {
    if (!session) return 0;
    if ((session.phase === "work" || session.phase === "workDone") && session.runStartedAt) {
      return session.setAccumMs + Math.max(0, now - session.runStartedAt);
    }
    return session.setAccumMs;
  }

  function tickSession(session, now) {
    if (!session) return session;
    if (session.phase === "work" && liveSetMs(session, now) >= WORK_MS) {
      return { ...session, phase: "workDone", seenNudge: 0 };
    }
    if (session.phase === "break" && now >= session.breakEndsAt) {
      return {
        ...session,
        phase: "breakDone",
        breakOverStartedAt: session.breakEndsAt,
        seenNudge: 0
      };
    }
    return session;
  }

  function pauseSession(session, now) {
    if (!session || session.phase !== "work") return session;
    const end = now;
    return {
      ...session,
      phase: "paused",
      setAccumMs: session.setAccumMs + Math.max(0, end - session.runStartedAt),
      spans: session.spans.concat([[session.runStartedAt, end]]),
      runStartedAt: 0
    };
  }

  function resumeSession(session, now) {
    if (!session || session.phase !== "paused") return session;
    return { ...session, phase: "work", runStartedAt: now };
  }

  function startBreak(session, now) {
    if (!session || session.phase !== "workDone") return session;
    const end = now;
    return {
      ...session,
      phase: "break",
      setAccumMs: session.setAccumMs + Math.max(0, end - session.runStartedAt),
      spans: session.spans.concat([[session.runStartedAt, end]]),
      runStartedAt: 0,
      breakEndsAt: now + BREAK_MS,
      seenNudge: 0
    };
  }

  function confirmNextSet(session, now) {
    if (!session || session.phase !== "breakDone") return session;
    return {
      ...session,
      phase: "work",
      priorSetsMs: session.priorSetsMs + session.setAccumMs,
      setNo: session.setNo + 1,
      setAccumMs: 0,
      runStartedAt: now,
      breakEndsAt: 0,
      breakOverStartedAt: 0,
      seenNudge: 0
    };
  }

  /* Move closed and in-progress study spans out so they can be stored once. */
  function detachSpans(session, now) {
    if (!session) return { session, spans: [] };
    let spans = session.spans.slice();
    let next = { ...session, spans: [] };
    if ((session.phase === "work" || session.phase === "workDone") && session.runStartedAt) {
      const end = now;
      if (end > session.runStartedAt) {
        spans = spans.concat([[session.runStartedAt, end]]);
        next = {
          ...next,
          setAccumMs: session.setAccumMs + (end - session.runStartedAt),
          runStartedAt: end
        };
      }
    }
    return { session: next, spans };
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function formatClock(ms) {
    const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return pad2(m) + ":" + pad2(s);
  }

  function formatElapsed(ms) {
    const total = Math.floor(Math.max(0, ms) / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return h + ":" + pad2(m) + ":" + pad2(s);
    return pad2(m) + ":" + pad2(s);
  }

  function formatPlus(ms) {
    const total = Math.floor(Math.max(0, ms) / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return "+" + h + ":" + pad2(m) + ":" + pad2(s);
    return "+" + m + ":" + pad2(s);
  }

  function presentSession(session, now) {
    const setMs = liveSetMs(session, now);
    const label = ENTRANCES[session.mode] || "";
    if (session.phase === "work" || session.phase === "paused") {
      const remaining = Math.max(0, WORK_MS - setMs);
      const paused = session.phase === "paused";
      return {
        screen: "work",
        clock: formatClock(remaining),
        overtime: "",
        ring: Math.max(0, Math.min(1, setMs / WORK_MS)),
        overtimeMode: false,
        setLabel: "セット " + session.setNo + " / " + (paused ? "一時停止中" : "勉強中"),
        prompt: "",
        paused,
        heading: "",
        sub: "",
        breakOver: "",
        footer: "",
        nudge: 0,
        modeLabel: label
      };
    }
    if (session.phase === "workDone") {
      const over = Math.max(0, setMs - WORK_MS);
      return {
        screen: "workDone",
        clock: formatElapsed(setMs),
        overtime: formatPlus(over),
        ring: 1,
        overtimeMode: true,
        setLabel: "",
        prompt: "終了してください",
        paused: false,
        heading: "",
        sub: "",
        breakOver: "",
        footer: "",
        nudge: Math.floor(over / NUDGE_MS),
        modeLabel: label
      };
    }
    if (session.phase === "break") {
      const remaining = Math.max(0, session.breakEndsAt - now);
      return {
        screen: "break",
        clock: formatClock(remaining),
        overtime: "",
        ring: 0,
        overtimeMode: false,
        setLabel: "",
        prompt: "",
        paused: false,
        heading: "休憩中",
        sub: "勉強計測は停止中",
        breakOver: "",
        footer: "",
        nudge: 0,
        modeLabel: label
      };
    }
    const over = Math.max(0, now - (session.breakOverStartedAt || now));
    return {
      screen: "breakDone",
      clock: "00:00",
      overtime: "",
      ring: 0,
      overtimeMode: false,
      setLabel: "",
      prompt: "次のセットを始めますか？",
      paused: false,
      heading: "",
      sub: "",
      breakOver: over >= 1000 ? "休憩超過 " + formatPlus(over) : "",
      footer: "再開すると同じセット（" + label + "）を続行",
      nudge: Math.floor(over / NUDGE_MS),
      modeLabel: label
    };
  }

  function sanitizeSession(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (!ENTRANCES[raw.mode]) return null;
    if (!PHASES.includes(raw.phase)) return null;
    const spans = Array.isArray(raw.spans)
      ? raw.spans.filter((pair) => Array.isArray(pair) && pair.length === 2 && pair[1] > pair[0])
      : [];
    const session = {
      mode: raw.mode,
      setNo: Math.max(1, Math.round(Number(raw.setNo) || 1)),
      phase: raw.phase,
      priorSetsMs: Math.max(0, Number(raw.priorSetsMs) || 0),
      setAccumMs: Math.max(0, Number(raw.setAccumMs) || 0),
      runStartedAt: Number(raw.runStartedAt) || 0,
      breakEndsAt: Number(raw.breakEndsAt) || 0,
      breakOverStartedAt: Number(raw.breakOverStartedAt) || 0,
      seenNudge: Math.max(0, Math.round(Number(raw.seenNudge) || 0)),
      spans
    };
    if ((session.phase === "work" || session.phase === "workDone") && !(session.runStartedAt > 0)) {
      return null;
    }
    if (session.phase === "break" && !(session.breakEndsAt > 0)) return null;
    if (session.phase === "breakDone" && !(session.breakOverStartedAt > 0)) return null;
    return session;
  }

  return {
    WORK_MS,
    BREAK_MS,
    NUDGE_MS,
    STREAK_MINUTES,
    ENTRANCES,
    tokyoToday,
    tokyoDateFromMs,
    addDays,
    weekdayMon0,
    mondayOf,
    weekDates,
    weekLogMinutes,
    daysUntil,
    formatJPDate,
    formatExamDate,
    firstSundayOfJuly,
    computeExamDate,
    examSummary,
    dayQualifies,
    syncStreak,
    tokyoMidnightMs,
    addStudyMs,
    addStudySpan,
    createSession,
    liveSetMs,
    tickSession,
    pauseSession,
    resumeSession,
    startBreak,
    confirmNextSet,
    detachSpans,
    formatClock,
    formatElapsed,
    formatPlus,
    presentSession,
    sanitizeSession
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ProgressRules;
}
