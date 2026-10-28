/* Smart Scratchpad — runs entirely on your phone. Items are saved in this browser's storage.
   One ordered task list: new notes go on top, repeats are merged and moved up, and tasks that sink
   below the visible rows come back to the top after a few untouched days.
   Sorting uses Google's Gemini API with your own free key (Settings) and falls back to built-in rules. */
(() => {
"use strict";

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad2 = n => String(n).padStart(2, "0");
const dkey = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const todayKey = () => dkey(new Date());
const parseKey = k => { const [y,m,d] = k.split("-").map(Number); return new Date(y, m-1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate()+n); return dkey(d); };
const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 864e5);
const daysAgo = ms => Math.floor((Date.now() - ms) / 864e5);
const WD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const ord = n => n + (n%10===1&&n!==11?"st":n%10===2&&n!==12?"nd":n%10===3&&n!==13?"rd":"th");
const newId = () => "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtTime = t => { const [h,m] = t.split(":").map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"}); };
const fmtWhen = ms => { const d = new Date(ms); const diff = daysBetween(todayKey(), dkey(d)); const day = diff===0?"Today":diff===1?"Tomorrow":diff<7?WD[d.getDay()]:d.toLocaleDateString([], {day:"numeric",month:"short"}); return day + " " + d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"}); };
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const lsDel = k => { try { localStorage.removeItem(k); } catch {} };
const plain = o => JSON.parse(JSON.stringify(o));

function nextDue(r, after) {
  const every = Math.max(1, r.every || 1);
  if (r.unit === "week") {
    if (r.days && r.days.length) { for (let i = 1; i <= 7*every + 7; i++) { const k = addDays(after, i); if (r.days.includes(parseKey(k).getDay())) return k; } }
    return addDays(after, 7*every);
  }
  if (r.unit === "month") {
    const d = parseKey(after), dom = r.dom || d.getDate();
    const t = new Date(d.getFullYear(), d.getMonth()+every, 1);
    t.setDate(Math.min(dom, new Date(t.getFullYear(), t.getMonth()+1, 0).getDate()));
    return dkey(t);
  }
  return addDays(after, every);
}
function firstDue(r, tk) {
  if (r.unit === "week" && r.days && r.days.length) return r.days.includes(parseKey(tk).getDay()) ? tk : nextDue(r, tk);
  if (r.unit === "month" && r.dom) {
    const d = parseKey(tk);
    if (r.dom >= d.getDate()) return dkey(new Date(d.getFullYear(), d.getMonth(), Math.min(r.dom, new Date(d.getFullYear(), d.getMonth()+1, 0).getDate())));
    return nextDue(r, tk);
  }
  return tk;
}
function recurLabel(r) {
  const e = r.every || 1;
  if (r.unit === "day") return e === 1 ? "Daily" : `Every ${e} days`;
  if (r.unit === "week") {
    if (r.days && r.days.length === 5 && [1,2,3,4,5].every(x => r.days.includes(x))) return "Weekdays";
    if (r.days && r.days.length) return "Every " + r.days.map(d => WD[d]).join(", ");
    return e === 1 ? "Weekly" : `Every ${e} weeks`;
  }
  if (r.unit === "month") return "Monthly" + (r.dom ? " · " + ord(r.dom) : "");
  return "Repeats";
}
function fmtDue(it) {
  if (!it.due) return null;
  const diff = daysBetween(todayKey(), it.due);
  let s = diff < -1 ? `${-diff}d overdue` : diff === -1 ? "Yesterday" : diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff < 7 ? WD[parseKey(it.due).getDay()] : parseKey(it.due).toLocaleDateString([], {day:"numeric", month:"short"});
  if (it.time) s += " " + fmtTime(it.time);
  return { s, cls: diff < 0 ? "over" : diff === 0 ? "today" : "" };
}

/* ---------- preferences ---------- */
const P = { rows: 7, days: 3, perDay: 2, nav: "shop" };
try { Object.assign(P, JSON.parse(lsGet("sp.prefs") || "{}")); } catch {}
const savePrefs = () => lsSet("sp.prefs", JSON.stringify(P));

/* ---------- state + storage (this phone only) ---------- */
const DK = "sp.data.v1";
const S = { items: new Map(), meta: { lastBackup: null, dailyRun: null, suggest: [], notDup: [] } };
try {
  const c = JSON.parse(lsGet(DK) || "null");
  if (c && Array.isArray(c.items)) { c.items.forEach(it => it && it.id && S.items.set(it.id, it)); if (c.meta) S.meta = { ...S.meta, ...c.meta }; }
} catch {}
let saveWarned = false;
function persist() {
  const ok = lsSet(DK, JSON.stringify({ items: [...S.items.values()], meta: S.meta }));
  if (!ok && !saveWarned) { saveWarned = true; toast("Couldn't save on this phone. Storage may be full or blocked."); }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});

/* Where an item lives. "queue" is the main task list. */
function bucket(it, now = Date.now(), tk = todayKey()) {
  if (it.done) return "done";
  if (it.snoozeUntil && it.snoozeUntil > now) return "snoozed";
  if (it.recur) return it.due && it.due <= tk && it.lastDone !== tk ? "queue" : "routine";
  if (it.kind === "shop") return "shop";
  if (it.kind === "idea") return "note";
  if (it.kind === "link") return "link";
  return "queue";
}
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (b.created || 0) - (a.created || 0);
const queue = () => [...S.items.values()].filter(x => bucket(x) === "queue").sort(byOrder);
function topOrder() { let m = 0; for (const it of S.items.values()) if (typeof it.order === "number" && it.order < m) m = it.order; return m - 1; }
function bottomOrder() { let m = 0; for (const it of S.items.values()) if (typeof it.order === "number" && it.order > m) m = it.order; return m + 1; }
const isBlocked = it => { if (it.waitingOn) return true; const b = it.blockedBy && S.items.get(it.blockedBy); return !!(b && !b.done); };

/* ---------- mutations ---------- */
let toastLabel = "Undo";
function commit(list, msg, undoable, prevOverride) {
  const prev = list.map(x => (prevOverride && prevOverride[x.id]) || (S.items.has(x.id) ? plain(S.items.get(x.id)) : null));
  const ids = list.map(x => x.id);
  list.forEach(x => { if (x._delete) S.items.delete(x.id); else S.items.set(x.id, x); });
  persist(); render();
  if (msg) toast(msg, undoable ? () => {
    ids.forEach((id, i) => { const p = prev[i]; if (p) S.items.set(id, p); else S.items.delete(id); });
    persist(); render();
  } : null);
}
function complete(id) {
  const it = S.items.get(id); if (!it || it.pending || it.done) return;
  const now = Date.now(), tk = todayKey();
  if (it.recur) { const nu = { ...it, lastDone: tk, due: nextDue(it.recur, tk), touched: now }; commit([nu], `Done for today · next ${fmtDue(nu).s}`, true); return; }
  const changes = [{ ...it, done: now, touched: now }];
  const deps = [...S.items.values()].filter(x => !x.done && x.blockedBy === id);
  let top = topOrder();
  deps.forEach(d => changes.push({ ...d, order: top--, touched: now }));
  let msg = it.kind === "shop" ? "Checked off" : it.kind === "idea" ? "Archived" : "Done";
  if (deps.length) msg += ` · “${deps[0].text}” moved to the top`;
  commit(changes, msg, true);
}
function skipRoutine(id) {
  const it = S.items.get(id); if (!it || !it.recur) return;
  const tk = todayKey(); const nu = { ...it, due: nextDue(it.recur, it.due && it.due > tk ? it.due : tk), touched: Date.now() };
  commit([nu], `Skipped · next ${fmtDue(nu).s}`, true);
}
function snooze(id, until) {
  const it = S.items.get(id); if (!it) return;
  const now = Date.now();
  if (until === "bottom") commit([{ ...it, order: bottomOrder(), snoozeUntil: null, touched: now }], "Moved to the bottom", true);
  else commit([{ ...it, snoozeUntil: until, touched: now }], `Snoozed until ${fmtWhen(until)}`, true);
}
function del(id) { if (S.items.has(id)) commit([{ id, _delete: true }], "Deleted", true); }
function moveTop(id, msg = "Moved to the top") { const it = S.items.get(id); if (it) commit([{ ...it, order: topOrder(), touched: Date.now() }], msg, true); }

/* Daily upkeep: snoozed tasks wake to the top; once a day, due tasks and old tasks
   sitting below the visible rows come back to the top. */
