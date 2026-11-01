"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SYNC_SCHEMA,
  SYNC_APP,
  SYNC_COLLECTION,
  SIBLING_COLLECTION,
  SYNC_DOCS,
  MAX_INLINE_BYTES,
  STATUS_TEXT,
  userDocPath,
  slotDocPath,
  slotId,
  configReady,
  isUntouchedDemo,
  isEmptyAiSlots,
  decideSync,
  resolveDecision,
  noteLocalChange,
  shouldSplit,
  utf8Bytes,
  remoteReadable,
  encodeDoc,
  decodeDoc,
  phaseFor,
  formatSyncClock,
  cloudErrorText
} = require("../js/sync.js");

const validConfig = {
  apiKey: "test-api-key-not-a-real-secret-0001",
  authDomain: "example.firebaseapp.com",
  projectId: "shoshi-test",
  appId: "1:1:web:abc"
};

test("paths share one Firebase project with the ox app", () => {
  assert.equal(SYNC_COLLECTION, "progress");
  assert.equal(SIBLING_COLLECTION, "ox");
  assert.equal(SYNC_APP, "shoshi-progress");
  assert.deepEqual(SYNC_DOCS, ["state", "ai-text", "ai-workbook"]);
  assert.equal(userDocPath("uid1", "state"), "users/uid1/progress/state");
  assert.equal(userDocPath("uid1", "ai-text"), "users/uid1/progress/ai-text");
  assert.equal(userDocPath("uid1", "ai-workbook"), "users/uid1/progress/ai-workbook");
  assert.equal(slotDocPath("uid1", "ai-text", 3), "users/uid1/progress/ai-text/slots/03");
  assert.equal(slotId(0), "00");
  assert.equal(slotId(12), "12");
});

test("empty firebase config stays local-only", () => {
  assert.equal(configReady(null), false);
  assert.equal(configReady({}), false);
  assert.equal(configReady({
    apiKey: "",
    authDomain: "",
    projectId: "",
    appId: ""
  }), false);
  assert.equal(configReady({
    apiKey: "YOUR_API_KEY_paste_here_000",
    authDomain: "todo.firebaseapp.com",
    projectId: "replace-me",
    appId: "1:1:web:abc"
  }), false);
  assert.equal(configReady(validConfig), true);
});

test("untouched demo loses to any cloud record and does not upload", () => {
  const demo = { demo: true, studied: false, activeSession: null, log: {} };
  assert.equal(isUntouchedDemo(demo), true);
  assert.equal(isUntouchedDemo({ demo: false, studied: false }), false);
  assert.equal(isUntouchedDemo({ demo: true, studied: true }), false);
  assert.equal(isUntouchedDemo({ demo: true, studied: false, activeSession: { mode: "text" } }), false);
  const first = noteLocalChange({}, "state", demo, 1000);
  assert.equal(first.stamp, 0);
  assert.equal(first.push, false);
  assert.equal(decideSync({
    localStamp: 0,
    remoteStamp: 50,
    remoteExists: true,
    localUntouched: true
  }), "remote");
  assert.equal(decideSync({
    localStamp: 0,
    remoteStamp: 0,
    remoteExists: false,
    localUntouched: true
  }), "none");
});

test("real local progress uploads, and an explicit demo reset does too", () => {
  const real = { demo: false, studied: true, streak: 2 };
  const saved = noteLocalChange({}, "state", real, 1000);
  assert.equal(saved.push, true);
  assert.equal(saved.stamp, 1000);
  assert.equal(saved.meta.uid, undefined);
  const again = noteLocalChange(saved.meta, "state", real, 5000);
  assert.equal(again.push, false);
  assert.equal(again.stamp, 1000);
  const reset = noteLocalChange(saved.meta, "state", { demo: true, studied: false, activeSession: null }, 9000);
  assert.equal(reset.push, true);
  assert.equal(reset.stamp, 9000);
  assert.equal(decideSync({
    localStamp: 9000,
    remoteStamp: 1000,
    remoteExists: true,
    localUntouched: true
  }), "local");
});

test("last write wins unless another account already has cloud data", () => {
  assert.equal(decideSync({ localStamp: 2, remoteStamp: 1, remoteExists: true }), "local");
  assert.equal(decideSync({ localStamp: 1, remoteStamp: 2, remoteExists: true }), "remote");
  assert.equal(decideSync({ localStamp: 2, remoteStamp: 2, remoteExists: true }), "none");
  assert.equal(decideSync({ localStamp: 4, remoteStamp: 0, remoteExists: false }), "local");
  assert.equal(decideSync({
    localStamp: 9,
    remoteStamp: 1,
    remoteExists: true,
    accountSwitch: true
  }), "remote");
  assert.equal(decideSync({
    localStamp: 9,
    remoteStamp: 0,
    remoteExists: false,
    accountSwitch: true
  }), "none");
  assert.equal(resolveDecision("remote", true), "local");
  assert.equal(resolveDecision("remote", false), "remote");
});

