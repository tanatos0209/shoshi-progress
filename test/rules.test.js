"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../js/rules.js");

test("first Sunday of July and the day-after rollover", () => {
  assert.equal(R.firstSundayOfJuly(2026), "2026-07-05");
  assert.equal(R.firstSundayOfJuly(2027), "2027-07-04");
  assert.equal(R.firstSundayOfJuly(2028), "2028-07-02");
  assert.equal(R.computeExamDate("2026-11-01"), "2027-07-04");
  assert.equal(R.daysUntil("2027-07-04", "2026-11-01"), 245);
  assert.equal(R.examSummary("2026-11-01").label, "本試験　2027年7月4日　あと245日");
  assert.equal(R.computeExamDate("2026-10-31"), "2027-07-04");
  assert.equal(R.daysUntil("2027-07-04", "2026-10-31"), 246);
  assert.equal(R.computeExamDate("2027-07-04"), "2027-07-04");
  assert.equal(R.daysUntil("2027-07-04", "2027-07-04"), 0);
  assert.equal(R.computeExamDate("2027-07-05"), "2028-07-02");
  assert.equal(R.computeExamDate("2026-07-05"), "2026-07-05");
  assert.equal(R.computeExamDate("2026-07-06"), "2027-07-04");
  assert.equal(new Date(R.computeExamDate("2026-11-01") + "T00:00:00Z").getUTCDay(), 0);
});

test("streak starts at 0 and ignores opening the app", () => {
  const data = { log: {}, streak: 99, lastStudyDate: "2026-11-01" };
  assert.equal(R.syncStreak(data, "2026-11-01"), 0);
  assert.equal(data.streak, 0);
  assert.equal(data.lastStudyDate, "");
});

test("streak increments only at 30 minutes and keeps yesterday until today qualifies", () => {
  const day = (minutes, extra) => ({ minutes, questions: 0, ...extra });
  const today = "2026-11-01";
  const y = "2026-10-31";
  const y2 = "2026-10-30";

  let data = { log: { [today]: day(29) } };
  assert.equal(R.syncStreak(data, today), 0);

  data = { log: { [today]: day(30) } };
  assert.equal(R.syncStreak(data, today), 1);

  data = { log: { [y]: day(30), [today]: day(0) } };
  assert.equal(R.syncStreak(data, today), 1);

  data = { log: { [y]: day(30), [today]: day(29) } };
  assert.equal(R.syncStreak(data, today), 1);

  data = { log: { [y]: day(45), [today]: day(30) } };
  assert.equal(R.syncStreak(data, today), 2);

  data = { log: { [y2]: day(60), [y]: day(30), [today]: day(40) } };
  assert.equal(R.syncStreak(data, today), 3);

  data = { log: { [y2]: day(60), [y]: day(10), [today]: day(40) } };
  assert.equal(R.syncStreak(data, today), 1);

  data = { log: { [y]: day(10), [today]: day(10) } };
  assert.equal(R.syncStreak(data, today), 0);

  data = { log: { [y]: day(90, { sample: true }), [today]: day(30) } };
  assert.equal(R.syncStreak(data, today), 1);

  data = { log: { [y]: day(90, { sample: true }), [today]: day(0) } };
  assert.equal(R.syncStreak(data, today), 0);
});

test("study spans split on Tokyo midnight and round into minutes", () => {
  const data = { log: {} };
  const start = R.tokyoMidnightMs("2026-11-02") - 30 * 1000;
  const end = R.tokyoMidnightMs("2026-11-02") + 90 * 1000;
  R.addStudySpan(data, start, end);
  assert.equal(data.log["2026-11-01"].minutes, 0);
  assert.equal(data.log["2026-11-01"].carryMs, 30000);
  assert.equal(data.log["2026-11-02"].minutes, 1);
  assert.equal(data.log["2026-11-02"].carryMs, 30000);

  R.addStudyMs(data, "2026-11-01", 29 * 60000 + 30000);
  assert.equal(data.log["2026-11-01"].minutes, 30);
  assert.equal(R.syncStreak(data, "2026-11-01"), 1);
});

test("sample minutes are replaced when real study lands on that day", () => {
  const data = { log: { "2026-11-01": { minutes: 90, questions: 0, sample: true } } };
  R.addStudyMs(data, "2026-11-01", 60000);
  assert.equal(data.log["2026-11-01"].minutes, 1);
  assert.equal(data.log["2026-11-01"].sample, undefined);
});