function maintain() {
  const now = Date.now(), tk = todayKey();
  const changes = new Map(); let top = topOrder(); let backCount = 0;
  const put = (it, why, age) => changes.set(it.id, { ...(changes.get(it.id) || it), order: top--, surf: { why, at: now, age: age || 0 } });
  for (const it of S.items.values()) {
    if (!it.done && it.snoozeUntil && it.snoozeUntil <= now) { put({ ...it, snoozeUntil: null }, "snooze"); }
  }
  if (S.meta.dailyRun !== tk) {
    const q = queue();
    q.filter(it => it.due && it.due <= tk && !(it.surf && it.surf.why === "due" && dkey(new Date(it.surf.at)) === tk)).forEach(it => put(it, "due"));
    const lastSeen = it => Math.max(it.touched || 0, it.created || 0, (it.surf && it.surf.at) || 0);
    const cutoff = now - P.days * 864e5;
    const below = q.slice(P.rows).filter(it => !changes.has(it.id) && !it.pending && !isBlocked(it) && lastSeen(it) < cutoff)
      .sort((a, b) => lastSeen(a) - lastSeen(b)).slice(0, P.perDay).reverse();
    below.forEach(it => { put(it, "back", daysAgo(it.created || it.touched || now)); backCount++; });
    S.meta = { ...S.meta, dailyRun: tk };
    // Prune old completed items.
    const old = now - 30*864e5;
    for (const it of S.items.values()) if (it.done && it.done < old) changes.set(it.id, { id: it.id, _delete: true });
  }
  if (!changes.size) { persist(); return; }
  [...changes.values()].forEach(x => { if (x._delete) S.items.delete(x.id); else S.items.set(x.id, x); });
  persist(); render();
  if (backCount) toast(backCount === 1 ? "An older task came back to the top" : `${backCount} older tasks came back to the top`);
}

/* ---------- parsing: shared shapes ---------- */
const KINDS = ["task","shop","idea","link"];
function normRecur(r) {
  if (!r || typeof r !== "object") return null;
  const unit = ["day","week","month"].includes(r.unit) ? r.unit : null; if (!unit) return null;
  const out = { every: Math.min(60, Math.max(1, parseInt(r.every) || 1)), unit };
  if (unit === "week" && Array.isArray(r.days)) { const d = [...new Set(r.days.map(Number).filter(x => Number.isInteger(x) && x >= 0 && x <= 6))].sort(); if (d.length) out.days = d; }
  if (unit === "month" && +r.dom >= 1 && +r.dom <= 31) out.dom = +r.dom;
  return out;
}
function normItem(x, i) {
  x = x && typeof x === "object" ? x : {};
  return {
    ref: String(x.ref || "n" + i), text: String(x.text || "").replace(/\s+/g, " ").trim().slice(0, 200),
    kind: KINDS.includes(x.kind) ? x.kind : "task",
    pri: [1,2,3].includes(+x.pri) ? +x.pri : 2,
    due: /^\d{4}-\d{2}-\d{2}$/.test(x.due || "") ? x.due : null,
    time: /^\d{2}:\d{2}$/.test(x.time || "") ? x.time : null,
    recur: normRecur(x.recur),
    blockedBy: x.blockedBy ? String(x.blockedBy) : null,
    waitingOn: x.waitingOn ? String(x.waitingOn).slice(0, 60) : null,
    url: /^https?:\/\/\S+$/i.test(x.url || "") ? String(x.url) : null,
    duplicateOf: x.duplicateOf ? String(x.duplicateOf) : null,
    similarTo: x.similarTo ? String(x.similarTo) : null,
  };
}
function normRes(r) {
  return { items: Array.isArray(r && r.items) ? r.items.map(normItem) : [], done: Array.isArray(r && r.done) ? r.done.map(String) : [] };
}

/* ---------- similarity (for merging and suggestions) ---------- */
const WDRX = /\b(sun|mon|tue|wed|thu|fri|sat)(?:day|s|nes|nesday|urday|sday|rsday|r)?\b/;
const STOP = new Set("the a an to for of and or on in at my me i need want have has with by from this that is be get do it some buy order".split(" "));
const toks = s => new Set(String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
function sim(a, b) {
  const A = toks(a), B = toks(b); if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach(w => B.has(w) && inter++);
  const j = inter / (A.size + B.size - inter);
  const contain = Math.min(A.size, B.size) >= 2 ? inter / Math.min(A.size, B.size) : 0;
  return Math.max(j, contain >= 1 ? 0.6 : 0);
}
const pairKey = (a, b) => [a, b].sort().join("|");
function closest(text, kind, skipId) {
  let best = null, bestS = 0;
  for (const it of S.items.values()) {
    if (it.done || it.id === skipId || it.pending) continue;
    if ((it.kind === "shop") !== (kind === "shop")) continue;
    const s = sim(text, it.text);
    if (s > bestS) { bestS = s; best = it.id; }
  }
  return { id: best, score: bestS };
}

/* ---------- parsing: built-in rules (no internet needed) ---------- */
function heuristic(raw, skipId) {
  const tk = todayKey(); const out = { items: [], done: [] };
  raw.split(/\n+/).map(s => s.trim()).filter(Boolean).forEach((line, i) => {
    const url = (line.match(/https?:\/\/\S+/i) || [])[0];
    if (url) {
      let t = line.replace(url, "").replace(/^[\s:–-]+|[\s:–-]+$/g, "");
      if (!t) { try { t = new URL(url).hostname.replace(/^www\./, ""); } catch { t = url; } }
      out.items.push({ ref: "n"+i, kind: "link", text: t, url }); return;
    }
    const sm = line.match(/^(?:buy|get|order|shopping|groceries|grocery)\b[:\s-]*(.+)$/i);
    const parts = s => s.split(/,|\band\b/i).map(x => x.trim()).filter(Boolean);
    const shortList = s => { const p = parts(s); return p.length >= 2 && p.every(x => x.split(/\s+/).length <= 3) && !/\b(call|email|mail|meet|send|pay|book|fix|check|ask|tell|reply|finish|write|go|visit)\b/i.test(s); };
    // "buy milk, eggs" / "milk, eggs, atta" (a bare list of short things) / "buy protein powder"
    const listSrc = sm ? sm[1] : shortList(line) && parts(line).length >= 3 ? line : null;
    if (listSrc && (parts(listSrc).length >= 2 || (sm && listSrc.split(/\s+/).length <= 4))) {
      parts(listSrc).forEach((s, j) => {
        const it = { ref: `n${i}_${j}`, kind: "shop", text: s[0].toUpperCase() + s.slice(1) };
        const c = closest(it.text, "shop", skipId); if (c.score >= 0.75) it.duplicateOf = c.id;
        out.items.push(it);
      });
      return;
    }
    if (/^(idea|thought|note)\b/i.test(line) || /^what if\b/i.test(line)) {
      out.items.push({ ref: "n"+i, kind: "idea", text: line.replace(/^(idea|thought|note)\b[:\s-]*/i, "") || line }); return;
    }
    const L = line.toLowerCase();
    const it = { ref: "n"+i, kind: "task", text: line, pri: 2 };
    const w = line.match(/\bwaiting (?:on|for) ([^,.;]{2,30}?)(?:\s+to\b|[,.;]|$)/i); if (w) it.waitingOn = w[1].trim();
    const ev = L.match(new RegExp("\\bevery " + WDRX.source));
    if (/\b(every ?day|daily|har roz|roz)\b/.test(L)) it.recur = { every: 1, unit: "day" };
    else if (/\b(monthly|every month)\b/.test(L)) { const dm = L.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/); it.recur = { every: 1, unit: "month", dom: dm ? +dm[1] : new Date().getDate() }; }
    else if (ev) it.recur = { every: 1, unit: "week", days: [WD.findIndex(d => d.toLowerCase() === ev[1])] };
    else if (/\b(weekly|every week)\b/.test(L)) it.recur = { every: 1, unit: "week", days: [new Date().getDay()] };
    if (!it.recur) {
      if (/\b(today|aaj|tonight)\b/.test(L)) it.due = tk;
      else if (/\b(tomorrow|tmrw|tmr|kal)\b/.test(L)) it.due = addDays(tk, 1);
      else {
        const wd = L.match(WDRX);
        if (wd) { const target = WD.findIndex(d => d.toLowerCase() === wd[1]); for (let k = 0; k < 7; k++) { const c = addDays(tk, k); if (parseKey(c).getDay() === target) { it.due = c; break; } } }
        const dm = L.match(/\bon (?:the )?(\d{1,2})(?:st|nd|rd|th)\b/);
        if (dm) { const n = +dm[1], d = new Date(); let t = new Date(d.getFullYear(), d.getMonth(), n); if (dkey(t) < tk) t = new Date(d.getFullYear(), d.getMonth()+1, n); it.due = dkey(t); }
      }
    }
    if (/\b(urgent|asap|important|imp)\b|!$/.test(L)) it.pri = 1;
    const clean = line.replace(new RegExp("\\b(?:by |on |this |next |every )?(?:" + WDRX.source.slice(2, -2) + ")\\b", "gi"), " ")
      .replace(/\b(?:by |on )?(?:today|tonight|tomorrow|tmrw|tmr|aaj|kal)\b/gi, " ")
      .replace(/\b(?:every ?day|daily|har roz|weekly|every week|monthly|every month)\b/gi, " ")
      .replace(/\bon (?:the )?\d{1,2}(?:st|nd|rd|th)\b/gi, " ")
      .replace(/\b(?:urgent|asap)\b|!+$/gi, " ")
      .replace(/\s+/g, " ").replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
    if (clean.length >= 3) it.text = clean[0].toUpperCase() + clean.slice(1);
    const c = closest(it.text, "task", skipId);
    if (c.score >= 0.75) it.duplicateOf = c.id; else if (c.score >= 0.45) it.similarTo = c.id;
    out.items.push(it);
  });
  return out;
}

