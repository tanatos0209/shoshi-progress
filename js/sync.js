"use strict";

/* Cloud sync for the progress PWA.
   Local storage stays the source of truth. Firestore mirrors it when a
   Google user is signed in. Last write wins by client timestamp.
   Paths (same Firebase project as the ox app):
     users/{uid}/progress/state
     users/{uid}/progress/ai-text
     users/{uid}/progress/ai-workbook
   shoshi-ox should use users/{uid}/ox/... with the same rules. */

const SYNC_SCHEMA = 1;
const SYNC_APP = "shoshi-progress";
const SYNC_COLLECTION = "progress";
const SIBLING_COLLECTION = "ox";
const SYNC_DOCS = ["state", "ai-text", "ai-workbook"];
const MAX_INLINE_BYTES = 800000;
const META_KEY = "shoshi-progress-sync-v1";
const FIREBASE_VERSION = "12.4.0";
const PLACEHOLDER = /^(your[_-]|todo|replace|xxx+|changeme|paste|insert)/i;

const STATUS_TEXT = {
  unconfigured: { chip: "未設定", status: "Firebase未設定（この端末のみ）" },
  signedOut: { chip: "ログイン", status: "未ログイン" },
  signingIn: { chip: "ログイン中", status: "ログイン中…" },
  offline: { chip: "オフライン", status: "オフライン（この端末に保存）" },
  syncing: { chip: "同期中", status: "同期中…" },
  pending: { chip: "同期待ち", status: "同期待ち（接続後に送信します）" },
  editing: { chip: "編集中", status: "AIサポートは未保存です" },
  held: { chip: "確認", status: "別アカウントの記録が残っています" },
  error: { chip: "同期失敗", status: "同期できませんでした" },
  ok: { chip: "同期済み", status: "同期済み" }
};

function userDocPath(uid, docId) {
  return "users/" + uid + "/" + SYNC_COLLECTION + "/" + docId;
}

function slotDocPath(uid, docId, index) {
  return userDocPath(uid, docId) + "/slots/" + slotId(index);
}

function slotId(index) {
  const n = Math.max(0, Math.round(Number(index) || 0));
  return (n < 10 ? "0" : "") + n;
}

function configReady(cfg) {
  if (!cfg || typeof cfg !== "object") return false;
  const apiKey = String(cfg.apiKey || "").trim();
  const authDomain = String(cfg.authDomain || "").trim();
  const projectId = String(cfg.projectId || "").trim();
  const appId = String(cfg.appId || "").trim();
  if (apiKey.length < 20 || PLACEHOLDER.test(apiKey)) return false;
  if (authDomain.indexOf(".") < 0 || PLACEHOLDER.test(authDomain)) return false;
  if (projectId.length < 4 || PLACEHOLDER.test(projectId)) return false;
  if (appId.indexOf(":") < 0 || PLACEHOLDER.test(appId)) return false;
  return true;
}

function isUntouchedDemo(data) {
  if (!data || typeof data !== "object") return true;
  if (data.demo !== true) return false;
  if (data.studied === true) return false;
  if (data.activeSession) return false;
  return true;
}

function isEmptyAiSlots(slots) {
  if (!Array.isArray(slots) || slots.length === 0) return true;
  return slots.every((slot) => {
    if (!slot || typeof slot !== "object") return true;
    const image = typeof slot.image === "string" ? slot.image : "";
    const text = typeof slot.text === "string" ? slot.text : "";
    return image === "" && text.trim() === "";
  });
}

function decideSync(input) {
  const localStamp = Number(input.localStamp) || 0;
  const remoteStamp = Number(input.remoteStamp) || 0;
  const remoteExists = !!input.remoteExists;
  if (input.accountSwitch) return remoteExists ? "remote" : "none";
  if (!remoteExists) return localStamp > 0 ? "local" : "none";
  if (input.localUntouched && localStamp <= 0) return "remote";
  if (remoteStamp > localStamp) return "remote";
  if (localStamp > remoteStamp) return "local";
  return "none";
}

function resolveDecision(decision, localDirty) {
  if (localDirty && decision === "remote") return "local";
  return decision;
}