test("pomodoro phases, overtime, pause, break, and next set", () => {
  const t0 = Date.UTC(2026, 10, 1, 1, 0, 0);
  let s = R.createSession("notes", t0);
  assert.equal(R.presentSession(s, t0).clock, "25:00");
  assert.equal(R.presentSession(s, t0).setLabel, "セット 1 / 勉強中");
  assert.equal(R.presentSession(s, t0).ring, 0);

  s = R.tickSession(s, t0 + 28 * 1000);
  const early = R.presentSession(s, t0 + 28 * 1000);
  assert.equal(early.clock, "24:32");
  assert.ok(early.ring > 0 && early.ring < 0.05);

  s = R.tickSession(s, t0 + R.WORK_MS - 1);
  assert.equal(s.phase, "work");
  s = R.tickSession(s, t0 + R.WORK_MS);
  assert.equal(s.phase, "workDone");
  const done = R.presentSession(s, t0 + R.WORK_MS + 12 * 1000);
  assert.equal(done.clock, "25:12");
  assert.equal(done.overtime, "+0:12");
  assert.equal(done.prompt, "終了してください");
  assert.equal(done.ring, 1);
  assert.equal(done.nudge, 0);
  assert.equal(R.presentSession(s, t0 + R.WORK_MS + R.NUDGE_MS).nudge, 1);
  assert.equal(R.presentSession(s, t0 + R.WORK_MS + 2 * R.NUDGE_MS).nudge, 2);

  const paused = R.pauseSession(s, t0 + 60 * 1000);
  assert.equal(paused, s, "pause is ignored once the set is complete");

  let running = R.createSession("ox", t0);
  running = R.pauseSession(running, t0 + 60 * 1000);
  assert.equal(running.phase, "paused");
  assert.equal(R.presentSession(running, t0 + 10 * 60 * 1000).clock, "24:00");
  assert.equal(R.presentSession(running, t0 + 10 * 60 * 1000).setLabel, "セット 1 / 一時停止中");
  running = R.resumeSession(running, t0 + 10 * 60 * 1000);
  running = R.tickSession(running, t0 + 10 * 60 * 1000 + 24 * 60 * 1000);
  assert.equal(running.phase, "workDone");

  const broke = R.startBreak(s, t0 + R.WORK_MS + 12 * 1000);
  assert.equal(broke.phase, "break");
  assert.equal(R.presentSession(broke, broke.breakEndsAt - 42 * 1000).clock, "00:42");
  assert.equal(R.presentSession(broke, broke.breakEndsAt - 42 * 1000).heading, "休憩中");
  assert.equal(R.presentSession(broke, broke.breakEndsAt - 42 * 1000).sub, "勉強計測は停止中");
  const studyWhileBreaking = R.liveSetMs(broke, broke.breakEndsAt);
  assert.equal(studyWhileBreaking, R.WORK_MS + 12 * 1000);

  let asked = R.tickSession(broke, broke.breakEndsAt);
  assert.equal(asked.phase, "breakDone");
  const ask0 = R.presentSession(asked, broke.breakEndsAt);
  assert.equal(ask0.clock, "00:00");
  assert.equal(ask0.prompt, "次のセットを始めますか？");
  assert.equal(ask0.breakOver, "");
  assert.equal(ask0.footer, "再開すると同じセット（テキストまとめ）を続行");
  const askLate = R.presentSession(asked, broke.breakEndsAt + (3 * 60 + 20) * 1000);
  assert.equal(askLate.breakOver, "休憩超過 +3:20");
  assert.equal(askLate.clock, "00:00");
  assert.equal(askLate.nudge, 0);
  assert.equal(R.presentSession(asked, broke.breakEndsAt + R.NUDGE_MS).nudge, 1);

  const next = R.confirmNextSet(asked, broke.breakEndsAt + 1000);
  assert.equal(next.phase, "work");
  assert.equal(next.setNo, 2);
  assert.equal(R.presentSession(next, next.runStartedAt).clock, "25:00");
  assert.equal(R.presentSession(next, next.runStartedAt).modeLabel, "テキストまとめ");
  assert.equal(next.priorSetsMs, R.WORK_MS + 12 * 1000);
});

test("detachSpans records study once and does not record break time", () => {
  const t0 = 1_700_000_000_000;
  let s = R.createSession("speed", t0);
  let detached = R.detachSpans(s, t0 + 90 * 1000);
  assert.equal(detached.spans.length, 1);
  assert.equal(detached.spans[0][1] - detached.spans[0][0], 90 * 1000);
  s = detached.session;
  detached = R.detachSpans(s, t0 + 90 * 1000);
  assert.equal(detached.spans.length, 0);

  s = R.tickSession(R.createSession("speed", t0), t0 + R.WORK_MS + 5000);
  s = R.startBreak(s, t0 + R.WORK_MS + 5000);
  const during = R.detachSpans(s, s.breakEndsAt - 1000);
  assert.equal(during.spans.length, 1);
  assert.equal(during.spans[0][1] - during.spans[0][0], R.WORK_MS + 5000);
  assert.equal(R.liveSetMs(during.session, s.breakEndsAt), R.WORK_MS + 5000);
});

test("clock helpers", () => {
  assert.equal(R.formatClock(0), "00:00");
  assert.equal(R.formatClock(1000), "00:01");
  assert.equal(R.formatClock(5 * 60 * 1000), "05:00");
  assert.equal(R.formatPlus(12 * 1000), "+0:12");
  assert.equal(R.formatPlus((3 * 60 + 20) * 1000), "+3:20");
  assert.equal(R.formatElapsed((25 * 60 + 12) * 1000), "25:12");
});

test("sanitizeSession rejects a broken resume payload", () => {
  assert.equal(R.sanitizeSession(null), null);
  assert.equal(R.sanitizeSession({ mode: "notes", phase: "work", runStartedAt: 0 }), null);
  const ok = R.sanitizeSession({
    mode: "ox",
    phase: "paused",
    setNo: 2,
    setAccumMs: 1000,
    runStartedAt: 0,
    spans: [[1, 2], [5, 4]]
  });
  assert.equal(ok.mode, "ox");
  assert.equal(ok.spans.length, 1);
});