/* ---------- parsing: Gemini ---------- */
function buildPrompt(raw, skipId) {
  const now = new Date(), tk = todayKey();
  const cal = Array.from({ length: 8 }, (_, i) => { const k = addDays(tk, i); return `${WD[parseKey(k).getDay()]} ${k}${i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : ""}`; }).join(", ");
  const open = [...S.items.values()].filter(x => !x.done && x.id !== skipId && !x.pending)
    .sort((a, b) => (b.touched || 0) - (a.touched || 0)).slice(0, 150)
    .map(x => `${x.id} | ${x.recur ? "routine" : x.kind} | ${x.text.slice(0, 90)}${x.due ? " | due " + x.due : ""}`).join("\n");
  return `You sort quick notes a person texts to themselves into their to-do app. Reply with ONLY a JSON object.

Now: ${pad2(now.getHours())}:${pad2(now.getMinutes())} local time. Calendar: ${cal}.

Their open items (id | type | text | due):
${open || "(none yet)"}

New note:
"""
${raw.slice(0, 4000)}
"""

Return {"items":[...],"done":[...]}. Each item:
{"ref":"n1","text":"short clean title","kind":"task|shop|idea|link","pri":1|2|3,"due":"YYYY-MM-DD" or null,"time":"HH:MM" or null,"recur":null or {"every":1,"unit":"day|week|month","days":[weekday numbers, Sunday=0, weekly only],"dom":day of month, monthly only},"blockedBy":existing id or another new ref or null,"waitingOn":who or what or null,"url":string or null,"duplicateOf":existing id or null,"similarTo":existing id or null}

Rules:
- text: the note's own words and language (keep Hinglish/Hindi as written), tidied, under 80 characters. Drop date words already captured in due/recur.
- Split a note holding several things into separate items. A shopping list ("milk, eggs, atta") becomes one "shop" item per product, text like "Milk".
- kind: shop = something to buy; link = a URL to read or watch (text = a short guess of what it is); idea = a thought or note, not an action; otherwise task.
- pri 1 = urgent or important, 2 = normal, 3 = trivial or someday.
- due: resolve relative dates with the calendar ("kal" usually means tomorrow, "by Friday" = that Friday, "on the 5th" = next 5th). Null when there is no date.
- recur: only for repeating things ("every day", "har roz", "every Monday", "rent on the 5th every month"). Then due = the next occurrence, today if it falls today.
- blockedBy: when something must happen first ("after X", "once X is done", "X before Y" means Y is blocked by X). Point to an existing id or another new item's ref.
- waitingOn: when they are waiting for someone or something ("waiting for Rahul to send the invoice" → "Rahul").
- duplicateOf: an existing id when the note clearly repeats the same intent, even in other words ("order whey" vs "buy protein powder"). Still include the item.
- similarTo: an existing id that might be the same thing but you are not sure. Use only when duplicateOf is null.
- done: existing ids the note reports as finished ("paid the rent", "called mom"). A note that only reports completion has "items": [].

Example: "check schematics before ordering pcb, urgent" → {"items":[{"ref":"n1","text":"Check schematics","kind":"task","pri":1,"due":null,"time":null,"recur":null,"blockedBy":null,"waitingOn":null,"url":null,"duplicateOf":null,"similarTo":null},{"ref":"n2","text":"Order PCB","kind":"task","pri":1,"due":null,"time":null,"recur":null,"blockedBy":"n1","waitingOn":null,"url":null,"duplicateOf":null,"similarTo":null}],"done":[]}`;
}

