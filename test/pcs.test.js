"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Pcs = require("../js/pcs.js");

function dataOn(today, goal) {
  return {
    dailyQuestionGoal: goal || 20,
    srs: { notes: {}, speed: {} },
    log: {}
  };
}

test("breakdown order is fixed and only three kinds feed the average", () => {
  assert.deepEqual(Pcs.ROWS.map((row) => row.label), [
    "テキスト", "問題集", "テキストまとめ", "択一対策", "スピードチェック"
  ]);
  assert.deepEqual(Pcs.ROWS.map((row) => row.feeds), [false, false, true, true, true]);
});

test("source books default to Vマジック and 未成年者 is 合格ゾーン", () => {
  assert.equal(Pcs.sourceName("B"), "Vマジック");
  assert.equal(Pcs.sourceName(undefined), "Vマジック");
  assert.equal(Pcs.SOURCES.defaultId, "B");
  const tagged = Pcs.NOTES.filter((topic) => topic.source === "A").map((topic) => topic.id);
  assert.deepEqual(tagged, ["note-miseinen"]);
  assert.equal(Pcs.sourceName("A"), "合格ゾーンテキスト");
  Pcs.NOTES.forEach((topic) => {
    if (topic.id !== "note-miseinen") assert.equal(topic.source, "B");
  });
});

test("overall percent is an unweighted average of scheduled kinds", () => {
  const plan = {
    date: "2026-11-01",
    started: true,
    seen: { text: false, workbook: false },
    notes: { ids: ["a", "b"], roles: {}, done: ["a", "b"] },
    ox: { target: 2 },
    speed: { topics: ["t"], questions: ["t:1"], reviewed: [], answered: [] },
    completion: {}
  };
  const model = Pcs.progress(plan, 0);
  assert.equal(model.overall, Math.round((100 + 0 + 0) / 3));
  assert.equal(model.rows.find((row) => row.id === "text").percent, 0);
  assert.equal(model.rows.find((row) => row.id === "workbook").percent, 0);
  assert.equal(model.rows.find((row) => row.id === "notes").percent, 100);
  const both = Pcs.progress({
    ...plan,
    speed: { topics: ["t"], questions: ["t:1"], reviewed: ["t"], answered: ["t:1"] }
  }, 0);
  assert.equal(both.overall, Math.round((100 + 0 + 100) / 3));
});

test("a kind with nothing scheduled drops out of the average", () => {
  const plan = {
    date: "2026-11-01",
    started: false,
    seen: { text: true, workbook: true },
    notes: { ids: [], roles: {}, done: [] },
    ox: { target: 4 },
    speed: { topics: [], questions: [], reviewed: [], answered: [] },
    completion: {}
  };
  const model = Pcs.progress(plan, 2);
  assert.equal(model.parts.length, 1);
  assert.equal(model.parts[0].id, "ox");
  assert.equal(model.overall, 50);
});

test("placeholders come first and do not change the percent", () => {
  const data = dataOn("2026-11-01");
  const plan = Pcs.ensurePlan(data, "2026-11-01");
  const before = Pcs.progress(plan, 0).overall;
  assert.equal(Pcs.nextStep(plan, 0).kind, "text");
  const passed = Pcs.passPlaceholder(data, "2026-11-01", "text");
  assert.equal(passed.changed, true);
  assert.equal(passed.progress.overall, before);
  assert.equal(Pcs.nextStep(plan, 0).kind, "workbook");
  Pcs.passPlaceholder(data, "2026-11-01", "workbook");
  assert.equal(Pcs.progress(plan, 0).overall, before);
  assert.equal(Pcs.nextStep(plan, 0).kind, "notes");
  assert.equal(plan.notes.roles[plan.notes.ids[0]], "new");
});

