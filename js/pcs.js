"use strict";

/*
 * Perfect Control daily plan.
 * Percents are an unweighted average of the kinds scheduled today
 * (テキストまとめ, 択一対策, スピードチェック). テキスト and 問題集 stay
 * on the list as 準備中 and do not enter the average.
 * Cloze lines are original drill prompts tagged with a source book.
 */
const Pcs = (function () {
  const BASE = { notesNew: 2, speedTopics: 1 };
  const SOURCES = {
    defaultId: "B",
    A: "合格ゾーンテキスト",
    B: "Vマジック"
  };
  const ROWS = [
    { id: "text", label: "テキスト", feeds: false },
    { id: "workbook", label: "問題集", feeds: false },
    { id: "notes", label: "テキストまとめ", feeds: true },
    { id: "ox", label: "択一対策", feeds: true },
    { id: "speed", label: "スピードチェック", feeds: true }
  ];

  const NOTES = [
    {
      id: "note-kenri",
      title: "権利能力",
      source: "B",
      parts: ["人の権利能力は、", { a: "出生" }, "に始まり、", { a: "死亡" }, "によって終わる。"]
    },
    {
      id: "note-ishi",
      title: "意思能力",
      source: "B",
      parts: ["意思能力を欠く者がした法律行為は、", { a: "無効" }, "である。"]
    },
    {
      id: "note-miseinen",
      title: "未成年者",
      source: "A",
      parts: ["未成年者が法定代理人の同意を得ないでした法律行為は、", { a: "取り消すことができる" }, "。"]
    },
    {
      id: "note-koken",
      title: "成年被後見人",
      source: "B",
      parts: ["成年被後見人の法律行為は、日用品の購入その他日常生活に関する行為を除き、", { a: "取り消すことができる" }, "。"]
    },
    {
      id: "note-saho",
      title: "心裡留保",
      source: "B",
      parts: ["心裡留保による意思表示は、原則として", { a: "有効" }, "である。相手方が悪意または有過失のときは", { a: "無効" }, "となる。"]
    },
    {
      id: "note-kyogi",
      title: "虚偽表示",
      source: "B",
      parts: ["相手方と通じてした虚偽の意思表示は、", { a: "無効" }, "である。善意の第三者には", { a: "対抗できない" }, "。"]
    }
  ];

  const SPEED_CHAPTERS = [
    {
      id: "ch1",
      title: "第1章 総則",
      topics: [
        {
          id: "cap",
          title: "自然人の能力",
          points: [
            ["権利能力は", { a: "出生" }, "に始まり、", { a: "死亡" }, "で終わる。"],
            ["意思能力を欠く法律行為は", { a: "無効" }, "である。"],
            ["制限行為能力者は、", { a: "未成年者" }, "・", { a: "成年被後見人" }, "・", { a: "被保佐人" }, "・", { a: "被補助人" }, "である。"]
          ],
          questions: [
            { id: "cap:1", prompt: "人の権利能力は、出生に始まる。", answer: true, explain: "出生に始まります。" },
            { id: "cap:2", prompt: "意思能力を欠く者がした法律行為は、取り消すことができる。", answer: false, explain: "取り消すのではなく、無効です。" },
            { id: "cap:3", prompt: "成年被後見人が日用品を買った行為は、取り消すことができる。", answer: false, explain: "日常生活に関する行為は、取り消しの対象外です。" }
          ]
        },
        {
          id: "miss",
          title: "失踪宣告",
          points: [
            ["普通失踪の期間は", { a: "7年" }, "、危難失踪の期間は", { a: "1年" }, "である。"]
          ],
          questions: [
            { id: "miss:1", prompt: "普通失踪の失踪期間は7年である。", answer: true, explain: "普通失踪は7年です。" },
            { id: "miss:2", prompt: "危難失踪の失踪期間は3年である。", answer: false, explain: "危難失踪は1年です。" }
          ]
        },
        {
          id: "sham",
          title: "虚偽表示",
          points: [
            ["相手方と通じた虚偽表示は", { a: "無効" }, "で、善意の第三者には", { a: "対抗できない" }, "。"]
          ],
          questions: [
            { id: "sham:1", prompt: "相手方と通じてした虚偽の意思表示は、無効である。", answer: true, explain: "通じた虚偽表示は無効です。" },
            { id: "sham:2", prompt: "虚偽表示による無効は、善意の第三者にも対抗できる。", answer: false, explain: "善意の第三者には対抗できません。" }
          ]
        }
      ]
    }
  ];

  function addDays(iso, days) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  }

  function sourceName(id) {
    if (id === "A") return SOURCES.A;
    return SOURCES.B;
  }

  function noteById(id) {
    return NOTES.find((topic) => topic.id === id) || null;
  }

  function allSpeedTopics() {
    const list = [];
    SPEED_CHAPTERS.forEach((chapter) => {
      chapter.topics.forEach((topic) => list.push(topic));
    });
    return list;
  }

  function speedTopicById(id) {
    return allSpeedTopics().find((topic) => topic.id === id) || null;
  }

  function speedQuestionById(id) {
    let found = null;
    allSpeedTopics().forEach((topic) => {
      topic.questions.forEach((question) => {
        if (question.id === id) found = question;
      });
    });
    return found;
  }

  function topicIdOfQuestion(qid) {
    const index = String(qid).indexOf(":");
    return index === -1 ? "" : String(qid).slice(0, index);
  }

  function nudge(base, ratio) {
    const value = Math.max(1, Math.round(Number(base) || 1));
    if (ratio == null || !Number.isFinite(Number(ratio))) return value;
    if (Number(ratio) >= 1) return value + 1;
    if (Number(ratio) < 0.5) return Math.max(1, value - 1);
    return value;
  }

  function byPriority(srs) {
    return (a, b) => {
      const pa = (srs[a.id] && srs[a.id].priority) || 0;
      const pb = (srs[b.id] && srs[b.id].priority) || 0;
      if (pb !== pa) return pb - pa;
      const da = (srs[a.id] && srs[a.id].due) || "";
      const db = (srs[b.id] && srs[b.id].due) || "";
      if (da < db) return -1;
      if (da > db) return 1;
      return 0;
    };
  }

  function selectNotes(srs, today, newQuota) {
    const bucket = srs || {};
    const due = NOTES.filter((topic) => {
      const card = bucket[topic.id];
      return card && card.introduced && card.due && card.due <= today;
    }).sort(byPriority(bucket));
    const fresh = NOTES.filter((topic) => {
      const card = bucket[topic.id];
      return !card || !card.introduced;
    }).slice(0, Math.max(0, newQuota));
    const roles = {};
    due.forEach((topic) => { roles[topic.id] = "review"; });
    fresh.forEach((topic) => { roles[topic.id] = "new"; });
    return {
      ids: due.map((topic) => topic.id).concat(fresh.map((topic) => topic.id)),
      roles
    };
  }

  function selectSpeed(srs, today, topicQuota) {
    const bucket = srs || {};
    const topics = allSpeedTopics();
    const due = topics.filter((topic) => {
      const card = bucket[topic.id];
      return card && card.introduced && card.due && card.due <= today;
    }).sort(byPriority(bucket));
    const fresh = topics.filter((topic) => {
      const card = bucket[topic.id];
      return !card || !card.introduced;
    }).slice(0, Math.max(0, topicQuota));
    const chosen = due.concat(fresh);
    const questions = [];
    chosen.forEach((topic) => {
      topic.questions.forEach((question) => questions.push(question.id));
    });
    return { topics: chosen.map((topic) => topic.id), questions };
  }

  function ensureSrs(data) {
    if (!data.srs || typeof data.srs !== "object") data.srs = { notes: {}, speed: {} };
    if (!data.srs.notes || typeof data.srs.notes !== "object") data.srs.notes = {};
    if (!data.srs.speed || typeof data.srs.speed !== "object") data.srs.speed = {};
  }

  function ensureLog(data, today) {
    if (!data.log || typeof data.log !== "object") data.log = {};
    if (!data.log[today] || typeof data.log[today] !== "object") {
      data.log[today] = { minutes: 0, questions: 0, carryMs: 0 };
    }
    const rec = data.log[today];
    rec.questions = Math.max(0, Math.round(Number(rec.questions) || 0));
    return rec;
  }

  function planValid(pcs, today) {
    return !!(pcs && pcs.date === today && pcs.notes && Array.isArray(pcs.notes.ids) && pcs.ox && pcs.ox.target > 0 && pcs.speed && Array.isArray(pcs.speed.topics) && Array.isArray(pcs.speed.questions));
  }

  function yesterdayRatio(log, today, key) {
    const prev = log && log[addDays(today, -1)];
    if (!prev || !prev.pcs || !prev.pcs.started || !prev.pcs.completion) return null;
    const ratio = prev.pcs.completion[key];
    return ratio == null ? null : Number(ratio);
  }

  function ensurePlan(data, today) {
    ensureSrs(data);
    const rec = ensureLog(data, today);
    if (planValid(rec.pcs, today)) {
      rec.pcs.seen = {
        text: !!(rec.pcs.seen && rec.pcs.seen.text),
        workbook: !!(rec.pcs.seen && rec.pcs.seen.workbook)
      };
      rec.pcs.notes.done = Array.isArray(rec.pcs.notes.done) ? rec.pcs.notes.done : [];
      rec.pcs.notes.roles = rec.pcs.notes.roles || {};
      rec.pcs.speed.reviewed = Array.isArray(rec.pcs.speed.reviewed) ? rec.pcs.speed.reviewed : [];
      rec.pcs.speed.answered = Array.isArray(rec.pcs.speed.answered) ? rec.pcs.speed.answered : [];
      rec.pcs.started = rec.pcs.started === true;
      if (!rec.pcs.completion) rec.pcs.completion = stamp(rec.pcs, rec.questions);
      return rec.pcs;
    }
    const notesNew = nudge(BASE.notesNew, yesterdayRatio(data.log, today, "notes"));
    const speedTopics = nudge(BASE.speedTopics, yesterdayRatio(data.log, today, "speed"));
    const oxBase = Math.max(1, Math.round(Number(data.dailyQuestionGoal) || 20));
    const oxTarget = nudge(oxBase, yesterdayRatio(data.log, today, "ox"));
    const notesSel = selectNotes(data.srs.notes, today, notesNew);
    const speedSel = selectSpeed(data.srs.speed, today, speedTopics);
    rec.pcs = {
      date: today,
      started: false,
      seen: { text: false, workbook: false },
      notes: { ids: notesSel.ids, roles: notesSel.roles, done: [] },
      ox: { target: oxTarget },
      speed: {
        topics: speedSel.topics,
        questions: speedSel.questions,
        reviewed: [],
        answered: []
      },
      quotas: { notesNew, oxTarget, speedTopics },
      completion: {}
    };
    rec.pcs.completion = stamp(rec.pcs, rec.questions);
    return rec.pcs;
  }

  function unitRatio(done, target) {
    if (!(target > 0)) return null;
    return done / target;
  }

  function stamp(plan, questions) {
    const speedTarget = plan.speed.topics.length + plan.speed.questions.length;
    const speedDone = plan.speed.reviewed.length + plan.speed.answered.length;
    plan.completion = {
      notes: unitRatio(plan.notes.done.length, plan.notes.ids.length),
      ox: unitRatio(Math.max(0, Math.round(Number(questions) || 0)), plan.ox.target),
      speed: unitRatio(speedDone, speedTarget)
    };
    return plan.completion;
  }

  function percent(done, target) {
    if (!(target > 0)) return null;
    return Math.max(0, Math.min(100, (done / target) * 100));
  }

  function progress(plan, questions) {
    const oxDone = Math.max(0, Math.round(Number(questions) || 0));
    const parts = [];
    function push(id, done, target) {
      const value = percent(done, target);
      if (value == null) return;
      parts.push({ id, done, target, percent: value });
    }
    push("notes", plan.notes.done.length, plan.notes.ids.length);
    push("ox", oxDone, plan.ox.target);
    push("speed", plan.speed.reviewed.length + plan.speed.answered.length, plan.speed.topics.length + plan.speed.questions.length);
    const overall = parts.length ? Math.round(parts.reduce((sum, part) => sum + part.percent, 0) / parts.length) : 0;
    const rows = ROWS.map((row) => {
      const part = parts.find((item) => item.id === row.id);
      return {
        id: row.id,
        label: row.label,
        feeds: row.feeds,
        percent: part ? Math.round(part.percent) : 0
      };
    });
    return { overall, rows, parts };
  }

  function taskList(plan, questions) {
    const model = progress(plan, questions);
    const oxDone = Math.max(0, Math.round(Number(questions) || 0));
    let currentSet = false;
    return ROWS.map((row) => {
      let status = "";
      let finished = false;
      let done = 0;
      let target = 0;
      if (!row.feeds) {
        finished = !!(plan.seen && plan.seen[row.id]);
        status = finished ? "スキップ済み" : "準備中";
      } else if (row.id === "notes") {
        done = plan.notes.done.length;
        target = plan.notes.ids.length;
        finished = target > 0 && done >= target;
        status = target > 0 ? done + "/" + target : "予定なし";
        if (target === 0) finished = true;
      } else if (row.id === "ox") {
        done = oxDone;
        target = plan.ox.target;
        finished = target > 0 && done >= target;
        status = done + "/" + target;
      } else {
        done = plan.speed.reviewed.length + plan.speed.answered.length;
        target = plan.speed.topics.length + plan.speed.questions.length;
        finished = target > 0 ? done >= target : true;
        status = target > 0 ? done + "/" + target : "予定なし";
      }
      const percentRow = model.rows.find((item) => item.id === row.id);
      const item = {
        id: row.id,
        label: row.label,
        feeds: row.feeds,
        status,
        done,
        target,
        percent: percentRow ? percentRow.percent : 0,
        finished,
        current: false
      };
      if (!currentSet && !finished) {
        item.current = true;
        currentSet = true;
      }
      return item;
    });
  }

  function nextStep(plan, questions) {
    if (!plan.seen || !plan.seen.text) return { kind: "text", placeholder: true };
    if (!plan.seen.workbook) return { kind: "workbook", placeholder: true };
    const noteId = plan.notes.ids.find((id) => plan.notes.done.indexOf(id) === -1);
    if (noteId) return { kind: "notes", id: noteId, role: plan.notes.roles[noteId] || "new" };
    const oxDone = Math.max(0, Math.round(Number(questions) || 0));
    if (plan.ox.target > 0 && oxDone < plan.ox.target) {
      return { kind: "ox", done: oxDone, target: plan.ox.target };
    }
    const topics = plan.speed.topics;
    for (let i = 0; i < topics.length; i += 1) {
      const topicId = topics[i];
      if (plan.speed.reviewed.indexOf(topicId) === -1) {
        return { kind: "speed", type: "topic", id: topicId };
      }
      const pending = plan.speed.questions.find((qid) => topicIdOfQuestion(qid) === topicId && plan.speed.answered.indexOf(qid) === -1);
      if (pending) return { kind: "speed", type: "question", id: pending, topicId };
    }
    return null;
  }

  function stepLabel(step) {
    const index = ROWS.findIndex((row) => row.id === step.kind);
    const row = ROWS[index];
    return (index + 1) + "/5 " + (row ? row.label : "");
  }

  function hasResume(plan, questions) {
    if (plan.seen && (plan.seen.text || plan.seen.workbook)) return true;
    if (plan.notes.done.length > 0) return true;
    if (Math.round(Number(questions) || 0) > 0) return true;
    if (plan.speed.reviewed.length || plan.speed.answered.length) return true;
    return false;
  }

  function rateTopic(bucket, id, result, today) {
    const prev = bucket[id] || {};
    if (prev.lastDay === today) return bucket;
    const unknown = result === "unknown";
    const next = {
      introduced: prev.introduced || today,
      lastResult: unknown ? "unknown" : "known",
      lastDay: today,
      interval: 0,
      priority: 0,
      due: ""
    };
    if (unknown) {
      next.interval = 0;
      next.due = addDays(today, 1);
      next.priority = Math.min(99, (prev.priority || 0) + 1);
    } else {
      const interval = prev.interval > 0 ? Math.min(60, prev.interval * 2) : 1;
      next.interval = interval;
      next.due = addDays(today, interval);
      next.priority = 0;
    }
    return Object.assign({}, bucket, { [id]: next });
  }

  function passPlaceholder(data, today, kind) {
    if (kind !== "text" && kind !== "workbook") return { changed: false };
    const plan = ensurePlan(data, today);
    if (plan.seen[kind]) return { changed: false, progress: progress(plan, ensureLog(data, today).questions) };
    plan.seen[kind] = true;
    return { changed: true, progress: progress(plan, ensureLog(data, today).questions) };
  }

  function completeNote(data, today, id, result) {
    ensureSrs(data);
    const plan = ensurePlan(data, today);
    const rec = ensureLog(data, today);
    if (plan.notes.ids.indexOf(id) === -1 || plan.notes.done.indexOf(id) !== -1) {
      return { changed: false, progress: progress(plan, rec.questions) };
    }
    data.srs.notes = rateTopic(data.srs.notes, id, result, today);
    plan.notes.done.push(id);
    plan.started = true;
    stamp(plan, rec.questions);
    return { changed: true, progress: progress(plan, rec.questions) };
  }

  function completeOxOne(data, today) {
    const plan = ensurePlan(data, today);
    const rec = ensureLog(data, today);
    if (rec.questions >= plan.ox.target) {
      return { changed: false, progress: progress(plan, rec.questions) };
    }
    rec.questions += 1;
    plan.started = true;
    stamp(plan, rec.questions);
    return { changed: true, progress: progress(plan, rec.questions) };
  }

  function reviewSpeedTopic(data, today, id, result) {
    ensureSrs(data);
    const plan = ensurePlan(data, today);
    const rec = ensureLog(data, today);
    data.srs.speed = rateTopic(data.srs.speed, id, result, today);
    if (plan.speed.topics.indexOf(id) === -1 || plan.speed.reviewed.indexOf(id) !== -1) {
      return { changed: false, progress: progress(plan, rec.questions) };
    }
    plan.speed.reviewed.push(id);
    plan.started = true;
    stamp(plan, rec.questions);
    return { changed: true, progress: progress(plan, rec.questions) };
  }

  function answerSpeed(data, today, questionId) {
    const plan = ensurePlan(data, today);
    const rec = ensureLog(data, today);
    if (plan.speed.questions.indexOf(questionId) === -1 || plan.speed.answered.indexOf(questionId) !== -1) {
      return { changed: false, progress: progress(plan, rec.questions) };
    }
    plan.speed.answered.push(questionId);
    plan.started = true;
    stamp(plan, rec.questions);
    return { changed: true, progress: progress(plan, rec.questions) };
  }

  return {
    BASE,
    SOURCES,
    ROWS,
    NOTES,
    SPEED_CHAPTERS,
    addDays,
    sourceName,
    noteById,
    speedTopicById,
    speedQuestionById,
    topicIdOfQuestion,
    nudge,
    selectNotes,
    selectSpeed,
    ensurePlan,
    progress,
    taskList,
    nextStep,
    stepLabel,
    hasResume,
    passPlaceholder,
    completeNote,
    completeOxOne,
    reviewSpeedTopic,
    answerSpeed
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = Pcs;
}
