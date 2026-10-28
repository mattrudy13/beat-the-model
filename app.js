// Beat the Model page. Reads everything from the Worker (games, frozen lines, scores, your picks) and
// grades in the browser with lib/rules.js, the same rules the Worker uses to lock picks.

import { PLAYERS, cover, outcome, standings, summary, isOpen, freezeTime, winPct } from "./lib/rules.js";

const LIVE_API = "https://beat-the-model.mattrudy13.workers.dev";
const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const params = new URLSearchParams(location.search);
// ?api= and ?now= only work on a local preview, so a crafted link can't send the passphrase elsewhere.
const API = (local && params.get("api")) || LIVE_API;
const now = () => (local && params.get("now") ? Date.parse(params.get("now")) : Date.now());
const KEY = "btm:key:v1";
const FILTER_KEY = "btm:filter:v1";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

let S = null; // state from the Worker
let key = store.get(KEY);
let filter = store.get(FILTER_KEY) ?? "all";
const saving = new Set(); // game ids with a save in flight
const errors = {}; // game id → message from a failed save
let unlockError = "";
let syncNote = ""; // status of a "Check now" sync
let shownWeek = null;

// ---- Formatting ----
const signed = (x) => (x === 0 ? "PK" : x < 0 ? `−${Math.abs(x)}` : `+${x}`);
const lineFor = (g, side) => signed(side === "home" ? g.line : -g.line);
const teamOf = (g, side) => (side === "home" ? g.home : g.away);
const abbrOf = (g, side) => (side === "home" ? g.homeAbbr : g.awayAbbr) ?? teamOf(g, side).slice(0, 4).toUpperCase();
const et = (t, opts) => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", ...opts });
const kick = (t) => `${et(t, { weekday: "short" })} ${et(t, { hour: "numeric", minute: "2-digit" })} ET`;
const dayName = (t) => et(t, { weekday: "long", month: "short", day: "numeric" });
const rec = (r) => `${r.w}–${r.l}${r.p ? `–${r.p}` : ""}`;
const ord = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;
function ago(iso) {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60e3);
  if (m < 2) return "just now";
  if (m < 90) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`;
}
const avatar = (p) => `<span class="av ${p.id === "you" || p.id === "model" ? p.id : ""}" aria-hidden="true">${esc(p.code)}</span>`;
const chip = (p) => `<span class="chip">${avatar(p)}${esc(p.name)}</span>`;

// ---- Data ----
async function load() {
  const res = await fetch(`${API}/api/state`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  S = await res.json();
  render();
}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const gamesOf = (wk) => S.games.filter((g) => g.week === wk);
const lined = (g) => g.line != null;
const unlocked = () => !!key;

// ---- Race summary ----
function renderRace() {
  const x = summary(S.games, S.picks, S.week, now());
  const { you, model, board } = x;
  const diff = you.w - model.w;
  const boardPct = board.w + board.l ? `${(winPct(board) * 100).toFixed(1)}% on all ${board.w + board.l + board.p} graded games` : "No graded games yet";
  $("race").innerHTML = x.graded ? `
    <div class="stat lead you"><p class="k">You vs the Model</p><p class="v">${diff === 0 ? "Even" : diff > 0 ? `${diff} up` : `${-diff} behind`}</p>
      <p class="s">You <span class="num">${rec(you)}</span> · Model <span class="num">${rec(model)}</span> on your ${x.graded} graded picks</p></div>
    <div class="stat"><p class="k">Your rank</p><p class="v">${ord(x.rank)} <span style="font-size:.6em;color:var(--muted)">of ${x.players}</span></p>
      <p class="s">${x.leader.id === "you" ? "You lead" : `${esc(x.leader.name)} leads`} at <span class="num">${(x.leader.pct * 100).toFixed(1)}%</span></p></div>
    <div class="stat model"><p class="k">Model, every game</p><p class="v num">${rec(board)}</p><p class="s">${boardPct}</p></div>`
    : `
    <div class="stat lead you"><p class="k">You vs the Model</p><p class="v">0–0</p><p class="s">No graded picks yet. Pick any games you like; the Model and the bots are graded on the same ones.</p></div>
    <div class="stat"><p class="k">Players</p><p class="v">${x.players}</p><p class="s">You, the Model and ${x.players - 2} bots</p></div>
    <div class="stat model"><p class="k">Model, every game</p><p class="v num">${rec(board)}</p><p class="s">${boardPct}</p></div>`;
}

// ---- Unlock bar ----
function renderUnlock() {
  $("unlock").innerHTML = unlocked()
    ? `<span><b>Picking on this device.</b> Picks save as you tap and lock at kickoff.</span>
       <button type="button" class="btn link" id="lock">Lock this device</button>`
    : `<span><b>View only.</b> Enter the passphrase to pick on this device.</span>
       <form id="unlock-form"><label class="visually-hidden" for="pass">Passphrase</label>
         <input id="pass" type="password" autocomplete="current-password" required>
         <button class="btn" type="submit">Unlock</button></form>
       ${unlockError ? `<span class="err" role="alert">${esc(unlockError)}</span>` : ""}`;
}

document.addEventListener("submit", async (e) => {
  if (e.target.id !== "unlock-form") return;
  e.preventDefault();
  key = $("pass").value;
  const r = await post("/api/unlock").catch(() => ({ ok: false, status: 0 }));
  if (r.ok) { store.set(KEY, key); unlockError = ""; }
  else { key = null; unlockError = r.status === 401 ? "That passphrase didn't work." : "Couldn't reach the server. Try again."; }
  render();
});

// ---- This week ----
const FILTERS = [
  ["all", "All", () => true],
  ["open", "Open", (g) => isOpen(g, now())],
  ["picked", "Picked", (g) => !!S.picks[g.id]],
  ["acc", "ACC", (g) => g.homeConf === "ACC" || g.awayConf === "ACC"],
  ["top25", "Model top 25", (g) => (g.homeRank ?? 999) <= 25 || (g.awayRank ?? 999) <= 25],
  ["ap", "AP top 25", (g) => !!(g.homeAp || g.awayAp)],
];

function gameCard(g) {
  const t = now();
  const locked = !isOpen(g, t);
  const yours = S.picks[g.id]?.side;
  const c = cover(g);
  const o = outcome(yours, g);
  const final = c != null;
  const busy = saving.has(g.id);
  const sideBtn = (side) => {
    const r = side === "home" ? g.homeRank : g.awayRank;
    const ap = side === "home" ? g.homeAp : g.awayAp;
    const record = side === "home" ? g.homeRecord : g.awayRecord;
    const where = side === "home" ? (g.neutral ? "Neutral site" : "Home") : "Away";
    // A 0-0 record says nothing, so it's left off (week 0/1).
    const info = [record && record !== "0-0" ? record.replace("-", "–") : "", r ? `Model #${r}` : "", where].filter(Boolean).join(" · ");
    const pts = final ? `<span class="pts">${side === "home" ? g.homePts : g.awayPts}</span>` : "";
    return `<button type="button" class="side${busy && yours === side ? " saving" : ""}" data-game="${g.id}" data-side="${side}"
        aria-pressed="${yours === side}" ${locked || !unlocked() || busy ? "disabled" : ""}>
        <span class="team">${ap ? `<span class="ap">#${ap}</span> ` : ""}${esc(teamOf(g, side))}<small>${esc(info)}</small></span>
        <span>${pts}<span class="ln">${lineFor(g, side)}</span></span></button>`;
  };
  // The Model's and the bots' picks stay hidden until you've picked (or the game locks), so they
  // can't do your homework. Visitors who can't pick see everything.
  const reveal = yours || locked || !unlocked();
  const m = g.modelMargin;
  const take = `${teamOf(g, g.modelPick)} ${lineFor(g, g.modelPick)}`;
  let foot;
  if (errors[g.id]) foot = `<span class="err" role="alert">${esc(errors[g.id])}</span>`;
  else if (!reveal) foot = `<span>Pick a side to see the Model's and the bots' picks.</span>`;
  else {
    const verdict = yours ? `<span class="verdict ${yours === g.modelPick ? "agree" : "fade"}">${yours === g.modelPick ? "You agree" : "You're fading the Model"}</span>` : "";
    const result = final ? `<b>${c === "push" ? "Push" : `${esc(teamOf(g, c))} covered`}.</b> ` : "";
    foot = `<span>${result}The Model has ${Math.abs(m) < 0.05 ? "it even" : `${esc(m > 0 ? g.home : g.away)} by ${Math.abs(m).toFixed(1)}`}, so it takes <b>${esc(take)}</b>.</span>${verdict}`;
  }
  const who = reveal
    ? `<div class="who" aria-label="Who picked each side">${["away", "home"].map((s) =>
        `<div>${PLAYERS.filter((p) => p.id !== "you" && p.pick(g, S.picks) === s).map(chip).join("")}</div>`).join("")}</div>`
    : "";
  const state = final && yours ? { win: ["Won", "win"], loss: ["Lost", "loss"], push: ["Push", "locked"] }[o]
    : final ? ["Final", "locked"]
    : locked ? [yours ? "Locked" : "Locked · no pick", "locked"]
    : yours ? ["Picked", "picked"] : ["Open", ""];
  return `<li class="game${locked ? " locked" : ""}">
    <div class="game-top"><span>${esc(kick(g.start))}</span><span class="state ${state[1]}">${state[0]}</span></div>
    <div class="sides">${sideBtn("away")}${sideBtn("home")}</div>
    ${who}
    <div class="game-foot">${foot}</div>
  </li>`;
}

function renderWeek() {
  const all = gamesOf(S.week);
  const withLine = all.filter(lined);
  const noLine = all.filter((g) => !lined(g) && !cover(g));
  const t = now();
  const open = withLine.filter((g) => isOpen(g, t));
  const pickedOpen = open.filter((g) => S.picks[g.id]).length;
  const nextLock = open.map((g) => g.start).sort()[0];
  const f = FILTERS.find((x) => x[0] === filter) ?? FILTERS[0];
  const shown = withLine.filter(f[2]);

  // Group by day in ET.
  const days = [];
  for (const g of shown) {
    const d = dayName(g.start);
    if (days.at(-1)?.d !== d) days.push({ d, games: [] });
    days.at(-1).games.push(g);
  }
  const freeze = all.length ? Math.min(...all.map((g) => freezeTime(g.start))) : null;
  const lineAt = withLine.map((g) => g.lineAt).sort()[0];
  const intro = withLine.length
    ? `Lines are frozen from cfb-picks' ${esc(kick(lineAt))} odds snapshot (median of US sportsbooks). Pick any games you like; each locks at kickoff${nextLock ? `, the next at ${esc(kick(nextLock))}` : ""}.`
    : freeze && freeze > t
      ? `Lines freeze <b>${esc(dayName(freeze))}, 10 AM ET</b>, from cfb-picks' Tuesday odds snapshot. Games show up here once they have a line.`
      : `No lines yet this week. They come from cfb-picks' odds snapshots; this page checks every hour.`;

  $("view-week").innerHTML = `
    <div class="view-head"><h2>Week ${S.week}</h2>
      <p>${withLine.length ? `<b class="num">${pickedOpen}</b> picked of ${open.length} open games` : `${all.length} games`}</p></div>
    <p class="note">${intro}</p>
    ${withLine.length ? `<div class="filters" role="group" aria-label="Show">${FILTERS.map(([id, label, fn]) =>
      `<button type="button" data-filter="${id}" aria-pressed="${id === f[0]}">${label}<span>${withLine.filter(fn).length}</span></button>`).join("")}</div>` : ""}
    ${days.map((x) => `<h3 class="day">${esc(x.d)}</h3><ul class="sheet">${x.games.map(gameCard).join("")}</ul>`).join("")}
    ${withLine.length && !shown.length ? `<p class="empty">No games match <b>${esc(f[1])}</b>.</p>` : ""}
    ${noLine.length ? `<details class="noline"${withLine.length ? "" : " open"}><summary>${withLine.length ? `No line yet (${noLine.length})` : `This week's games (${noLine.length})`}</summary>
      <ul>${noLine.map((g) => `<li>${esc(g.away)} at ${esc(g.home)} · ${esc(kick(g.start))}</li>`).join("")}</ul>
      <p class="note">A game joins the board when an odds snapshot after its freeze time has a line for it. Some small-conference games never get one.</p></details>` : ""}`;
}

