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

test("breakdown order is fixed and all five kinds feed the average", () => {
  assert.deepEqual(Pcs.ROWS.map((row) => row.label), [
    "テキスト", "問題集", "テキストまとめ", "択一対策", "スピードチェック"
  ]);
  assert.deepEqual(Pcs.ROWS.map((row) => row.feeds), [true, true, true, true, true]);
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

test("overall percent is an unweighted average of the five breakdown rows", () => {
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
  assert.equal(model.overall, Math.round((0 + 0 + 100 + 0 + 0) / 5));
  assert.equal(model.rows.find((row) => row.id === "text").percent, 0);
  assert.equal(model.rows.find((row) => row.id === "workbook").percent, 0);
  assert.equal(model.rows.find((row) => row.id === "notes").percent, 100);
  const both = Pcs.progress({
    ...plan,
    speed: { topics: ["t"], questions: ["t:1"], reviewed: ["t"], answered: ["t:1"] }
  }, 0);
  assert.equal(both.overall, Math.round((0 + 0 + 100 + 0 + 100) / 5));
});

test("text 0 and workbook 0 stay in the average when the other three are done", () => {
  const plan = {
    seen: { text: false, workbook: false },
    text: { subject: "不動産登記法Ⅰ", start: 1, end: 19, pages: 19, read: 0 },
    notes: { ids: ["a", "b"], roles: {}, done: ["a", "b"] },
    ox: { target: 4 },
    speed: { topics: ["cap"], questions: ["cap:1"], reviewed: ["cap"], answered: ["cap:1"] }
  };
  const model = Pcs.progress(plan, 4);
  assert.deepEqual(model.rows.map((row) => row.percent), [0, 0, 100, 100, 100]);
  assert.equal(model.overall, 60);
  plan.text.read = 19;
  const full = Pcs.progress(plan, 4);
  assert.equal(full.rows[0].percent, 100);
  assert.equal(full.overall, 80);
});

test("a row at 0 still counts, including a kind with nothing scheduled", () => {
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
  assert.equal(model.parts.length, 5);
  assert.equal(model.rows.find((row) => row.id === "ox").percent, 50);
  assert.equal(model.rows.find((row) => row.id === "notes").percent, 0);
  assert.equal(model.overall, 10);
});

test("text quota is one line and confirmed pages can move again", () => {
  const data = dataOn("2026-11-01");
  const plan = Pcs.ensurePlan(data, "2026-11-01");
  assert.equal(plan.text.subject, "不動産登記法Ⅰ");
  assert.equal(plan.text.pages, 19);
  assert.equal(Pcs.textQuotaLine(plan.text), "不動産登記法Ⅰ p.1–19（19ページ）");
  assert.equal(Pcs.textRangeLabel(plan.text), "p.1 – 19");
  assert.equal(Pcs.textMetaLine(plan.text), "不動産登記法Ⅰ ・ 19ページ");
  assert.equal(Pcs.textCountLabel(0, 19), "0/19ページ");
  assert.equal(/^[0-9]/.test(Pcs.textQuotaLine(plan.text)), false);
  const cleaned = Pcs.textQuotaLine({ subject: "1 民法Ⅰ", start: 1, end: 19 });
  assert.equal(cleaned, "民法Ⅰ p.1–19（19ページ）");
  assert.equal(Pcs.textQuotaLine({ subject: "Ⅰ 民法", start: 1, end: 19 }), "民法 p.1–19（19ページ）");
  assert.equal(Pcs.nextStep(plan, 0).kind, "text");
  assert.equal(Pcs.nextStep(plan, 0).placeholder, undefined);
  assert.equal(Pcs.passPlaceholder(data, "2026-11-01", "text").changed, false);
  const partial = Pcs.confirmTextPages(data, "2026-11-01", 10);
  assert.equal(partial.changed, true);
  assert.equal(plan.text.read, 10);
  assert.equal(partial.progress.rows.find((row) => row.id === "text").percent, Math.round((10 / 19) * 100));
  assert.equal(Pcs.nextStep(plan, 0).kind, "text");
  const again = Pcs.confirmTextPages(data, "2026-11-01", 4);
  assert.equal(again.changed, true);
  assert.equal(plan.text.read, 4);
  assert.equal(Pcs.confirmTextPages(data, "2026-11-01", 99).changed, true);
  assert.equal(plan.text.read, 19);
  assert.equal(Pcs.progress(plan, 0).rows.find((row) => row.id === "text").percent, 100);
  assert.equal(Pcs.nextStep(plan, 0).kind, "workbook");
  assert.equal(Pcs.nextStep(plan, 0).placeholder, undefined);
  const before = Pcs.progress(plan, 0).overall;
  const skipped = Pcs.passPlaceholder(data, "2026-11-01", "workbook");
  assert.equal(skipped.changed, false);
  assert.equal(Pcs.progress(plan, 0).overall, before);
  const partialBook = Pcs.confirmWorkbookSolved(data, "2026-11-01", 10);
  assert.equal(partialBook.changed, true);
  assert.equal(plan.workbook.solved, 10);
  assert.equal(partialBook.progress.rows.find((row) => row.id === "workbook").percent, Math.round((10 / 19) * 100));
  assert.equal(Pcs.nextStep(plan, 0).kind, "workbook");
  const lowerBook = Pcs.confirmWorkbookSolved(data, "2026-11-01", 4);
  assert.equal(lowerBook.changed, true);
  assert.equal(plan.workbook.solved, 4);
  assert.equal(Pcs.confirmWorkbookSolved(data, "2026-11-01", 99).changed, true);
  assert.equal(plan.workbook.solved, 19);
  assert.equal(Pcs.progress(plan, 0).rows.find((row) => row.id === "workbook").percent, 100);
  assert.equal(Pcs.nextStep(plan, 0).kind, "notes");
  assert.equal(plan.notes.roles[plan.notes.ids[0]], "new");
});

test("one note, one ox question, and one speed action do not finish the day", () => {
  const data = dataOn("2026-11-01");
  const plan = Pcs.ensurePlan(data, "2026-11-01");
  Pcs.confirmTextPages(data, "2026-11-01", 19);
  Pcs.confirmWorkbookSolved(data, "2026-11-01", 19);
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
  assert.equal(Pcs.stepLabel({ kind: "workbook" }), "2/5 問題集");
});

test("workbook quota is one problem span and solved count feeds the average", () => {
  const data = dataOn("2026-11-01");
  const plan = Pcs.ensurePlan(data, "2026-11-01");
  assert.equal(plan.workbook.subject, "不動産登記法 I");
  assert.equal(plan.workbook.subtitle, "合格ゾーン択一");
  assert.equal(plan.workbook.count, 19);
  assert.equal(Pcs.workbookQuotaLine(plan.workbook), "不動産登記法 I 問1–19（19問）");
  assert.equal(Pcs.workbookRangeLabel(plan.workbook), "問 1 – 19");
  assert.equal(Pcs.workbookMetaLine(plan.workbook), "不動産登記法 I ・ 19問");
  assert.equal(Pcs.workbookCountLabel(10, 19), "10/19問");
  assert.equal(Pcs.workbookQuotaLine(plan.workbook).includes("紙の"), false);
  assert.equal(Pcs.workbookQuotaLine(plan.workbook).includes("章"), false);
  assert.equal(Pcs.taskList(plan, 0).find((item) => item.id === "workbook").status, "0/19");
  Pcs.confirmTextPages(data, "2026-11-01", 19);
  Pcs.confirmWorkbookSolved(data, "2026-11-01", 10);
  const model = Pcs.progress(plan, 0);
  assert.equal(model.rows.find((row) => row.id === "workbook").percent, Math.round((10 / 19) * 100));
  assert.equal(model.overall, Math.round((100 + (10 / 19) * 100 + 0 + 0 + 0) / 5));
  const bare = {
    seen: { workbook: false },
    notes: { ids: ["a"], roles: {}, done: [] },
    ox: { target: 1 },
    speed: { topics: [], questions: [], reviewed: [], answered: [] }
  };
  assert.equal(Pcs.progress(bare, 0).rows.find((row) => row.id === "workbook").percent, 0);
  assert.equal(Pcs.nextStep(bare, 0).placeholder, true);
});