const API = "https://generativelanguage.googleapis.com/v1beta";
// Used when Google's model list can't be read. "-latest" names always point at Google's current model.
const FALLBACK_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"];
const Gemini = {
  key: () => (lsGet("sp.key") || "").trim(),
  pinned: () => lsGet("sp.model") || "",
  lastUsed: () => lsGet("sp.lastModel") || "",
  trace: [],
  listNote: "",
  // Rank models: fast "flash-lite" first, then "flash", newest version first. Skip preview, audio, image, etc.
  rank(name) {
    const n = name.replace(/^models\//, "");
    if (!/^gemini-/.test(n) || /(preview|exp|tts|live|image|audio|embed|thinking|robotics|computer|native|vision|veo|lyria|nano)/i.test(n)) return -1;
    let s = /flash-lite/.test(n) ? 200 : /flash/.test(n) ? 100 : -1;
    if (s < 0) return -1;
    s += parseFloat((n.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    if (/-latest$/.test(n)) s += 50; // prefer Google's always-current alias
    if (/-\d{3}$/.test(n)) s -= 0.01;
    return s;
  },
  async listModels(force) {
    if (!force) { try { const c = JSON.parse(lsGet("sp.models") || "null"); if (c && Date.now() < c.until && c.list.length) return c.list; } catch {} }
    let names = [], token = "", pages = 0;
    try {
      do {
        const res = await fetch(`${API}/models?pageSize=50${token ? "&pageToken=" + encodeURIComponent(token) : ""}`, { headers: { "x-goog-api-key": this.key() } });
        if (!res.ok) throw await this.err(res);
        const data = await res.json();
        (data.models || []).forEach(m => { if (!m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent")) names.push(m.name.replace(/^models\//, "")); });
        token = data.nextPageToken || ""; pages++;
      } while (token && pages < 10);
    } catch (e) {
      if (e && e.status === undefined) throw { status: 0, message: "No internet connection, or Gemini couldn't be reached" };
      this.listNote = `Couldn't read Google's model list (${e.status}: ${e.message}); using built-in model names.`;
      lsSet("sp.models", JSON.stringify({ until: Date.now() + 36e5, list: FALLBACK_MODELS }));
      return FALLBACK_MODELS;
    }
    const list = [...new Set(names.filter(n => this.rank(n) >= 0))].sort((a, b) => this.rank(b) - this.rank(a));
    const final = list.length ? list : FALLBACK_MODELS;
    this.listNote = list.length ? `${list.length} models available to your key.` : "Google's list had no Flash models; using built-in model names.";
    lsSet("sp.models", JSON.stringify({ until: Date.now() + 3*864e5, list: final }));
    return final;
  },
  async err(res) {
    let msg = ""; try { const j = await res.json(); msg = (j.error && j.error.message) || ""; } catch {}
    return { status: res.status, message: msg || res.statusText || "Request failed" };
  },
  // Newer models want thinkingLevel, older ones thinkingBudget; some take neither. Try each, remember what worked.
  modesFor(model) {
    let saved = null; try { saved = (JSON.parse(lsGet("sp.cfg") || "{}"))[model]; } catch {}
    const order = /^gemini-[3-9]|latest/.test(model) ? ["level", "none", "budget", "bare"] : ["budget", "none", "level", "bare"];
    return saved ? [saved, ...order.filter(m => m !== saved)] : order;
  },
  body(prompt, mode) {
    const gc = { temperature: 0.2 };
    if (mode !== "bare") gc.responseMimeType = "application/json";
    if (mode === "level") gc.thinkingConfig = { thinkingLevel: "minimal" };
    if (mode === "budget") gc.thinkingConfig = { thinkingBudget: 0 };
    return { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: gc };
  },
  async call(model, prompt) {
    let last = null;
    for (const mode of this.modesFor(model)) {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 30000);
      let res;
      try {
        res = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST", signal: ctl.signal,
          headers: { "Content-Type": "application/json", "x-goog-api-key": this.key() }, body: JSON.stringify(this.body(prompt, mode)),
        });
      } catch (e) {
        throw e && e.name === "AbortError" ? { status: 0, message: "Gemini took too long to answer" } : { status: 0, message: "No internet connection, or Gemini couldn't be reached" };
      } finally { clearTimeout(timer); }
      if (res.status === 400) { last = await this.err(res); continue; } // settings not accepted by this model: try the next combination
      if (!res.ok) throw await this.err(res);
      const data = await res.json();
      const text = ((data.candidates || [])[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
      const out = parseJSON(text);
      try { const c = JSON.parse(lsGet("sp.cfg") || "{}"); c[model] = mode; lsSet("sp.cfg", JSON.stringify(c)); } catch {}
      return out;
    }
    throw last || { status: 400, message: "Request contains an invalid argument." };
  },
  // Try the best model; on a limit, retired model or other refusal, move to the next one.
  async parse(prompt) {
    if (!this.key()) return null;
    this.trace = [];
    let list = await this.listModels();
    const pin = this.pinned();
    if (pin) list = [pin, ...list.filter(m => m !== pin)];
    let cool = {}; try { cool = JSON.parse(lsGet("sp.cool") || "{}"); } catch {}
    let lastErr = null, authErr = null, tried = 0;
    for (const m of list) {
      if (tried >= 5) break;
      if (cool[m] && cool[m] > Date.now()) continue;
      tried++;
      try { const out = await this.call(m, prompt); lsSet("sp.lastModel", m); this.trace.push(`${m}: ok`); return out; }
      catch (e) {
        this.trace.push(`${m}: ${e.status} ${String(e.message).slice(0, 90)}`);
        if (e.status === 0) throw e; // offline: no point trying others
        lastErr = e;
        if (/api key|API_KEY|credential|permission/i.test(e.message || "") && !authErr) authErr = e;
        if (e.status === 429) { cool[m] = Date.now() + 15*60e3; lsSet("sp.cool", JSON.stringify(cool)); }
        if (e.status === 404) lsDel("sp.models");
      }
    }
    throw authErr || lastErr || { status: 429, message: "Free limit reached on all available models" };
  },
};
function parseJSON(text) {
  let t = String(text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) t = fence[1];
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  throw { status: "json", message: "Gemini's reply wasn't readable" };
}


/* ---------- applying a parse ---------- */
function applyParsed(res, pendingId, raw, quiet) {
  const pending = S.items.get(pendingId);
  if (!pending) return;
  const now = Date.now(), tk = todayKey();
  const notes = []; let special = false;
  const touched = new Map();
  let top = topOrder();
  res.done.filter(id => { const e = S.items.get(id); return e && !e.done && id !== pendingId; }).forEach(id => {
    const e = S.items.get(id);
    touched.set(id, e.recur ? { ...e, lastDone: tk, due: nextDue(e.recur, tk), touched: now } : { ...e, done: now, touched: now });
    notes.push(`Marked done: “${e.text}”`); special = true;
    if (!e.recur) [...S.items.values()].filter(x => !x.done && x.blockedBy === id).forEach(d => touched.set(d.id, { ...d, order: top--, touched: now }));
  });
  let reused = false; const created = []; const refMap = {}; const suggest = [];
  for (const x of res.items) {
    if (!x.text) continue;
    const ex = x.duplicateOf && x.duplicateOf !== pendingId && (touched.get(x.duplicateOf) || S.items.get(x.duplicateOf));
    if (ex && !ex.done) {
      const m = { ...ex, mentions: (ex.mentions || 1) + 1, touched: now, snoozeUntil: null, order: top--, pri: Math.min(ex.pri || 2, x.pri || 2) };
      if (x.due && !m.due) { m.due = x.due; if (x.time) m.time = x.time; }
      touched.set(m.id, m); refMap[x.ref] = ex.id;
      notes.push(`Already noted: “${ex.text}” · moved to the top`); special = true; continue;
    }
    const id = reused ? newId() : (reused = true, pendingId);
    const it = { id, text: x.text, raw, kind: x.kind, pri: x.pri, due: x.due, time: x.time, recur: x.recur,
      blockedBy: null, waitingOn: x.waitingOn, url: x.url, created: now, touched: now, snoozeUntil: null, done: null, mentions: 1, lastDone: null };
    if (it.kind === "link" && !it.url) it.kind = "task";
    if (it.recur) { if (it.recur.unit === "month" && !it.recur.dom) it.recur.dom = parseKey(it.due || tk).getDate(); if (!it.due) it.due = firstDue(it.recur, tk); }
    refMap[x.ref] = id; created.push([it, x]);
    if (x.similarTo && S.items.has(x.similarTo) && !S.items.get(x.similarTo).done) suggest.push([id, x.similarTo]);
  }
  // New items go on top in the order they were written; trivial ones (pri 3) go to the bottom.
  let bottom = bottomOrder();
  for (let i = created.length - 1; i >= 0; i--) { const it = created[i][0]; it.order = it.pri === 3 ? bottom++ : top--; }
  created.forEach(([it, x]) => {
    if (x.blockedBy && it.kind === "task") {
      const tgt = refMap[x.blockedBy] || (S.items.has(x.blockedBy) ? x.blockedBy : null);
      if (tgt && tgt !== it.id && !(S.items.get(tgt) || {}).done) it.blockedBy = tgt;
    }
    touched.set(it.id, it);
  });
  if (suggest.length) S.meta = { ...S.meta, suggest: [...(S.meta.suggest || []), ...suggest].slice(-20) };
  const changes = [...touched.values()];
  if (!reused) changes.push({ id: pendingId, _delete: true });
  if (quiet) { commit(changes, null, false); return; }
  if (special) {
    const fallback = { ...pending, pending: false, text: raw.replace(/\s+/g, " ").slice(0, 200) };
    toastLabel = "Keep separate";
    commit(changes, notes.join(" · "), true, { [pendingId]: fallback });
    toastLabel = "Undo";
  } else {
    const c = created[0] && created[0][0];
    const where = it => ({ queue: "Tasks", shop: "Shopping", note: "Notes", link: "Links", routine: "Routines" })[bucket(it)] || "Tasks";
    const msg = created.length === 1 ? `Added to ${where(c)}${c.due && !c.recur ? " · " + fmtDue(c).s : ""}` : created.length ? `Added ${created.length} items` : "Nothing new to add";
    commit(changes, msg, false);
    if (c && bucket(c) !== "queue" && created.every(([it]) => bucket(it) === bucket(c))) { P.nav = bucket(c); savePrefs(); render(); }
  }
}

let aiNoticeShown = false;
async function send(raw) {
  raw = raw.trim(); if (!raw) return;
  const id = newId(), now = Date.now();
  const p = { id, text: raw.replace(/\s+/g, " ").slice(0, 200), raw, kind: "task", pending: true, created: now, touched: now, mentions: 1, order: topOrder() };
  S.items.set(id, p); persist(); render();
  const box = $("#queue"); if (box) box.scrollTop = 0;
  let res = null, note = "";
  if (Gemini.key()) {
    try { res = normRes(await Gemini.parse(buildPrompt(raw, id))); }
    catch (e) {
      const st = e && e.status;
      note = st === 403 || /api key/i.test(e.message || "") ? "Gemini didn't accept your key. Open Settings and tap Test for details."
        : st === 429 ? "Gemini's free limit is used up for now. Used basic sorting."
        : st === 0 ? "Offline. Used basic sorting."
        : "Gemini didn't answer, so basic sorting was used. Settings → Test shows why.";
      res = null;
    }
  } else if (!aiNoticeShown && S.items.size > 2) {
    aiNoticeShown = true; note = "Basic sorting used. Add a free Gemini key in Settings for smarter sorting.";
  }
  if (!res) res = normRes(heuristic(raw, id));
  applyParsed(res, id, raw);
  if (note) setTimeout(() => toast(note), 1800);
  renderHead();
}

/* ---------- merge suggestions ---------- */
function getSuggestion() {
  const no = new Set(S.meta.notDup || []);
  const ok = (a, b) => a && b && a !== b && !a.done && !b.done && !no.has(pairKey(a.id, b.id));
  for (const [x, y] of (S.meta.suggest || [])) { const a = S.items.get(x), b = S.items.get(y); if (ok(a, b)) return [a, b]; }
  const pool = [...S.items.values()].filter(it => !it.done && !it.pending && (it.kind === "task" || it.kind === "shop"));
  let best = null, bestS = 0.5;
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    const a = pool[i], b = pool[j];
    if (a.kind !== b.kind || no.has(pairKey(a.id, b.id))) continue;
    const s = sim(a.text, b.text); if (s >= bestS) { bestS = s; best = [a, b]; }
  }
  return best;
}
function mergePair(aId, bId) {
  const a = S.items.get(aId), b = S.items.get(bId); if (!a || !b) return;
  const [keep, drop] = (a.created || 0) <= (b.created || 0) ? [a, b] : [b, a];
  const due = [keep.due, drop.due].filter(Boolean).sort()[0] || null;
  const m = { ...keep, mentions: (keep.mentions || 1) + (drop.mentions || 1), touched: Date.now(), order: topOrder(),
    due, time: due === keep.due ? keep.time : drop.time, pri: Math.min(keep.pri || 2, drop.pri || 2),
    raw: [keep.raw || keep.text, drop.raw || drop.text].join("\n"), waitingOn: keep.waitingOn || drop.waitingOn, url: keep.url || drop.url };
  const deps = [...S.items.values()].filter(x => x.blockedBy === drop.id).map(x => ({ ...x, blockedBy: keep.id }));
  S.meta = { ...S.meta, suggest: (S.meta.suggest || []).filter(p => !p.includes(drop.id)) };
  commit([m, ...deps, { id: drop.id, _delete: true }], `Merged into “${keep.text}”`, true);
}
function keepBoth(aId, bId) {
  S.meta = { ...S.meta, notDup: [...(S.meta.notDup || []), pairKey(aId, bId)].slice(-300), suggest: (S.meta.suggest || []).filter(p => pairKey(p[0], p[1]) !== pairKey(aId, bId)) };
  persist(); render();
}

/* ---------- backup ---------- */
function backupBlob() {
  return new Blob([JSON.stringify({ app: "smart-scratchpad", version: 2, exported: new Date().toISOString(), items: [...S.items.values()], meta: S.meta }, null, 1)], { type: "application/json" });
}
function markBackedUp() { S.meta = { ...S.meta, lastBackup: Date.now() }; persist(); }
async function shareBackup() {
  const file = new File([backupBlob()], `scratchpad-backup-${todayKey()}.json`, { type: "application/json" });
  try { await navigator.share({ files: [file], title: "Scratchpad backup" }); markBackedUp(); toast("Backup shared"); render(); }
  catch (e) { if (e && e.name !== "AbortError") downloadBackup(); }
}
function downloadBackup() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(backupBlob()); a.download = `scratchpad-backup-${todayKey()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  markBackedUp(); toast("Backup downloaded"); render();
}
async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.items)) throw new Error("bad");
    let added = 0, updated = 0;
    data.items.forEach(it => {
      if (!it || !it.id || !it.text) return;
      const cur = S.items.get(it.id);
      if (!cur) { S.items.set(it.id, it); added++; }
      else if ((it.touched || 0) > (cur.touched || 0)) { S.items.set(it.id, it); updated++; }
    });
    migrate(); persist(); closeSheet(); render();
    toast(`Restored ${added} new and ${updated} updated items`);
  } catch { toast("That file isn't a Scratchpad backup."); }
}

/* ---------- rendering ---------- */
function chipsFor(it, ctx) {
  const c = [];
  if (it.pending) c.push(`<span class="chip ai"><span class="pulse"></span>Sorting…</span>`);
  const fresh = it.surf && (it.touched || 0) < it.surf.at;
  if (fresh && it.surf.why === "back") c.push(`<span class="chip back">back · noted ${it.surf.age}d ago</span>`);
  if (fresh && it.surf.why === "snooze") c.push(`<span class="chip back">back from snooze</span>`);
  if (it.recur) c.push(`<span class="chip">${esc(recurLabel(it.recur))}</span>`);
  const d = !it.recur && fmtDue(it); if (d) c.push(`<span class="chip ${d.cls}">${esc(d.s)}</span>`);
  if (it.recur && it.due && ctx !== "queue") c.push(`<span class="chip">next ${esc(fmtDue(it).s)}</span>`);
  if (ctx === "snoozed") c.push(`<span class="chip">back ${esc(fmtWhen(it.snoozeUntil))}</span>`);
  if (it.waitingOn) c.push(`<span class="chip">waiting on ${esc(it.waitingOn)}</span>`);
  if (it.blockedBy) { const b = S.items.get(it.blockedBy); if (b && !b.done) c.push(`<span class="chip">after: ${esc(b.text.slice(0, 36))}</span>`); }
  if ((it.mentions || 1) > 1) c.push(`<span class="chip">noted ×${it.mentions}</span>`);
  if (it.pri === 1) c.push(`<span class="chip over">important</span>`);
  if (it.url) { let h = ""; try { h = new URL(it.url).hostname.replace(/^www\./, ""); } catch {} if (h) c.push(`<span class="chip">${esc(h)}</span>`); }
  if (ctx === "done") c.push(`<span class="chip">done ${esc(fmtWhen(it.done))}</span>`);
  return c.join("");
}
function rowHTML(it, ctx) {
  const q = ctx === "queue";
  const fresh = it.surf && (it.touched || 0) < it.surf.at;
  const cls = ["tile", (it.mentions || 1) > 1 || it.pri === 1 ? "hot" : "", fresh && it.surf.why !== "due" ? "back" : "", isBlocked(it) ? "dim" : ""].join(" ");
  if (ctx === "done") return `<div class="row done"><div class="tile"><div class="body"><div class="t">${esc(it.text)}</div><div class="meta">${chipsFor(it, ctx)}</div></div><button class="restore" data-act="restore" data-id="${it.id}">Restore</button></div></div>`;
  const left = it.recur ? "Skip" : "Snooze";
  return `<div class="row" data-row="${it.id}"><div class="under" aria-hidden="true"><div class="dn">Done</div><div class="tray"><button class="snz" data-act="snooze" data-id="${it.id}" tabindex="-1">${left}</button><button class="rm" data-act="del" data-id="${it.id}" tabindex="-1">Delete</button></div></div>
  <div class="${cls}" data-id="${it.id}" tabindex="0" role="button" aria-label="${esc(it.text)}. Swipe right for done, left for ${left.toLowerCase()} or delete. Tap to edit.">
    <button class="tick${it.kind === "shop" ? " sq" : ""}" data-act="done" data-id="${it.id}" aria-label="Mark done"></button>
    <div class="body"><div class="t">${esc(it.text)}</div><div class="meta">${chipsFor(it, ctx)}</div></div>
    ${it.url ? `<a class="open-link" href="${esc(it.url)}" target="_blank" rel="noopener">Open ↗</a>` : ""}
    ${q ? `<button class="handle" data-handle="${it.id}" aria-label="Drag to reorder"><svg width="14" height="20" viewBox="0 0 14 20" fill="currentColor"><circle cx="4" cy="4" r="1.6"/><circle cx="10" cy="4" r="1.6"/><circle cx="4" cy="10" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="4" cy="16" r="1.6"/><circle cx="10" cy="16" r="1.6"/></svg></button>` : ""}
  </div></div>`;
}

function renderHead() {
  const d = new Date();
  const ai = Gemini.key() ? `<span class="dot"></span>Gemini` : `<span class="dot off"></span><button data-act="settings">Add Gemini key</button>`;
  $("#sub").innerHTML = `${esc(d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }))} · ${ai}`;
}

const NAV = [["shop", "Shopping"], ["note", "Notes"], ["link", "Links"], ["routine", "Routines"], ["snoozed", "Snoozed"], ["done", "Done"]];
const NAV_EMPTY = { shop: "Type “buy milk, bread” to add things.", note: "Start a note with “idea:” or just write the thought.", link: "Paste a link to save it for later.", routine: "Write “every Monday …” or “daily …” to add one.", snoozed: "Nothing snoozed.", done: "Completed items show here for 30 days." };

let busy = false, deferred = false;
function render() {
  if (busy) { deferred = true; return; }
  renderHead();
  const now = Date.now(), tk = todayKey();
  const g = { queue: [], shop: [], note: [], link: [], routine: [], snoozed: [], done: [] };
  for (const it of S.items.values()) g[bucket(it, now, tk)].push(it);
  g.queue.sort(byOrder);
  ["shop","note","link"].forEach(k => g[k].sort((a, b) => (b.created || 0) - (a.created || 0)));
  g.routine.sort((a, b) => (a.due || "") < (b.due || "") ? -1 : 1);
  g.snoozed.sort((a, b) => a.snoozeUntil - b.snoozeUntil);
  g.done.sort((a, b) => b.done - a.done);

  const box = $("#queue"); const keep = box ? box.scrollTop : 0;
  let h = `<div class="layout"><section aria-label="Tasks">`;
  const sg = getSuggestion();
  if (sg) h += `<div class="suggest"><div class="q">Same thing?</div><div class="pair">“${esc(sg[0].text)}” <span>and</span> “${esc(sg[1].text)}”</div><div class="btns"><button class="pill pri" data-act="merge" data-a="${sg[0].id}" data-b="${sg[1].id}">Merge</button><button class="pill" data-act="keepboth" data-a="${sg[0].id}" data-b="${sg[1].id}">Keep both</button></div></div>`;
  h += `<div class="qhead"><h2>Tasks</h2><span class="c">${g.queue.length}</span><span class="sp"></span><span class="how">→ done · ← snooze/delete<br>drag ⋮⋮ to reorder</span></div>`;
  h += `<div class="queue" id="queue" style="--rows:${P.rows}">`;
  h += g.queue.length ? g.queue.map(x => rowHTML(x, "queue")).join("") : emptyHTML();
  h += `</div><div class="qfoot">${g.queue.length > P.rows ? `Showing ${P.rows} of ${g.queue.length} · scroll inside the list. Older ones come back on their own.` : ""}</div></section>`;

  const sel = NAV.some(n => n[0] === P.nav) ? P.nav : "shop";
  h += `<section class="navsec" aria-label="Lists"><div class="nav" role="tablist">${NAV.map(([k, label]) => `<button role="tab" data-act="nav" data-nav="${k}" aria-selected="${k === sel}">${label}${g[k].length ? `<span class="n">${g[k].length}</span>` : ""}</button>`).join("")}</div>`;
  const lb = S.meta.lastBackup;
  if (S.items.size > 5 && (!lb || now - lb > 7*864e5)) h += `<div class="banner"><span>${lb ? `Last backup ${daysAgo(lb)} days ago.` : "Your items live only on this phone."}</span><button data-act="settings">Back up</button></div>`;
  const list = sel === "done" ? g.done.slice(0, 40) : g[sel];
  h += `<div class="navlist">${list.length ? list.map(x => rowHTML(x, sel)).join("") : `<p class="hint">${NAV_EMPTY[sel]}</p>`}</div></section></div>`;
  $("#main").innerHTML = h;
  const nb = $("#queue"); if (nb) nb.scrollTop = keep;
}

function emptyHTML() {
  const ex = [
    ["pay electricity bill by friday", "gets a due date"],
    ["milk, eggs, atta", "goes to the shopping list"],
    ["check schematics before ordering the PCB", "links the two tasks"],
    ["gym every day", "becomes a daily routine"],
  ];
  return `<div class="qempty"><b>Text yourself here instead.</b>Type anything the way you would in WhatsApp. New notes land on top, repeats get merged and moved up, and tasks you haven't touched in a while come back to the top.
  <div class="ex">${ex.map(e => `<button data-act="example" data-text="${esc(e[0])}">${esc(e[0])}<span>${esc(e[1])}</span></button>`).join("")}</div></div>`;
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg, undo) {
  const t = $("#toast"); clearTimeout(toastTimer);
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button type="button">${esc(toastLabel)}</button>` : ""}`;
  if (undo) t.querySelector("button").onclick = () => { t.hidden = true; undo(); };
  t.hidden = false;
  toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 6000 : 3500);
}

/* ---------- sheets ---------- */
function openSheet(html) { $("#sheet").innerHTML = `<div class="grab"></div>` + html; $("#sheetwrap").hidden = false; }
function closeSheet() { $("#sheetwrap").hidden = true; }

function openSnooze(id) {
  const it = S.items.get(id); if (!it) return;
  if (it.recur) { skipRoutine(id); return; }
  const n = new Date(), opts = [];
  if (n.getHours() < 17) { const t = new Date(n); t.setHours(20, 0, 0, 0); opts.push(["This evening", t]); }
  else if (n.getHours() < 21) opts.push(["In 3 hours", new Date(n.getTime() + 3*36e5)]);
  const tm = new Date(n); tm.setDate(tm.getDate() + 1); tm.setHours(9, 0, 0, 0); opts.push(["Tomorrow morning", tm]);
  const sat = new Date(n); sat.setDate(sat.getDate() + ((6 - n.getDay() + 7) % 7 || 7)); sat.setHours(10, 0, 0, 0);
  opts.push([n.getDay() === 6 || n.getDay() === 0 ? "Next weekend" : "This weekend", sat]);
  const mon = new Date(n); mon.setDate(mon.getDate() + ((1 - n.getDay() + 7) % 7 || 7)); mon.setHours(9, 0, 0, 0); opts.push(["Next week", mon]);
  const m2 = new Date(n); m2.setDate(m2.getDate() + 30); m2.setHours(9, 0, 0, 0); opts.push(["In a month", m2]);
  openSheet(`<h3>Snooze “${esc(it.text.slice(0, 60))}”</h3><div class="opts">
    ${opts.map(o => `<button class="opt" data-act="snz" data-id="${id}" data-until="${o[1].getTime()}"><span>${o[0]}</span><small>${esc(fmtWhen(o[1].getTime()))}</small></button>`).join("")}
    <button class="opt" data-act="snz" data-id="${id}" data-until="bottom"><span>Just move it down</span><small>bottom of the list</small></button></div>
    <p class="note">A snoozed task comes back at the top of the list at that time.</p>`);
}

function openEdit(id) {
  const it = S.items.get(id); if (!it || it.pending) return;
  const r = it.recur;
  const rep = !r ? "none" : r.unit === "day" && (r.every || 1) === 1 ? "daily" : recurLabel(r) === "Weekdays" ? "weekdays" : r.unit === "week" && (r.every || 1) === 1 && r.days && r.days.length === 1 ? "weekly" : r.unit === "month" && (r.every || 1) === 1 ? "monthly" : "keep";
  const repOpts = [["none","Doesn't repeat"],["daily","Every day"],["weekdays","Weekdays"],["weekly","Every week"],["monthly","Every month"]];
  if (rep === "keep") repOpts.push(["keep", recurLabel(r)]);
  const tasks = [...S.items.values()].filter(x => !x.done && x.id !== id && x.kind === "task" && !x.recur && !x.pending).sort((a, b) => (b.touched || 0) - (a.touched || 0)).slice(0, 40);
  const radio = (name, val, label, cur) => `<input type="radio" name="${name}" id="${name}-${val}" value="${val}"${cur === val ? " checked" : ""}><label for="${name}-${val}">${label}</label>`;
  const pri = it.pri || 2;
  openSheet(`<h3>Edit</h3>
    <div class="fld"><label for="f-text">Text</label><textarea id="f-text" rows="2">${esc(it.text)}</textarea></div>
    <div class="fld"><span class="lbl">Type</span><div class="seg">${radio("f-kind","task","Task",it.kind)}${radio("f-kind","shop","Shopping",it.kind)}${radio("f-kind","idea","Note",it.kind)}${radio("f-kind","link","Link",it.kind)}</div></div>
    <div class="fld"><span class="lbl">Importance</span><div class="seg">${radio("f-pri","1","Important",String(pri))}${radio("f-pri","2","Normal",String(pri))}${radio("f-pri","3","Someday",String(pri))}</div></div>
    <div class="two"><div class="fld"><label for="f-due">Date</label><input type="date" id="f-due" value="${esc(it.due || "")}"></div><div class="fld"><label for="f-time">Time</label><input type="time" id="f-time" value="${esc(it.time || "")}"></div></div>
    <div class="fld"><label for="f-rep">Repeat</label><select id="f-rep">${repOpts.map(o => `<option value="${o[0]}"${o[0] === rep ? " selected" : ""}>${esc(o[1])}</option>`).join("")}</select></div>
    <div class="two"><div class="fld"><label for="f-wait">Waiting on</label><input id="f-wait" value="${esc(it.waitingOn || "")}" placeholder="Person or thing"></div>
    <div class="fld"><label for="f-after">Do after</label><select id="f-after"><option value="">Nothing</option>${tasks.map(t => `<option value="${t.id}"${it.blockedBy === t.id ? " selected" : ""}>${esc(t.text.slice(0, 50))}</option>`).join("")}</select></div></div>
    <div class="fld"><label for="f-url">Link</label><input id="f-url" type="url" value="${esc(it.url || "")}" placeholder="https://"></div>
    <div class="acts"><button class="btn pri" data-act="save" data-id="${id}">Save</button><button class="btn ok" data-act="done" data-id="${id}">${it.recur ? "Done today" : "Done"}</button><button class="btn" data-act="snooze" data-id="${id}">${it.recur ? "Skip" : "Snooze"}</button><button class="btn" data-act="top" data-id="${id}">Move to top</button><button class="btn bad" data-act="del" data-id="${id}">Delete</button></div>
    ${it.raw && it.raw !== it.text ? `<p class="note">You wrote: “${esc(it.raw.slice(0, 400))}”</p>` : ""}`);
}

function saveEdit(id) {
  const it = S.items.get(id); if (!it) return closeSheet();
  const v = s => ($(s) || {}).value || "";
  const text = v("#f-text").replace(/\s+/g, " ").trim();
  const kind = (document.querySelector('input[name="f-kind"]:checked') || {}).value || it.kind;
  const pri = +((document.querySelector('input[name="f-pri"]:checked') || {}).value || it.pri || 2);
  const rep = v("#f-rep"), url = v("#f-url").trim();
  const nu = { ...it, text, kind, pri, due: v("#f-due") || null, time: v("#f-time") || null, waitingOn: v("#f-wait").trim() || null,
    blockedBy: v("#f-after") || null, url: /^https?:\/\//i.test(url) ? url : null, touched: Date.now() };
  closeSheet();
  if (!text) { del(id); return; }
  const tk = todayKey(), base = nu.due || tk;
  nu.recur = rep === "none" ? null : rep === "daily" ? { every: 1, unit: "day" } : rep === "weekdays" ? { every: 1, unit: "week", days: [1,2,3,4,5] }
    : rep === "weekly" ? { every: 1, unit: "week", days: [parseKey(base).getDay()] } : rep === "monthly" ? { every: 1, unit: "month", dom: parseKey(base).getDate() } : it.recur;
  if (nu.recur && !nu.due) nu.due = firstDue(nu.recur, tk);
  if (!nu.recur) nu.lastDone = null;
  if (nu.kind === "link" && !nu.url) nu.kind = "task";
  commit([nu], "Saved", true);
}

function openSettings() {
  const key = Gemini.key();
  const masked = key ? key.slice(0, 5) + "…" + key.slice(-4) : "";
  const lb = S.meta.lastBackup;
  const canShare = !!(navigator.canShare && (() => { try { return navigator.canShare({ files: [new File(["{}"], "x.json", { type: "application/json" })] }); } catch { return false; } })());
  const sel = (id, vals, cur, fmt) => `<select id="${id}">${vals.map(v => `<option value="${v}"${v === cur ? " selected" : ""}>${fmt(v)}</option>`).join("")}</select>`;
  openSheet(`<h3>Settings</h3>
    <h4>Task list</h4>
    <div class="three">
      <div class="fld"><label for="p-rows">Rows shown</label>${sel("p-rows", [4,5,6,7,8,9,10,12,15], P.rows, v => v)}</div>
      <div class="fld"><label for="p-days">Bring back after</label>${sel("p-days", [1,2,3,4,5,7,10,14], P.days, v => v + (v === 1 ? " day" : " days"))}</div>
      <div class="fld"><label for="p-per">Per day</label>${sel("p-per", [1,2,3,4,5], P.perDay, v => v + (v === 1 ? " task" : " tasks"))}</div>
    </div>
    <p class="note" style="margin-top:0">Each morning, up to “per day” tasks that sit below the shown rows and haven't been touched for that many days move back to the top.</p>
    <h4>Smart sorting with Gemini</h4>
    <div class="fld"><label for="s-key">Gemini API key</label><input id="s-key" type="password" autocomplete="off" spellcheck="false" placeholder="${key ? esc(masked) : "Paste your key"}"></div>
    <div class="acts"><button class="btn pri" data-act="key-save">${key ? "Replace key" : "Save key"}</button>${key ? `<button class="btn" data-act="key-test">Test</button><button class="btn bad" data-act="key-del">Remove</button>` : ""}</div>
    <div class="status" id="s-status">${key ? `Key saved${Gemini.lastUsed() ? ` · last sorted with ${esc(Gemini.lastUsed())}` : ""}` : "No key. Basic built-in sorting is used."}</div>
    <p class="note">Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>. The key stays on this phone and is sent only to Google. On the free tier Google may use what you send to improve its products, so avoid putting passwords or very private details in notes.</p>
    <div class="fld" style="margin-top:12px"><label for="s-model">Model</label><select id="s-model"><option value="">Automatic (fastest free model)</option>${(() => { try { return (JSON.parse(lsGet("sp.models") || "null") || { list: [] }).list.map(m => `<option value="${esc(m)}"${Gemini.pinned() === m ? " selected" : ""}>${esc(m)}</option>`).join(""); } catch { return ""; } })()}</select></div>
    <h4>Backup</h4>
    <p class="note" style="margin-top:0">Your items are saved in this browser on this phone. Back up now and then so a cleared browser or a new phone doesn't lose them.${lb ? ` Last backup: ${esc(new Date(lb).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }))}.` : " No backup yet."}</p>
    <div class="acts">${canShare ? `<button class="btn" data-act="backup-share">Save to Drive / share</button>` : ""}<button class="btn" data-act="backup-dl">Download backup</button><button class="btn" data-act="restore-pick">Restore from file</button></div>
    <p class="note">Restoring merges the file with what's here; nothing is deleted.</p>`);
}
async function testKey() {
  const st = $("#s-status"); if (!st) return;
  st.className = "status"; st.textContent = "Checking…";
  try {
    lsDel("sp.cool");
    await Gemini.listModels(true);
    const out = await Gemini.parse('Reply with only this JSON: {"ok":true}');
    st.className = "status good";
    st.textContent = `Working · ${Gemini.lastUsed()} answered${out && out.ok ? "" : " (unexpected reply)"}. ${Gemini.listNote}`;
  } catch (e) {
    st.className = "status bad";
    st.innerHTML = esc(`Didn't work: ${(e && e.message) || "couldn't reach Gemini"}`) + "<br>" + esc(Gemini.listNote) + "<br>Tried: " + esc(Gemini.trace.join(" | ") || "nothing");
  }
}