function noteLocalChange(meta, kind, payload, now) {
  const base = meta && typeof meta === "object" ? meta : {};
  const hash = hashString(JSON.stringify(payload));
  const prev = base[kind] && typeof base[kind] === "object" ? base[kind] : { stamp: 0, hash: "" };
  if (prev.hash === hash) return { meta: base, push: false, stamp: Number(prev.stamp) || 0 };
  let stamp = now;
  if (kind === "state" && isUntouchedDemo(payload)) {
    stamp = prev.stamp > 0 ? now : 0;
  } else if (kind !== "state" && isEmptyAiSlots(payload) && !(prev.stamp > 0)) {
    stamp = 0;
  }
  const next = {};
  Object.keys(base).forEach((key) => { next[key] = base[key]; });
  next[kind] = { stamp: stamp, hash: hash };
  return { meta: next, push: stamp > 0, stamp: stamp };
}

function shouldSplit(byteLength) {
  return Number(byteLength) > MAX_INLINE_BYTES;
}

function utf8Bytes(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  return unescape(encodeURIComponent(text)).length;
}

function hashString(text) {
  const value = String(text);
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function remoteReadable(data) {
  if (!data || typeof data !== "object") return false;
  const schema = data.schema == null ? 1 : Number(data.schema);
  return schema <= SYNC_SCHEMA;
}

function encodeDoc(kind, payload, stamp, split) {
  const doc = {
    schema: SYNC_SCHEMA,
    app: SYNC_APP,
    kind: kind,
    updatedAt: stamp,
    encoding: "json",
    split: !!split
  };
  if (split) doc.slotCount = Array.isArray(payload) ? payload.length : 0;
  else doc.body = JSON.stringify(payload);
  return doc;
}

function decodeDoc(data) {
  if (!remoteReadable(data)) return { ok: false, reason: "schema" };
  const updatedAt = Number(data.updatedAt) || 0;
  if (data.split) return { ok: true, split: true, updatedAt: updatedAt };
  if (data.encoding !== "json" || typeof data.body !== "string") return { ok: false, reason: "body" };
  try {
    return { ok: true, split: false, updatedAt: updatedAt, payload: JSON.parse(data.body) };
  } catch (err) {
    return { ok: false, reason: "json" };
  }
}

function phaseFor(input) {
  const state = input || {};
  if (!state.configured) return "unconfigured";
  if (state.signingIn) return "signingIn";
  if (!state.signedIn) return "signedOut";
  if (state.held) return "held";
  if (state.editing) return "editing";
  if (state.offline) return "offline";
  if (state.syncing) return "syncing";
  if (state.pending) return "pending";
  if (state.error) return "error";
  return "ok";
}

function formatSyncClock(ms) {
  const value = Number(ms);
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(new Date(value));
  } catch (err) {
    return "";
  }
}

function cloudErrorText(code, fallback) {
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "ログインをキャンセルしました";
    case "auth/unauthorized-domain":
      return "このドメインは Firebase の承認済みドメインにありません";
    case "auth/network-request-failed":
      return "オフラインのためログインできません";
    case "auth/popup-blocked":
    case "auth/operation-not-supported-in-this-environment":
      return "ログイン画面を開けませんでした";
    case "permission-denied":
      return "Firestore のルールで拒否されました";
    case "unavailable":
      return "サーバーに接続できません";
    case "sdk":
      return "同期の読み込みに失敗しました";
    case "schema":
      return "クラウドの形式が新しいため、同期を止めています";
    default:
      return fallback || "同期できませんでした";
  }
}

function readStoredMeta() {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = JSON.parse(localStorage.getItem(META_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch (err) {
    return {};
  }
}

function writeStoredMeta(value) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(META_KEY, JSON.stringify(value));
  } catch (err) {
    /* private mode */
  }
}