document.addEventListener("click", async (e) => {
  const fb = e.target.closest("[data-filter]");
  if (fb) { filter = fb.dataset.filter; store.set(FILTER_KEY, filter); renderWeek(); document.querySelector(`[data-filter="${filter}"]`)?.focus(); return; }
  if (e.target.id === "lock") { key = null; store.set(KEY, null); render(); return; }
  const b = e.target.closest(".side");
  if (!b || b.disabled) return;
  const id = Number(b.dataset.game), side = b.dataset.side;
  const before = S.picks[id];
  const next = before?.side === side ? null : side; // tapping your pick again clears it
  if (next) S.picks[id] = { side: next, at: new Date().toISOString() }; else delete S.picks[id];
  delete errors[id];
  saving.add(id);
  render();
  const r = await post("/api/pick", { game: id, side: next }).catch(() => ({ ok: false, status: 0, data: {} }));
  saving.delete(id);
  if (!r.ok) {
    if (before) S.picks[id] = before; else delete S.picks[id];
    if (r.status === 401) { key = null; store.set(KEY, null); unlockError = "The passphrase changed. Enter it again."; }
    errors[id] = r.data?.error ? `Not saved: ${r.data.error}.` : "Not saved: couldn't reach the server.";
  }
  render();
  document.querySelector(`.side[data-game="${id}"][data-side="${side}"]`)?.focus();
});