/* ---------- events: taps ---------- */
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const id = b.dataset.id, act = b.dataset.act;
  if (b.closest(".tray")) closeOpenRow();
  switch (act) {
    case "nav": P.nav = b.dataset.nav; savePrefs(); render(); break;
    case "done": if (!$("#sheetwrap").hidden) closeSheet(); complete(id); break;
    case "snooze": closeSheet(); openSnooze(id); break;
    case "snz": closeSheet(); snooze(id, b.dataset.until === "bottom" ? "bottom" : +b.dataset.until); break;
    case "save": saveEdit(id); break;
    case "del": closeSheet(); del(id); break;
    case "top": closeSheet(); moveTop(id); break;
    case "close": closeSheet(); break;
    case "restore": { const it = S.items.get(id); if (it) commit([{ ...it, done: null, order: topOrder(), touched: Date.now() }], "Restored", true); break; }
    case "merge": mergePair(b.dataset.a, b.dataset.b); break;
    case "keepboth": keepBoth(b.dataset.a, b.dataset.b); break;
    case "example": { ta.value = b.dataset.text; autosize(); ta.focus(); break; }
    case "settings": openSettings(); break;
    case "key-save": { const k = ($("#s-key").value || "").trim(); if (!k) { $("#s-status").textContent = "Paste a key first."; break; } lsSet("sp.key", k); lsDel("sp.models"); lsDel("sp.cool"); renderHead(); openSettings(); testKey(); break; }
    case "key-test": testKey(); break;
    case "key-del": lsDel("sp.key"); lsDel("sp.models"); lsDel("sp.model"); renderHead(); openSettings(); break;
    case "backup-share": shareBackup(); break;
    case "backup-dl": downloadBackup(); break;
    case "restore-pick": $("#import-file").click(); break;
  }
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "s-model") { if (t.value) lsSet("sp.model", t.value); else lsDel("sp.model"); }
  if (t.id === "p-rows") { P.rows = +t.value; savePrefs(); render(); }
  if (t.id === "p-days") { P.days = +t.value; savePrefs(); }
  if (t.id === "p-per") { P.perDay = +t.value; savePrefs(); }
  if (t.id === "import-file" && t.files[0]) { importBackup(t.files[0]); t.value = ""; }
});