test("one note, one ox question, and one speed action do not finish the day", () => {
  const data = dataOn("2026-11-01");
  const plan = Pcs.ensurePlan(data, "2026-11-01");
  Pcs.passPlaceholder(data, "2026-11-01", "text");
  Pcs.passPlaceholder(data, "2026-11-01", "workbook");
  const note = Pcs.nextStep(plan, 0);
  const afterNote = Pcs.completeNote(data, "2026-11-01", note.id, "known");
  assert.equal(afterNote.changed, true);
  assert.ok(afterNote.progress.overall < 100);
  assert.equal(afterNote.progress.rows.find((row) => row.id === "notes").percent, 50);
  assert.equal(afterNote.progress.rows.find((row) => row.id === "ox").percent, 0);
  const again = Pcs.completeNote(data, "2026-11-01", note.id, "unknown");
  assert.equal(again.changed, false);
  assert.equal(plan.notes.done.length, 1);

  const ox = Pcs.completeOxOne(data, "2026-11-01");
  assert.equal(ox.changed, true);
  assert.equal(data.log["2026-11-01"].questions, 1);
  assert.notEqual(data.log["2026-11-01"].questions, plan.ox.target);
  assert.equal(ox.progress.rows.find((row) => row.id === "ox").percent, Math.round(100 / plan.ox.target));

  const second = plan.notes.ids[1];
  Pcs.completeNote(data, "2026-11-01", second, "unknown");
  assert.equal(Pcs.progress(plan, 1).rows.find((row) => row.id === "notes").percent, 100);
  const knownCard = data.srs.notes[note.id];
  const unknownCard = data.srs.notes[second];
  assert.equal(knownCard.priority, 0);
  assert.ok(unknownCard.priority > knownCard.priority);
  assert.equal(unknownCard.due, "2026-11-02");
  assert.equal(Pcs.progress(plan, 1).rows.find((row) => row.id === "notes").percent, 100);
});

test("わからない is served before other reviews the next day", () => {
  const data = dataOn("2026-11-01");
  const plan = Pcs.ensurePlan(data, "2026-11-01");
  Pcs.completeNote(data, "2026-11-01", plan.notes.ids[0], "known");
  Pcs.completeNote(data, "2026-11-01", plan.notes.ids[1], "unknown");
  const first = plan.notes.ids[0];
  const second = plan.notes.ids[1];
  const next = Pcs.ensurePlan(data, "2026-11-02");
  assert.equal(next.notes.ids[0], second);
  assert.equal(next.notes.roles[second], "review");
  assert.equal(next.notes.ids[1], first);
  assert.equal(next.notes.roles[first], "review");
  assert.equal(next.quotas.notesNew, Pcs.BASE.notesNew + 1);
  assert.equal(next.ox.target, 19);
});

test("opening the app without starting does not nudge the next day", () => {
  const data = dataOn("2026-11-01");
  Pcs.ensurePlan(data, "2026-11-01");
  const next = Pcs.ensurePlan(data, "2026-11-02");
  assert.equal(next.quotas.notesNew, Pcs.BASE.notesNew);
  assert.equal(next.ox.target, 20);
  assert.equal(next.quotas.speedTopics, Pcs.BASE.speedTopics);
});

test("nudge stays within one of the base and does not stack", () => {
  assert.equal(Pcs.nudge(20, null), 20);
  assert.equal(Pcs.nudge(20, 1), 21);
  assert.equal(Pcs.nudge(20, 1.4), 21);
  assert.equal(Pcs.nudge(20, 0.5), 20);
  assert.equal(Pcs.nudge(20, 0), 19);
  assert.equal(Pcs.nudge(1, 0), 1);
  const data = dataOn("2026-11-01");
  const day1 = Pcs.ensurePlan(data, "2026-11-01");
  day1.started = true;
  day1.completion = { notes: 0, ox: 0, speed: 0 };
  const day2 = Pcs.ensurePlan(data, "2026-11-02");
  assert.equal(day2.ox.target, 19);
  day2.started = true;
  day2.completion = { notes: 0, ox: 0, speed: 0 };
  const day3 = Pcs.ensurePlan(data, "2026-11-03");
  assert.equal(day3.ox.target, 19);
});