// ---- Standings ----
function chart(st) {
  // Games above .500 after each week, on your games. You and the Model are colored; the bots stay gray.
  const W = 640, H = 240, L = 34, R = 92, T = 12, B = 26;
  const series = st.rows.map((x) => {
    let net = 0;
    return { p: x.p, pts: [0, ...st.weeks.map((w) => (net += x.byWeek[w].w - x.byWeek[w].l))] };
  });
  const all = series.flatMap((s) => s.pts);
  const lo = Math.min(-2, ...all), hi = Math.max(2, ...all);
  const step = hi - lo > 24 ? 8 : hi - lo > 12 ? 4 : 2;
  const y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step;
  const x = (i) => L + (i / st.weeks.length) * (W - L - R);
  const y = (v) => T + ((y1 - v) / (y1 - y0)) * (H - T - B);
  let g = "";
  for (let v = y0; v <= y1; v += step) {
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="${v === 0 ? 1.5 : 1}" ${v === 0 ? "" : 'stroke-dasharray="2 4"'}/>`;
    g += `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v > 0 ? "+" : ""}${v}</text>`;
  }
  st.weeks.forEach((wk, i) => (g += `<text x="${x(i + 1)}" y="${H - 8}" text-anchor="middle">W${wk}</text>`));
  const key = (s) => s.p.id === "you" || s.p.id === "model";
  const path = (s) => s.pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  for (const s of [...series].sort((a, b) => key(a) - key(b))) {
    g += `<path d="${path(s)}" fill="none" stroke="var(--${key(s) ? s.p.id : "friend"})" stroke-width="${key(s) ? 2.5 : 1.5}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  // End labels: you and the Model by name; the bots are in the table.
  const ends = series.filter(key).map((s) => ({ s, v: s.pts.at(-1) }));
  if (Math.abs(y(ends[0].v) - y(ends[1].v)) < 14) {
    const [a, b] = [...ends].sort((p, q) => q.v - p.v);
    a.dy = -7; b.dy = 7;
  }
  for (const e of ends) {
    const cx = x(st.weeks.length), cy = y(e.v);
    g += `<circle cx="${cx}" cy="${cy}" r="4.5" fill="var(--${e.s.p.id})" stroke="var(--panel)" stroke-width="2"/>`;
    g += `<text class="lbl" x="${cx + 9}" y="${cy + 4 + (e.dy ?? 0)}" fill="var(--ink)">${e.s.p.id === "you" ? "You" : "Model"} ${e.v > 0 ? "+" : ""}${e.v}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Games above .500 by week on your picks. ${esc(series.map((s) => `${s.p.name} ${s.pts.at(-1)}`).join(", "))}.">${g}</svg>`;
}

function renderStandings() {
  const st = standings(S.games, S.picks);
  const graded = st.rows[0].r.w + st.rows[0].r.l + st.rows[0].r.p;
  if (!graded) {
    $("view-standings").innerHTML = `<div class="view-head"><h2>Standings</h2></div>
      <p class="empty"><b>Nothing graded yet.</b> Standings start once one of your picks goes final. Everyone is graded on the games you pick.</p>`;
    return;
  }
  const rows = [...st.rows].sort((a, b) => b.pct - a.pct || b.r.w - a.r.w);
  rows.forEach((x, i) => (x.rank = i && x.pct === rows[i - 1].pct && x.r.w === rows[i - 1].r.w ? rows[i - 1].rank : i + 1));
  const body = rows.map((x) => `<tr class="${x.p.id === "you" ? "is-you" : x.p.id === "model" ? "is-model" : ""}">
      <td class="num">${x.rank}</td>
      <td class="l"><span class="pname">${avatar(x.p)}<span><b>${esc(x.p.name)}</b><small>${esc(x.p.style)}</small></span></span></td>
      <td class="num">${rec(x.r)}</td>
      <td class="num">${(x.pct * 100).toFixed(1)}%</td>
      <td class="num">${x.net > 0 ? "+" : ""}${x.net}</td>
      <td class="num">${x.beatModel == null ? "–" : `${x.beatModel} of ${st.weeks.length}`}</td>
    </tr>`).join("");
  $("view-standings").innerHTML = `
    <div class="view-head"><h2>Standings</h2><p>On your ${graded} graded picks · ${st.weeks.length} week${st.weeks.length === 1 ? "" : "s"}</p></div>
    <div class="panel chart">
      <ul class="legend"><li class="you"><i></i>You</li><li class="model"><i></i>The Model</li><li><i></i>Bots (${rows.length - 2})</li></ul>
      ${chart(st)}
      <p class="note" style="margin:6px 0 0">Games above .500: covers minus misses, added up week by week. Pushes count for neither.</p>
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>#</th><th class="l">Player</th><th>Record</th><th>Win %</th><th>+/−</th><th>Beat the Model</th></tr></thead>
      <tbody>${body}</tbody></table></div>
    <p class="note">Everyone is graded on the games you picked, at the same frozen lines. <b>Beat the Model</b> counts the weeks a player
      covered more of those games than the Model did. Fade the Model's record is the Model's flipped, apart from pushes.
      Picking against the spread at standard −110 prices needs about 52.4% to break even.</p>`;
}

// ---- Results ----
function renderResults() {
  const pickedWeeks = [...new Set(S.games.filter((g) => S.picks[g.id] && lined(g)).map((g) => g.week))].sort((a, b) => a - b);
  if (!pickedWeeks.length) {
    $("view-results").innerHTML = `<div class="view-head"><h2>Results</h2></div>
      <p class="empty"><b>No picks yet.</b> Every pick you make shows up here next to the Model's and the bots', game by game.</p>`;
    return;
  }
  if (!pickedWeeks.includes(shownWeek)) shownWeek = pickedWeeks.at(-1);
  const t = now();
  const list = gamesOf(shownWeek).filter((g) => S.picks[g.id] && lined(g));
  const cell = (p, g) => {
    // Other players' picks on a game you can still change stay hidden, same as on the board.
    if (p.id !== "you" && isOpen(g, t) && unlocked()) return `<span class="pk">·</span>`;
    const s = p.pick(g, S.picks), o = outcome(s, g);
    const mk = { win: "✓", loss: "✗", push: "=" }[o] ?? "";
    return `<span class="pk ${o === "open" ? "" : o}"><span class="mk" aria-hidden="true">${mk}</span>${esc(abbrOf(g, s))}<span class="visually-hidden"> ${o === "open" ? "not final" : o}</span></span>`;
  };
  const rows = list.map((g) => {
    const c = cover(g);
    return `<tr>
      <td class="g"><b>${esc(abbrOf(g, "away"))} ${g.awayPts ?? ""} @ ${esc(abbrOf(g, "home"))} ${g.homePts ?? ""}</b>
        <small>${esc(g.home)} ${signed(g.line)} · ${c ? (c === "push" ? "Push" : `${esc(teamOf(g, c))} covered`) : esc(kick(g.start))}</small></td>
      ${PLAYERS.map((p) => `<td class="c">${cell(p, g)}</td>`).join("")}</tr>`;
  }).join("");
  const totals = PLAYERS.map((p) => list.filter((g) => outcome(p.pick(g, S.picks), g) === "win").length);
  const complete = list.every((g) => cover(g));
  const top = Math.max(...totals);
  // Lone calls: a right pick that only one player made.
  const lone = complete ? list.flatMap((g) => {
    const right = PLAYERS.filter((p) => outcome(p.pick(g, S.picks), g) === "win");
    return right.length === 1 ? [`<p>${chip(right[0])} was the only one on <b>${esc(teamOf(g, cover(g)))} ${lineFor(g, cover(g))}</b> (${esc(g.away)} at ${esc(g.home)}).</p>`] : [];
  }) : [];
  $("view-results").innerHTML = `
    <div class="view-head"><h2>Results</h2><p>Your games, everyone's picks</p></div>
    <div class="weeks" role="group" aria-label="Week">${pickedWeeks.map((w) => `<button type="button" data-week="${w}" aria-pressed="${w === shownWeek}">${w}</button>`).join("")}</div>
    <div class="tbl-wrap grid"><table class="grid">
      <thead><tr><th class="l g">Week ${shownWeek}</th>${PLAYERS.map((p) => `<th class="p">${avatar(p)}<br>${esc(p.id === "model" ? "Model" : p.name)}</th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td class="g">${complete ? "Covers" : "Covers so far"}</td>${totals.map((n) => `<td class="${complete && n === top ? "top" : ""}">${n}${complete && n === top ? " ★" : ""}</td>`).join("")}</tr></tfoot>
    </table></div>
    <div class="callouts note">${complete ? `<p>★ marks the week's most covers${totals.filter((n) => n === top).length > 1 ? " (tied)" : ""}.</p>` : `<p>Week ${shownWeek} isn't final yet.${unlocked() ? " The others' picks on games you can still change show at kickoff." : ""}</p>`}${lone.join("")}</div>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(".weeks button");
  if (b) { shownWeek = Number(b.dataset.week); renderResults(); document.querySelector(`.weeks button[data-week="${shownWeek}"]`)?.focus(); }
});

