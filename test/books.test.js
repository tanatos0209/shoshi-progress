"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.ProgressRules = require("../js/rules.js");
global.Pcs = require("../js/pcs.js");
const {
  BOOK_LIMIT,
  normalizeBooks,
  booksEqual,
  emptyBookSlots,
  normalize,
  bookGauge,
  bookGaugeLabel
} = require("../js/app.js");
const { encodeDoc, decodeDoc, isUntouchedDemo } = require("../js/sync.js");

test("books stay on the progress state and cap at 25", () => {
  assert.equal(BOOK_LIMIT, 25);
  const many = [];
  for (let i = 0; i < 30; i += 1) many.push({ id: "id-" + i, title: "教材" + i, note: "メモ" });
  many.push({ title: "   " }, null, { title: 12 });
  const books = normalizeBooks(many);
  assert.equal(books.length, 25);
  assert.equal(books[0].id, "id-0");
  assert.equal(books[0].title, "教材0");
  assert.equal(books[24].title, "教材24");
  assert.equal(books.every((book) => book.note === "メモ"), true);

  const state = normalize({
    books: [
      { id: "vm", title: "  Vマジック  ", note: " 民法 ", color: "#c0392b", image: "data:image/jpeg;base64,aaaa" },
      { id: "vm", title: "合格ゾーン", color: "not-a-color" },
      { title: "x".repeat(80), note: "y".repeat(120), image: "https://example.invalid/cover.jpg" }
    ],
    subjects: { main: { choice: 18, written: 0 } }
  });
  assert.equal(state.books.length, 3);
  assert.equal(state.books[0].title, "Vマジック");
  assert.equal(state.books[0].note, "民法");
  assert.equal(state.books[0].color, "#c0392b");
  assert.equal(state.books[0].image, "data:image/jpeg;base64,aaaa");
  assert.equal(state.books[1].id === "vm", false);
  assert.equal(state.books[1].color, "#f6f1e7");
  assert.equal(state.books[2].title.length, 40);
  assert.equal(state.books[2].note.length, 80);
  assert.equal(state.books[2].image, "");
  assert.equal(state.subjects.main.choice, 18);
  assert.equal(Array.isArray(state.books), true);
});

test("oversized cover images are dropped and drafts compare field by field", () => {
  const huge = "data:image/jpeg;base64," + "a".repeat(30000);
  const cleaned = normalizeBooks([{ id: "big", title: "民法", image: huge }]);
  assert.equal(cleaned[0].image, "");
  assert.equal(cleaned[0].title, "民法");
  const saved = normalizeBooks([{ id: "a", title: "民法", note: "", color: "#c0392b" }]);
  assert.equal(booksEqual(saved, saved.map((book) => ({ ...book }))), true);
  const renamed = saved.map((book) => ({ ...book, title: "会社法" }));
  assert.equal(booksEqual(saved, renamed), false);
  const reordered = normalizeBooks([
    { id: "b", title: "会社法", color: "#1e4d8c" },
    { id: "a", title: "民法", color: "#c0392b" }
  ]);
  assert.equal(booksEqual(saved, reordered), false);
  assert.equal(booksEqual([], null), true);
});

test("empty add slots fill the row and stop at 25", () => {
  assert.equal(emptyBookSlots(0), 4);
  assert.equal(emptyBookSlots(1), 3);
  assert.equal(emptyBookSlots(8), 4);
  assert.equal(emptyBookSlots(23), 1);
  assert.equal(emptyBookSlots(24), 1);
  assert.equal(emptyBookSlots(25), 0);
  assert.equal(emptyBookSlots(40), 0);
});

test("a book's unit locks and the gauge reads PCS only when the subject matches", () => {
  const locked = normalizeBooks([{
    id: "law",
    title: "基本書",
    note: "不動産登記法",
    unit: "page",
    total: 320
  }, {
    id: "magic",
    title: "Vマジック",
    note: "1",
    unit: "page",
    total: 400
  }, {
    id: "bad",
    title: "未設定",
    unit: "page",
    total: 0
  }]);
  assert.equal(locked[0].unit, "page");
  assert.equal(locked[0].total, 320);
  assert.equal(locked[2].unit, "");
  assert.equal(locked[2].total, 0);
  assert.equal(booksEqual(locked, locked.map((book) => ({ ...book, unit: "question" }))), false);

  const plan = {
    date: "2026-11-02",
    text: { subject: "不動産登記法Ⅰ", source: "B", read: 12, pages: 19 },
    workbook: { subject: "不動産登記法 I", subtitle: "合格ゾーン択一", solved: 4, count: 19 }
  };
  const pageGauge = bookGauge(locked[0], plan);
  assert.equal(pageGauge.linked, true);
  assert.equal(pageGauge.current, 12);
  assert.equal(pageGauge.total, 320);
  assert.equal(bookGaugeLabel(pageGauge), "P.12 / P.320");
  const unrelated = bookGauge(locked[1], plan);
  assert.equal(unrelated.linked, false);
  assert.equal(unrelated.current, 0);
  assert.equal(bookGaugeLabel(unrelated), "P.0 / P.400");
  const questions = bookGauge({ title: "過去問", note: "不動産登記法", unit: "question", total: 100 }, plan);
  assert.equal(questions.linked, true);
  assert.equal(questions.current, 4);
  assert.equal(bookGaugeLabel(questions), "問4 / 問100");
  const missing = bookGauge(locked[0], null);
  assert.equal(missing.linked, false);
  assert.equal(missing.current, 0);
  const clamped = bookGauge({ title: "不動産登記法", unit: "page", total: 5 }, plan);
  assert.equal(clamped.current, 5);
});

test("books travel inside the progress sync document", () => {
  const payload = {
    demo: false,
    studied: true,
    books: [{ id: "b1", title: "ケータイ司法書士", note: "1", color: "#c0392b", image: "" }]
  };
  const doc = encodeDoc("state", payload, 50, false);
  const decoded = decodeDoc(doc);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.payload.books[0].title, "ケータイ司法書士");
  assert.equal(isUntouchedDemo(payload), false);
  assert.equal(doc.kind, "state");
});