test("guide resumes at the remaining step in list order", () => {
  const plan = {
    date: "2026-11-01",
    started: true,
    seen: { text: true, workbook: true },
    notes: { ids: ["note-kenri", "note-ishi"], roles: { "note-kenri": "review", "note-ishi": "new" }, done: ["note-kenri"] },
    ox: { target: 3 },
    speed: { topics: ["cap"], questions: ["cap:1", "cap:2"], reviewed: [], answered: [] },
    completion: {}
  };
  assert.equal(Pcs.nextStep(plan, 0).id, "note-ishi");
  plan.notes.done.push("note-ishi");
  assert.equal(Pcs.nextStep(plan, 1).kind, "ox");
  assert.equal(Pcs.nextStep(plan, 3).kind, "speed");
  assert.equal(Pcs.nextStep(plan, 3).type, "topic");
  plan.speed.reviewed.push("cap");
  assert.equal(Pcs.nextStep(plan, 3).id, "cap:1");
  plan.speed.answered.push("cap:1");
  assert.equal(Pcs.nextStep(plan, 3).id, "cap:2");
  plan.speed.answered.push("cap:2");
  assert.equal(Pcs.nextStep(plan, 3), null);
  assert.equal(Pcs.hasResume(plan, 3), true);
  const list = Pcs.taskList(plan, 3);
  assert.deepEqual(list.map((item) => item.label), [
    "テキスト", "問題集", "テキストまとめ", "択一対策", "スピードチェック"
  ]);
  assert.equal(list[4].finished, true);
  assert.equal(list[3].finished, true);
});

test("speed percent counts a reviewed topic and each ○× once", () => {
  const data = dataOn("2026-11-01");
  const plan = Pcs.ensurePlan(data, "2026-11-01");
  assert.equal(plan.speed.topics.length, 1);
  assert.equal(plan.speed.topics[0], "cap");
  assert.deepEqual(plan.speed.questions, ["cap:1", "cap:2", "cap:3"]);
  const reviewed = Pcs.reviewSpeedTopic(data, "2026-11-01", "cap", "unknown");
  assert.equal(reviewed.changed, true);
  assert.equal(reviewed.progress.rows.find((row) => row.id === "speed").percent, 25);
  assert.equal(Pcs.reviewSpeedTopic(data, "2026-11-01", "cap", "known").changed, false);
  assert.ok(data.srs.speed.cap.priority > 0);
  Pcs.answerSpeed(data, "2026-11-01", "cap:1");
  assert.equal(Pcs.answerSpeed(data, "2026-11-01", "cap:1").changed, false);
  Pcs.answerSpeed(data, "2026-11-01", "cap:2");
  const last = Pcs.answerSpeed(data, "2026-11-01", "cap:3");
  assert.equal(last.progress.rows.find((row) => row.id === "speed").percent, 100);
  assert.equal(Pcs.answerSpeed(data, "2026-11-01", "miss:1").changed, false);
});

test("today's plan stays put when ensurePlan runs again", () => {
  const data = dataOn("2026-11-01");
  const plan = Pcs.ensurePlan(data, "2026-11-01");
  plan.notes.done.push(plan.notes.ids[0]);
  const again = Pcs.ensurePlan(data, "2026-11-01");
  assert.equal(again, plan);
  assert.equal(again.notes.done.length, 1);
});

test("new notes are capped by the catalog and reviews stay ahead of new cards", () => {
  const srs = {};
  Pcs.NOTES.forEach((topic) => {
    srs[topic.id] = { introduced: "2026-10-01", due: "2026-12-01", interval: 4, priority: 0, lastDay: "2026-10-01" };
  });
  srs["note-kyogi"].due = "2026-11-01";
  srs["note-kyogi"].priority = 3;
  const picked = Pcs.selectNotes(srs, "2026-11-01", 5);
  assert.deepEqual(picked.ids, ["note-kyogi"]);
  assert.equal(picked.roles["note-kyogi"], "review");
  const fresh = Pcs.selectNotes({}, "2026-11-01", 99);
  assert.equal(fresh.ids.length, Pcs.NOTES.length);
  assert.equal(fresh.roles[fresh.ids[0]], "new");
});

test("starter speed sample is chapter 1 自然人の能力", () => {
  assert.equal(Pcs.SPEED_CHAPTERS[0].title, "第1章 総則");
  assert.equal(Pcs.SPEED_CHAPTERS[0].topics[0].title, "自然人の能力");
  assert.equal(Pcs.speedQuestionById("cap:2").answer, false);
  assert.equal(Pcs.stepLabel({ kind: "notes" }), "3/5 テキストまとめ");
  assert.equal(Pcs.stepLabel({ kind: "text" }), "1/5 テキスト");
});