/* ---------- events: swipe (right = done, left = reveal Snooze / Delete) ---------- */
const TRAY = 152;
let sw = null, openRow = null;
function closeOpenRow() {
  if (!openRow) return;
  const tile = openRow.querySelector(".tile"); if (tile) tile.style.transform = "";
  const r = openRow; openRow = null;
  setTimeout(() => r.classList.remove("open", "to-left"), 220);
}
document.addEventListener("pointerdown", e => {
  if (drag) return;
  const tile = e.target.closest(".tile[data-id]");
  if (openRow && (!tile || tile.parentElement !== openRow) && !e.target.closest(".tray")) closeOpenRow();
  if (!tile || e.target.closest("button,a,input,select,textarea") || (e.pointerType === "mouse" && e.button !== 0)) return;
  const row = tile.parentElement;
  sw = { id: tile.dataset.id, tile, row, x0: e.clientX, y0: e.clientY, dx: 0, base: row.classList.contains("open") ? -TRAY : 0, active: false, pid: e.pointerId };
});
document.addEventListener("pointermove", e => {
  if (!sw || e.pointerId !== sw.pid) return;
  const dx = e.clientX - sw.x0, dy = e.clientY - sw.y0;
  if (!sw.active) {
    if (Math.abs(dx) > 9 && Math.abs(dx) > Math.abs(dy) * 1.3) { sw.active = busy = true; try { sw.tile.setPointerCapture(sw.pid); } catch {} sw.tile.classList.add("dragging"); }
    else if (Math.abs(dy) > 10) { sw = null; return; }
    else return;
  }
  const x = Math.max(-TRAY - 40, sw.base + dx);
  sw.dx = x;
  sw.tile.style.transform = `translateX(${x}px)`;
  sw.row.classList.toggle("to-done", x > 0);
  sw.row.classList.toggle("to-left", x < 0);
});
function endSwipe(e) {
  if (!sw || e.pointerId !== sw.pid) return;
  const { active, dx, tile, row, id } = sw; sw = null;
  if (!active) { if (e.type === "pointerup") { if (row.classList.contains("open")) closeOpenRow(); else openEdit(id); } return; }
  busy = false;
  tile.classList.remove("dragging");
  const w = tile.offsetWidth;
  const finish = () => { if (deferred) { deferred = false; render(); } };
  if (dx > w * 0.3) { tile.style.transform = `translateX(${w}px)`; tile.classList.add("fly"); setTimeout(() => { complete(id); finish(); }, 170); return; }
  if (dx < -TRAY / 2) { tile.style.transform = `translateX(${-TRAY}px)`; row.classList.add("open"); row.classList.remove("to-done"); if (openRow && openRow !== row) closeOpenRow(); openRow = row; finish(); return; }
  tile.style.transform = ""; row.classList.remove("open"); if (openRow === row) openRow = null;
  setTimeout(() => { row.classList.remove("to-done", "to-left"); finish(); }, 220);
}