// ---- Footer ----
function renderFoot() {
  $("foot").innerHTML = `
    <p>Games, scores and the Model's margins come from <a href="https://mattrudy13.github.io/cfb-picks/">cfb-picks</a> (FBS vs FBS only);
      AP ranks from ESPN, as of kickoff.
      Each line is frozen once a week from cfb-picks' Tuesday 10 AM ET odds snapshot, and the Model's pick is locked with it.</p>
    <p>Scores updated ${esc(ago(S.dataAt))} · last checked ${esc(ago(S.syncedAt))}.${unlocked()
      ? ` <button type="button" class="btn link" id="sync"${syncNote === "Checking…" ? " disabled" : ""}>Check now</button>
        <span role="status">${esc(syncNote)}</span>` : ""}</p>`;
}

// The Worker syncs hourly; "Check now" runs the same sync right away (passphrase holder only).
document.addEventListener("click", async (e) => {
  if (e.target.id !== "sync") return;
  syncNote = "Checking…";
  renderFoot();
  // Two calls because the Worker runs the AP poll separately (CPU limit); AP ranks failing isn't worth an error.
  const r = await post("/api/sync").catch(() => ({ ok: false, status: 0, data: {} }));
  if (r.ok) await post("/api/sync-ap").catch(() => {});
  if (r.ok) {
    syncNote = r.data.frozen ? `Done: ${r.data.frozen} new line${r.data.frozen === 1 ? "" : "s"}.` : "Done.";
    await load().catch(() => {});
  } else {
    syncNote = r.status === 401 ? "The passphrase changed. Lock and unlock again." : "Couldn't sync. Try again in a minute.";
    renderFoot();
  }
  $("sync")?.focus();
});

// ---- Views (each has its own #link) ----
function show() {
  const v = ["week", "standings", "results"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "week";
  for (const s of document.querySelectorAll("main > section")) s.hidden = s.dataset.view !== v;
  for (const a of document.querySelectorAll(".tabs a")) if (a.dataset.view === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
}
window.addEventListener("hashchange", show);

function render() {
  if (!S) return;
  $("season").textContent = `${S.season} season · Week ${S.week}`;
  renderUnlock();
  renderRace();
  renderWeek();
  renderStandings();
  renderResults();
  renderFoot();
  show();
}

// Games lock at kickoff while the page is open: re-render when one passes. Refresh scores every 5 minutes.
let openCount = -1;
setInterval(() => {
  if (!S) return;
  const n = S.games.filter((g) => isOpen(g, now())).length;
  if (n !== openCount) { openCount = n; if (!saving.size) render(); }
}, 30e3);
setInterval(() => { if (document.visibilityState === "visible" && !saving.size) load().catch(() => {}); }, 5 * 60e3);

show();
load().catch((err) => {
  console.error(err);
  $("view-week").innerHTML = `<p class="empty"><b>Couldn't load the board.</b> The server didn't answer; try again in a minute.</p>`;
});