if (typeof window !== "undefined") {
  const PUSH_DELAY = { state: 12000, "ai-text": 800, "ai-workbook": 800 };
  let bridge = null;
  let cfg = {};
  let meta = readStoredMeta();
  let user = null;
  let db = null;
  let auth = null;
  let fs = null;
  let clientPromise = null;
  let signingIn = false;
  let syncing = 0;
  let lastError = null;
  let accountHold = false;
  let lastSyncedAt = 0;
  const timers = {};
  const pushing = {};
  const rerun = {};
  const seenSnapshot = {};
  const remoteExists = {};
  const remoteStamp = {};
  const remoteBlocked = {};
  const remoteSplit = {};
  let unsubs = [];

  function $(id) { return document.getElementById(id); }

  function persistMeta() {
    writeStoredMeta(meta);
  }

  function scopeOf(kind) {
    return kind === "ai-workbook" ? "workbook" : "text";
  }

  function currentPayload(kind) {
    if (!bridge) return null;
    if (kind === "state") return bridge.getState();
    return bridge.getAi(scopeOf(kind));
  }

  function localStamp(kind) {
    return meta[kind] && Number(meta[kind].stamp) || 0;
  }

  function dirtyAi(kind) {
    if (!bridge || kind === "state" || !bridge.aiDirty) return false;
    return !!bridge.aiDirty(scopeOf(kind));
  }

  function accountMode(uid) {
    if (meta.uid && meta.uid !== uid) return "switch";
    if (!meta.uid) return "first";
    return "same";
  }

  function claimUid(uid) {
    if (meta.uid === uid) return;
    meta.uid = uid;
    persistMeta();
  }

  function remember(kind, stamp) {
    const payload = currentPayload(kind);
    let hash = "";
    try { hash = hashString(JSON.stringify(payload)); } catch (err) { hash = ""; }
    meta[kind] = { stamp: stamp, hash: hash };
    if (stamp > lastSyncedAt) lastSyncedAt = stamp;
    persistMeta();
  }

  function hasPendingLocal() {
    return SYNC_DOCS.some((kind) => {
      const stamp = localStamp(kind);
      if (!(stamp > 0)) return false;
      if (!seenSnapshot[kind]) return true;
      if (remoteBlocked[kind]) return false;
      return stamp > (remoteStamp[kind] || 0);
    });
  }

  function viewState() {
    const configured = configReady(cfg);
    return {
      configured: configured,
      signingIn: signingIn,
      signedIn: !!(user && user.uid),
      held: !!(user && accountHold),
      editing: !!(user && bridge && bridge.aiDirtyAny && bridge.aiDirtyAny()),
      offline: typeof navigator !== "undefined" && navigator.onLine === false,
      syncing: syncing > 0,
      pending: hasPendingLocal(),
      error: !!lastError
    };
  }

  function renderStatus() {
    const state = viewState();
    const phase = phaseFor(state);
    const copy = STATUS_TEXT[phase] || STATUS_TEXT.error;
    const chip = $("sync-chip");
    if (chip) {
      chip.textContent = copy.chip;
      chip.dataset.state = phase;
      chip.setAttribute("aria-label", "クラウド同期 " + copy.status);
    }
    const status = $("sync-status");
    if (status) {
      let line = copy.status;
      if (phase === "ok") {
        const clock = formatSyncClock(lastSyncedAt);
        if (clock) line = copy.status + " " + clock;
      }
      if (phase === "error" && lastError) line = cloudErrorText(lastError.code, copy.status);
      status.textContent = line;
    }
    const account = $("sync-account");
    if (account) {
      const label = user ? (user.displayName || user.email || "") : "";
      account.hidden = !label;
      account.textContent = label;
    }
    const detail = $("sync-detail");
    if (detail) {
      if (!state.configured) detail.textContent = "js/firebase-config.js にウェブアプリの設定を貼り付けると使えます。";
      else if (phase === "held") detail.textContent = "別の Google アカウントの記録がこの端末に残っています。クラウドが空なので、自動では送っていません。";
      else detail.textContent = "進捗、PCS、テキストと問題集のAIサポート、タイマー、設定を、同じGoogleアカウントの端末どうしで同期します。";
    }
    const signIn = $("sync-sign-in");
    const signOut = $("sync-sign-out");
    const now = $("sync-now");
    const claim = $("sync-claim");
    if (signIn) {
      signIn.hidden = state.signedIn;
      signIn.disabled = !state.configured || signingIn;
    }
    if (signOut) signOut.hidden = !state.signedIn;
    if (now) now.hidden = !state.signedIn || accountHold;
    if (claim) claim.hidden = !accountHold;
  }

  function toast(message) {
    if (bridge && bridge.toast) bridge.toast(message);
  }

  function noteLocal(kind, payload) {
    if (SYNC_DOCS.indexOf(kind) < 0) return;
    let result;
    try {
      result = noteLocalChange(meta, kind, payload, Date.now());
    } catch (err) {
      return;
    }
    if (result.meta !== meta) {
      meta = result.meta;
      persistMeta();
    }
    if (result.push && !accountHold) queuePush(kind);
    renderStatus();
  }

  function queuePush(kind, delay) {
    if (accountHold || remoteBlocked[kind]) return;
    if (timers[kind]) return;
    const wait = delay == null ? (PUSH_DELAY[kind] || 2000) : delay;
    timers[kind] = setTimeout(() => {
      timers[kind] = 0;
      pushKind(kind);
    }, wait);
  }

  function canPush(kind) {
    if (accountHold || remoteBlocked[kind]) return false;
    if (!db || !user || !fs || !seenSnapshot[kind]) return false;
    const stamp = localStamp(kind);
    if (!(stamp > 0)) return false;
    if (remoteExists[kind] && stamp <= (remoteStamp[kind] || 0)) return false;
    return true;
  }

  function pushKind(kind) {
    if (pushing[kind]) {
      rerun[kind] = true;
      return Promise.resolve();
    }
    if (!canPush(kind)) return Promise.resolve();
    pushing[kind] = true;
    const stamp = localStamp(kind);
    const payload = currentPayload(kind);
    syncing += 1;
    renderStatus();
    return writeKind(kind, payload, stamp).then(() => {
      lastError = null;
      remoteExists[kind] = true;
      if ((remoteStamp[kind] || 0) < stamp) remoteStamp[kind] = stamp;
      claimUid(user.uid);
      if (stamp > lastSyncedAt) lastSyncedAt = stamp;
    }).catch((err) => {
      lastError = err || { code: "unavailable" };
      if (!err || err.code !== "permission-denied") queuePush(kind, 15000);
    }).then(() => {
      pushing[kind] = false;
      syncing = Math.max(0, syncing - 1);
      renderStatus();
      if (rerun[kind]) {
        rerun[kind] = false;
        queuePush(kind, 800);
      }
    });
  }

  function writeKind(kind, payload, stamp) {
    const ref = fs.doc(db, "users", user.uid, SYNC_COLLECTION, kind);
    if (kind === "state") {
      return fs.setDoc(ref, encodeDoc(kind, payload, stamp, false));
    }
    const inline = encodeDoc(kind, payload, stamp, false);
    const split = shouldSplit(utf8Bytes(inline.body || ""));
    if (!split) {
      const batch = fs.writeBatch(db);
      if (remoteSplit[kind]) {
        return fs.getDocs(fs.collection(db, "users", user.uid, SYNC_COLLECTION, kind, "slots")).then((existing) => {
          existing.forEach((item) => batch.delete(item.ref));
          batch.set(ref, inline);
          return batch.commit();
        }).then(() => { remoteSplit[kind] = false; });
      }
      return fs.setDoc(ref, inline).then(() => { remoteSplit[kind] = false; });
    }
    const slots = Array.isArray(payload) ? payload : [];
    const batch = fs.writeBatch(db);
    batch.set(ref, encodeDoc(kind, slots, stamp, true));
    slots.forEach((slot, index) => {
      const slotRef = fs.doc(db, "users", user.uid, SYNC_COLLECTION, kind, "slots", slotId(index));
      batch.set(slotRef, {
        image: slot && typeof slot.image === "string" ? slot.image : "",
        text: slot && typeof slot.text === "string" ? slot.text : ""
      });
    });
    return batch.commit().then(() => { remoteSplit[kind] = true; });
  }

  function loadSplitSlots(kind) {
    return fs.getDocs(fs.collection(db, "users", user.uid, SYNC_COLLECTION, kind, "slots")).then((snap) => {
      const slots = [];
      snap.forEach((item) => {
        const index = Number(item.id);
        if (!isFinite(index) || index < 0 || index > 63) return;
        const data = item.data() || {};
        slots[index] = {
          image: typeof data.image === "string" ? data.image : "",
          text: typeof data.text === "string" ? data.text : ""
        };
      });
      const count = Math.max(20, slots.length);
      const filled = [];
      for (let i = 0; i < count; i += 1) filled.push(slots[i] || { image: "", text: "" });
      return filled;
    });
  }

  function applyRemote(kind, payload, stamp) {
    if (kind === "state") {
      if (bridge.applyState) bridge.applyState(payload);
    } else if (dirtyAi(kind)) {
      return;
    } else if (bridge.applyAi) {
      const applied = bridge.applyAi(scopeOf(kind), payload);
      if (applied === false) return;
    }
    remember(kind, stamp);
    remoteStamp[kind] = stamp;
    remoteExists[kind] = true;
  }

  function handleSnapshotData(kind, data, switched) {
    seenSnapshot[kind] = true;
    if (!data) {
      remoteExists[kind] = false;
      remoteStamp[kind] = 0;
      remoteBlocked[kind] = false;
      remoteSplit[kind] = false;
      if (!switched && localStamp(kind) > 0) queuePush(kind, 0);
      renderStatus();
      return Promise.resolve();
    }
    if (!remoteReadable(data)) {
      remoteExists[kind] = true;
      remoteBlocked[kind] = true;
      remoteStamp[kind] = Number.MAX_SAFE_INTEGER;
      lastError = { code: "schema" };
      renderStatus();
      return Promise.resolve();
    }
    const decoded = decodeDoc(data);
    if (!decoded.ok) {
      remoteExists[kind] = true;
      remoteBlocked[kind] = true;
      remoteStamp[kind] = Number.MAX_SAFE_INTEGER;
      lastError = { code: "schema" };
      renderStatus();
      return Promise.resolve();
    }
    remoteBlocked[kind] = false;
    remoteExists[kind] = true;
    remoteStamp[kind] = decoded.updatedAt;
    remoteSplit[kind] = !!decoded.split;
    if (decoded.updatedAt > lastSyncedAt) lastSyncedAt = decoded.updatedAt;
    if (kind !== "state" && dirtyAi(kind)) {
      renderStatus();
      return Promise.resolve();
    }
    const untouched = kind === "state" && isUntouchedDemo(currentPayload(kind));
    const decision = decideSync({
      localStamp: localStamp(kind),
      remoteStamp: decoded.updatedAt,
      remoteExists: true,
      localUntouched: untouched,
      accountSwitch: switched
    });
    if (decision === "remote") {
      const finish = (payload) => {
        applyRemote(kind, payload, decoded.updatedAt);
        renderStatus();
      };
      if (decoded.split) return loadSplitSlots(kind).then(finish);
      finish(decoded.payload);
      return Promise.resolve();
    }
    if (decision === "local") queuePush(kind, switched ? 0 : undefined);
    renderStatus();
    return Promise.resolve();
  }

  function reconcile(kind, switched) {
    const ref = fs.doc(db, "users", user.uid, SYNC_COLLECTION, kind);
    const read = fs.getDocFromServer(ref).catch(() => fs.getDoc(ref));
    return read.then((snap) => handleSnapshotData(kind, snap.exists() ? snap.data() : null, switched)).catch((err) => {
      lastError = err || { code: "unavailable" };
      seenSnapshot[kind] = true;
      renderStatus();
    });
  }

  function watch(kind) {
    const ref = fs.doc(db, "users", user.uid, SYNC_COLLECTION, kind);
    const unsub = fs.onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
      if (snap.metadata.hasPendingWrites) {
        renderStatus();
        return;
      }
      const switched = accountMode(user.uid) === "switch";
      handleSnapshotData(kind, snap.exists() ? snap.data() : null, switched);
    }, (err) => {
      lastError = err || { code: "unavailable" };
      renderStatus();
    });
    unsubs.push(unsub);
  }

  function clearListeners() {
    unsubs.forEach((fn) => { try { fn(); } catch (err) { /* already gone */ } });
    unsubs = [];
    SYNC_DOCS.forEach((kind) => {
      seenSnapshot[kind] = false;
      remoteExists[kind] = false;
      remoteStamp[kind] = 0;
      remoteBlocked[kind] = false;
      remoteSplit[kind] = false;
    });
  }

  function bindUser(next) {
    const same = user && next && user.uid === next.uid;
    user = next || null;
    if (!user) {
      clearListeners();
      accountHold = false;
      renderStatus();
      return;
    }
    if (same && unsubs.length) {
      renderStatus();
      return;
    }
    clearListeners();
    const switched = accountMode(user.uid) === "switch";
    accountHold = switched;
    syncing += 1;
    renderStatus();
    Promise.all(SYNC_DOCS.map((kind) => reconcile(kind, switched))).then(() => {
      if (!user) return;
      const mode = accountMode(user.uid);
      if (mode === "switch") {
        const fullyReplaced = SYNC_DOCS.every((kind) => remoteExists[kind] && !remoteBlocked[kind]);
        accountHold = !fullyReplaced;
        if (fullyReplaced) claimUid(user.uid);
      } else {
        accountHold = false;
        claimUid(user.uid);
      }
      SYNC_DOCS.forEach((kind) => watch(kind));
    }).catch((err) => {
      lastError = err || { code: "unavailable" };
    }).then(() => {
      syncing = Math.max(0, syncing - 1);
      renderStatus();
    });
  }

  function loadSdk() {
    const base = "https://www.gstatic.com/firebasejs/" + FIREBASE_VERSION + "/";
    return Promise.all([
      import(base + "firebase-app.js"),
      import(base + "firebase-auth.js"),
      import(base + "firebase-firestore.js")
    ]).then((mods) => {
      const appMod = mods[0];
      const authMod = mods[1];
      const firestoreMod = mods[2];
      const firebaseConfig = {
        apiKey: cfg.apiKey,
        authDomain: cfg.authDomain,
        projectId: cfg.projectId,
        appId: cfg.appId
      };
      if (cfg.storageBucket) firebaseConfig.storageBucket = cfg.storageBucket;
      if (cfg.messagingSenderId) firebaseConfig.messagingSenderId = cfg.messagingSenderId;
      const app = appMod.initializeApp(firebaseConfig);
      auth = authMod.getAuth(app);
      auth.languageCode = "ja";
      return authMod.setPersistence(auth, authMod.browserLocalPersistence).catch(() => {}).then(() => {
        try {
          db = firestoreMod.initializeFirestore(app, {
            localCache: firestoreMod.persistentLocalCache({
              tabManager: firestoreMod.persistentMultipleTabManager()
            })
          });
        } catch (err) {
          db = firestoreMod.getFirestore(app);
        }
        fs = {
          doc: firestoreMod.doc,
          getDoc: firestoreMod.getDoc,
          getDocFromServer: firestoreMod.getDocFromServer,
          getDocs: firestoreMod.getDocs,
          setDoc: firestoreMod.setDoc,
          collection: firestoreMod.collection,
          onSnapshot: firestoreMod.onSnapshot,
          writeBatch: firestoreMod.writeBatch
        };
        return authMod.getRedirectResult(auth).catch((err) => {
          lastError = err;
          toast(cloudErrorText(err && err.code, "ログインできませんでした"));
          return null;
        });
      }).then(() => {
        authMod.onAuthStateChanged(auth, bindUser);
        return { authMod: authMod };
      });
    });
  }

  function ensureClient() {
    if (!configReady(cfg)) return Promise.resolve(null);
    if (!clientPromise) {
      clientPromise = loadSdk().catch((err) => {
        clientPromise = null;
        lastError = { code: "sdk" };
        renderStatus();
        throw err;
      });
    }
    return clientPromise;
  }

  function signIn() {
    if (!configReady(cfg)) {
      toast("js/firebase-config.js に設定を入れてください");
      if (bridge && bridge.openSettings) bridge.openSettings();
      return;
    }
    signingIn = true;
    renderStatus();
    ensureClient().then((loaded) => {
      if (!loaded) return null;
      const provider = new loaded.authMod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      return loaded.authMod.signInWithPopup(auth, provider).catch((err) => {
        const code = err && err.code;
        if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment" || code === "auth/cancelled-popup-request") {
          return loaded.authMod.signInWithRedirect(auth, provider);
        }
        throw err;
      });
    }).catch((err) => {
      if (!err || err.code !== "auth/popup-closed-by-user") {
        toast(cloudErrorText(err && err.code, "ログインできませんでした"));
      } else {
        toast("ログインをキャンセルしました");
      }
    }).then(() => {
      signingIn = false;
      renderStatus();
    });
  }

  function signOutUser() {
    if (!auth || !fs) {
      user = null;
      renderStatus();
      return;
    }
    ensureClient().then((loaded) => loaded.authMod.signOut(auth)).catch(() => {
      toast("ログアウトできませんでした");
    });
  }

  function claimThisAccount() {
    if (!user) return;
    accountHold = false;
    claimUid(user.uid);
    SYNC_DOCS.forEach((kind) => {
      if (localStamp(kind) > 0) queuePush(kind, 0);
    });
    renderStatus();
    toast("この端末の記録を同期します");
  }

  function flushAll() {
    SYNC_DOCS.forEach((kind) => {
      if (timers[kind]) {
        clearTimeout(timers[kind]);
        timers[kind] = 0;
      }
      pushKind(kind);
    });
  }

  function recheck(kind) {
    if (!user || !fs || !db || SYNC_DOCS.indexOf(kind) < 0) return;
    const ref = fs.doc(db, "users", user.uid, SYNC_COLLECTION, kind);
    fs.getDoc(ref).then((snap) => {
      const switched = accountMode(user.uid) === "switch";
      return handleSnapshotData(kind, snap.exists() ? snap.data() : null, switched);
    }).catch(() => {});
  }

  function openSettingsFromChip() {
    if (bridge && bridge.openSettings) bridge.openSettings();
  }

  let bound = false;
  function bindUi() {
    if (bound || typeof document === "undefined") return;
    bound = true;
    const signInBtn = $("sync-sign-in");
    const signOutBtn = $("sync-sign-out");
    const nowBtn = $("sync-now");
    const claimBtn = $("sync-claim");
    const chip = $("sync-chip");
    if (signInBtn) signInBtn.addEventListener("click", signIn);
    if (signOutBtn) signOutBtn.addEventListener("click", signOutUser);
    if (nowBtn) nowBtn.addEventListener("click", flushAll);
    if (claimBtn) claimBtn.addEventListener("click", claimThisAccount);
    if (chip) {
      chip.addEventListener("click", () => {
        if (!configReady(cfg) || (user && user.uid)) openSettingsFromChip();
        else signIn();
      });
    }
    window.addEventListener("online", () => {
      lastError = null;
      renderStatus();
      if (configReady(cfg)) {
        ensureClient().then(() => { if (user) flushAll(); }).catch(() => {});
      }
    });
    window.addEventListener("offline", () => renderStatus());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushAll();
    });
    window.addEventListener("pagehide", flushAll);
  }

  function start(nextBridge) {
    bridge = nextBridge || bridge;
    cfg = window.SHOSHI_FIREBASE_CONFIG || {};
    meta = readStoredMeta();
    bindUi();
    if (bridge) {
      try { noteLocal("state", bridge.getState()); } catch (err) { /* ignore */ }
      try { noteLocal("ai-text", bridge.getAi("text")); } catch (err) { /* ignore */ }
      try { noteLocal("ai-workbook", bridge.getAi("workbook")); } catch (err) { /* ignore */ }
    }
    renderStatus();
    if (!configReady(cfg)) return;
    ensureClient().catch(() => {});
  }

  window.ShoshiSync = {
    noteLocal: noteLocal,
    start: start,
    flush: flushAll,
    recheck: recheck,
    userDocPath: userDocPath
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SYNC_SCHEMA: SYNC_SCHEMA,
    SYNC_APP: SYNC_APP,
    SYNC_COLLECTION: SYNC_COLLECTION,
    SIBLING_COLLECTION: SIBLING_COLLECTION,
    SYNC_DOCS: SYNC_DOCS,
    MAX_INLINE_BYTES: MAX_INLINE_BYTES,
    META_KEY: META_KEY,
    STATUS_TEXT: STATUS_TEXT,
    userDocPath: userDocPath,
    slotDocPath: slotDocPath,
    slotId: slotId,
    configReady: configReady,
    isUntouchedDemo: isUntouchedDemo,
    isEmptyAiSlots: isEmptyAiSlots,
    decideSync: decideSync,
    resolveDecision: resolveDecision,
    noteLocalChange: noteLocalChange,
    shouldSplit: shouldSplit,
    utf8Bytes: utf8Bytes,
    hashString: hashString,
    remoteReadable: remoteReadable,
    encodeDoc: encodeDoc,
    decodeDoc: decodeDoc,
    phaseFor: phaseFor,
    formatSyncClock: formatSyncClock,
    cloudErrorText: cloudErrorText
  };
}