/* ---------- events: drag the handle to reorder ---------- */
let drag = null;
document.addEventListener("pointerdown", e => {
  const h = e.target.closest("[data-handle]"); if (!h) return;
  const box = $("#queue"); const row = h.closest(".row"); if (!box || !row) return;
  e.preventDefault(); closeOpenRow();
  const rows = [...box.querySelectorAll(":scope > .row")];
  const idx = rows.indexOf(row); if (idx < 0) return;
  const gap = parseFloat(getComputedStyle(box).rowGap) || 6;
  drag = { box, row, rows, idx, to: idx, pid: e.pointerId, y: e.clientY, gap,
    geo: rows.map(r => ({ top: r.offsetTop, h: r.offsetHeight })), start: e.clientY - box.getBoundingClientRect().top + box.scrollTop, raf: 0 };
  busy = true;
  try { h.setPointerCapture(e.pointerId); } catch {}
  row.classList.add("lift");
  rows.forEach(r => r !== row && r.classList.add("shift"));
  const loop = () => {
    if (!drag) return;
    const r = drag.box.getBoundingClientRect();
    if (drag.y < r.top + 48) drag.box.scrollTop -= Math.ceil((r.top + 48 - drag.y) / 6);
    else if (drag.y > r.bottom - 48) drag.box.scrollTop += Math.ceil((drag.y - (r.bottom - 48)) / 6);
    layoutDrag();
    drag.raf = requestAnimationFrame(loop);
  };
  drag.raf = requestAnimationFrame(loop);
});
function layoutDrag() {
  const d = drag; const y = d.y - d.box.getBoundingClientRect().top + d.box.scrollTop;
  const maxY = d.geo[d.geo.length - 1].top + d.geo[d.geo.length - 1].h - d.geo[d.idx].h - d.geo[d.idx].top;
  const dy = Math.max(-d.geo[d.idx].top, Math.min(maxY, y - d.start));
  d.row.style.transform = `translateY(${dy}px)`;
  const center = d.geo[d.idx].top + d.geo[d.idx].h / 2 + dy;
  const shift = d.geo[d.idx].h + d.gap;
  let to = d.idx;
  d.rows.forEach((r, j) => {
    if (j === d.idx) return;
    const c = d.geo[j].top + d.geo[j].h / 2;
    let t = 0;
    if (j < d.idx && center < c) { t = shift; to = Math.min(to, j); }
    if (j > d.idx && center > c) { t = -shift; to = Math.max(to, j); }
    r.style.transform = t ? `translateY(${t}px)` : "";
  });
  d.to = to;
}
document.addEventListener("pointermove", e => { if (drag && e.pointerId === drag.pid) { drag.y = e.clientY; } }, { passive: true });
function endDrag(e) {
  if (!drag || e.pointerId !== drag.pid) return;
  cancelAnimationFrame(drag.raf);
  const d = drag; drag = null; busy = false; deferred = false;
  const ids = d.rows.map(r => r.dataset.row);
  const [moved] = ids.splice(d.idx, 1); ids.splice(d.to, 0, moved);
  if (d.to === d.idx) { render(); return; }
  const now = Date.now();
  const changes = ids.map((id, i) => { const it = S.items.get(id); return it && it.order !== i ? { ...it, order: i, ...(id === moved ? { touched: now } : {}) } : null; }).filter(Boolean);
  const mv = S.items.get(moved); if (mv && !changes.some(c => c.id === moved)) changes.push({ ...mv, touched: now });
  commit(changes, null, false);
}
document.addEventListener("pointerup", e => { endDrag(e); endSwipe(e); });
document.addEventListener("pointercancel", e => { endDrag(e); endSwipe(e); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("#sheetwrap").hidden) { closeSheet(); return; }
  const tile = e.target.closest && e.target.closest(".tile[data-id]");
  if (tile && e.target === tile && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openEdit(tile.dataset.id); }
});