test("empty ai slots stay local until the user saves something", () => {
  assert.equal(isEmptyAiSlots([]), true);
  assert.equal(isEmptyAiSlots([{ image: "", text: "  " }]), true);
  assert.equal(isEmptyAiSlots([{ image: "data:image/jpeg;base64,aa", text: "" }]), false);
  const empty = noteLocalChange({ uid: "user-a" }, "ai-text", [{ image: "", text: "" }], 1000);
  assert.equal(empty.push, false);
  assert.equal(empty.meta.uid, "user-a");
  const filled = noteLocalChange(empty.meta, "ai-text", [{ image: "data:image/jpeg;base64,aa", text: "メモ" }], 2000);
  assert.equal(filled.push, true);
  const cleared = noteLocalChange(filled.meta, "ai-workbook", [{ image: "", text: "" }], 3000);
  assert.equal(cleared.push, false);
  const clearedAfter = noteLocalChange(filled.meta, "ai-text", [{ image: "", text: "" }], 4000);
  assert.equal(clearedAfter.push, true);
});

test("documents store json text and split when the body is too large", () => {
  const session = { activeSession: { spans: [[10, 20], [30, 40]] }, studied: true };
  const doc = encodeDoc("state", session, 123, false);
  assert.equal(doc.schema, SYNC_SCHEMA);
  assert.equal(doc.app, SYNC_APP);
  assert.equal(doc.encoding, "json");
  assert.equal(doc.split, false);
  assert.equal(typeof doc.body, "string");
  const decoded = decodeDoc(doc);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.payload.activeSession.spans, [[10, 20], [30, 40]]);
  assert.equal(decoded.updatedAt, 123);
  const split = encodeDoc("ai-text", [{ image: "", text: "" }], 5, true);
  assert.equal(split.split, true);
  assert.equal(split.body, undefined);
  assert.equal(decodeDoc(split).split, true);
  assert.equal(remoteReadable({ schema: 1 }), true);
  assert.equal(remoteReadable({ schema: 2 }), false);
  assert.equal(decodeDoc({ schema: 2, encoding: "json", body: "{}" }).ok, false);
  assert.equal(shouldSplit(MAX_INLINE_BYTES), false);
  assert.equal(shouldSplit(MAX_INLINE_BYTES + 1), true);
  assert.equal(utf8Bytes("あ"), 3);
});

test("status copy stays in Japanese", () => {
  assert.equal(phaseFor({ configured: false }), "unconfigured");
  assert.equal(phaseFor({ configured: true, signingIn: true }), "signingIn");
  assert.equal(phaseFor({ configured: true, signedIn: false }), "signedOut");
  assert.equal(phaseFor({ configured: true, signedIn: true, held: true, offline: true }), "held");
  assert.equal(phaseFor({ configured: true, signedIn: true, editing: true }), "editing");
  assert.equal(phaseFor({ configured: true, signedIn: true, offline: true }), "offline");
  assert.equal(phaseFor({ configured: true, signedIn: true, syncing: true }), "syncing");
  assert.equal(phaseFor({ configured: true, signedIn: true, pending: true }), "pending");
  assert.equal(phaseFor({ configured: true, signedIn: true, error: true }), "error");
  assert.equal(phaseFor({ configured: true, signedIn: true }), "ok");
  assert.equal(STATUS_TEXT.unconfigured.chip, "未設定");
  assert.equal(STATUS_TEXT.unconfigured.status, "Firebase未設定（この端末のみ）");
  assert.equal(STATUS_TEXT.signedOut.chip, "ログイン");
  assert.equal(STATUS_TEXT.ok.chip, "同期済み");
  assert.equal(STATUS_TEXT.offline.status, "オフライン（この端末に保存）");
  assert.equal(formatSyncClock(Date.UTC(2026, 10, 1, 3, 4, 0)), "12:04");
  assert.equal(cloudErrorText("auth/unauthorized-domain"), "このドメインは Firebase の承認済みドメインにありません");
  assert.equal(cloudErrorText("permission-denied"), "Firestore のルールで拒否されました");
});
