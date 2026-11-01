"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.ProgressRules = require("../js/rules.js");
global.Pcs = require("../js/pcs.js");
const { oxFrameUrl, queueOpensOx, OX_URL, OX_QUEUE_URL } = require("../js/app.js");

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