/* ---------- composer ---------- */
const ta = $("#input");
function autosize() { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 2, 140) + "px"; $("#send").disabled = !ta.value.trim(); }
ta.addEventListener("input", autosize);
ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(hover: hover)").matches) { e.preventDefault(); $("#compose").requestSubmit(); } });
$("#compose").addEventListener("submit", e => {
  e.preventDefault(); const v = ta.value; if (!v.trim()) return;
  ta.value = ""; autosize(); send(v);
});

/* ---------- start ---------- */
function migrate() {
  // Older versions had Focus/Later zones: put Focus items first, then the rest, newest first.
  const missing = [...S.items.values()].filter(it => typeof it.order !== "number");
  if (!missing.length) return;
  missing.sort((a, b) => ((a.zone === "focus" ? 0 : 1) - (b.zone === "focus" ? 0 : 1)) || (b.touched || 0) - (a.touched || 0));
  let o = bottomOrder();
  missing.forEach(it => { S.items.set(it.id, { ...it, order: o++ }); });
}
(function boot() {
  migrate();
  for (const it of [...S.items.values()]) if (it.pending) applyParsed(normRes(heuristic(it.raw || it.text, it.id)), it.id, it.raw || it.text, true);
  persist();
  autosize();
  render();
  maintain();
  setInterval(() => { if (!document.hidden && !busy) { maintain(); render(); } }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !busy) { maintain(); render(); } });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();

window.__scratchpad = { heuristic, nextDue, normRes, applyParsed, parseJSON, Gemini, S, P, bucket, send, buildPrompt, maintain, queue, getSuggestion, mergePair, sim };
})();
