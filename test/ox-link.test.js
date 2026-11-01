"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.ProgressRules = require("../js/rules.js");
global.Pcs = require("../js/pcs.js");
const { oxFrameUrl, queueOpensOx, OX_URL, OX_QUEUE_URL, normalizeAiSlots } = require("../js/app.js");

test("daily queue opens ox with today then review", () => {
  assert.equal(queueOpensOx("guide", "ox"), true);
  assert.equal(oxFrameUrl(true), OX_QUEUE_URL);
  assert.equal(
    OX_QUEUE_URL,
    "https://tanatos0209.github.io/shoshi-ox/?from=progress&start=today&scope=review"
  );
  const url = new URL(oxFrameUrl(true));
  assert.equal(url.origin + url.pathname, "https://tanatos0209.github.io/shoshi-ox/");
  assert.deepEqual([...url.searchParams.keys()], ["from", "start", "scope"]);
  assert.equal(url.searchParams.get("from"), "progress");
  assert.equal(url.searchParams.get("start"), "today");
  assert.equal(url.searchParams.get("scope"), "review");
});

test("ai support stores exactly 20 image-and-text slots", () => {
  const slots = normalizeAiSlots([{ image: "data:image/jpeg;base64,aa", text: "メモ" }, null, { text: 4 }]);
  assert.equal(slots.length, 20);
  assert.equal(slots[0].image, "data:image/jpeg;base64,aa");
  assert.equal(slots[0].text, "メモ");
  assert.deepEqual(slots[1], { image: "", text: "" });
  assert.equal(slots[2].text, "");
  assert.equal(slots[19].text, "");
  assert.equal(normalizeAiSlots(null).length, 20);
});

test("home and other steps keep the bare ox home", () => {
  assert.equal(queueOpensOx("ox", "ox"), false);
  assert.equal(queueOpensOx("guide", "notes"), false);
  assert.equal(queueOpensOx("guide", "speed"), false);
  assert.equal(queueOpensOx("guide", "text"), false);
  assert.equal(queueOpensOx("notes", "ox"), false);
  assert.equal(oxFrameUrl(false), OX_URL);
  assert.equal(OX_URL, "https://tanatos0209.github.io/shoshi-ox/");
  assert.equal(new URL(oxFrameUrl(false)).search, "");
});
