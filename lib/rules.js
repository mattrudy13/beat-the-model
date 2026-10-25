// The game's rules, shared by the Worker (freezing lines, locking picks) and the page (grading, bots,
// standings), so the two can never disagree. Plain ES module with no dependencies; tests in test/.
//
// Sign convention (same as cfb-picks): `line` is the home team's spread, negative = home favored.
// Home covers when home points − away points + line > 0.

const ET = "America/New_York";
const HOUR = 3600e3;

// Minutes ET is offset from UTC at a moment (−240 in summer, −300 in winter).
function etOffset(ms) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: ET, timeZoneName: "shortOffset" })
    .formatToParts(ms).find((p) => p.type === "timeZoneName").value; // "GMT-4"
  const m = name.match(/GMT([+-]\d+)(?::(\d+))?/);
  return m ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] ?? 0) : 0;
}

function etWall(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: ET, year: "numeric", month: "numeric", day: "numeric", weekday: "short",
  }).formatToParts(ms).map((p) => [p.type, p.value]));
  return { y: +parts.year, m: +parts.month, d: +parts.day, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday) };
}

// A wall-clock time in ET as a UTC timestamp. The offset is read at the guessed moment, which is
// right everywhere except the hour DST changes (2 AM Sunday), and nothing here happens then.
function etTime(y, m, d, hour) {
  const guess = Date.UTC(y, m - 1, d, hour);
  return guess - etOffset(guess) * 60e3;
}

// When a game's line freezes: the last Tuesday 10 AM ET at or before kickoff. That's cfb-picks'
// Tuesday odds snapshot, after the weekend's results are in the ratings and before any game of the week.
export function freezeTime(start) {
  const ms = Date.parse(start);
  const { y, m, d, wd } = etWall(ms);
  let t = etTime(y, m, d - ((wd - 2 + 7) % 7), 10);
  if (t > ms) t = etTime(y, m, d - ((wd - 2 + 7) % 7) - 7, 10); // a Tuesday game before 10 AM
  return t;
}

// If the Tuesday snapshot never runs (GitHub skips or delays scheduled runs, by 4+ hours at times), freeze
// from the newest snapshot there is: 3 hours before kickoff for midweek games, Wednesday afternoon for the rest.
export const fallbackTime = (start) => Math.min(freezeTime(start) + 30 * HOUR, Date.parse(start) - 3 * HOUR);

// Should this game's line freeze now, from this odds snapshot? Never after kickoff, never twice.
export function shouldFreeze({ start, line }, oddsGame, oddsTakenAt, now = Date.now()) {
  if (line != null || !oddsGame?.spread || oddsGame.spread.median == null) return false;
  if (now >= Date.parse(start)) return false;
  return Date.parse(oddsTakenAt) >= freezeTime(start) || now >= fallbackTime(start);
}

// The sheet line from a snapshot: the median of the US books. A median of an even number of books
// can land on a quarter point (−3.75); then DraftKings' number is used, or the median rounded toward zero.
export function sheetLine(oddsGame) {
  const med = oddsGame.spread.median;
  if (Number.isInteger(med * 2)) return med;
  const dk = oddsGame.byBook?.draftkings?.homeLine;
  if (dk != null && Number.isInteger(dk * 2)) return dk;
  return Math.trunc(med * 2) / 2;
}

// The Model plays like everyone else: it takes the side its margin likes against the sheet line.
// cfb-picks' own v3 picks shrink that gap toward the market but never flip the side, so this is
// the same lean; cfb-picks just only posts the games where the shrunk gap clears its threshold.
export const modelSide = (modelMargin, line) => (modelMargin + line > 0 ? "home" : "away");

export const other = (side) => (side === "home" ? "away" : "home");
export const favorite = (g) => (g.line <= 0 ? "home" : "away"); // a pick'em goes to the home team

// Which side covered, once the game is final: "home", "away", "push", or null if not final.
export function cover(g) {
  if (!g.completed || g.homePts == null || g.awayPts == null || g.line == null) return null;
  const m = g.homePts - g.awayPts + g.line;
  return m > 0 ? "home" : m < 0 ? "away" : "push";
}

// Same 0–1 number for a game every time, so the coin flip never changes its mind.
function coin(id) {
  let h = 2166136261;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 2 ** 32;
}

const isAcc = (conf) => conf === "ACC";

// The bots: each a fixed rule anyone could follow. `pick(g)` returns "home" or "away".
export const BOTS = [
  { id: "chalk", name: "Chalk", code: "CH", style: "Always takes the favorite", pick: (g) => favorite(g) },
  { id: "dog", name: "Underdog", code: "UD", style: "Always takes the underdog", pick: (g) => other(favorite(g)) },
  { id: "home", name: "Home Team", code: "HT", style: "Always takes the home team", pick: () => "home" },
  {
    id: "acc", name: "ACC Homer", code: "AC", style: "Takes the ACC side, else Virginia, else the favorite",
    pick: (g) => {
      if (isAcc(g.homeConf) !== isAcc(g.awayConf)) return isAcc(g.homeConf) ? "home" : "away";
      if (g.home === "Virginia" || g.away === "Virginia") return g.home === "Virginia" ? "home" : "away";
      return favorite(g);
    },
  },
  { id: "fade", name: "Fade the Model", code: "FM", style: "Always takes the side the Model doesn't", pick: (g) => other(g.modelPick) },
  { id: "coin", name: "Coin Flip", code: "CF", style: "Flips a coin every game", pick: (g) => (coin(g.id) < 0.5 ? "home" : "away") },
];

// Everyone who plays, you first. `pick(g, picks)` is that player's side, or undefined.
export const PLAYERS = [
  { id: "you", name: "You", code: "Y", style: "Your picks", pick: (g, picks) => picks[g.id]?.side },
  { id: "model", name: "The Model", code: "M", style: "cfb-picks' ratings: the side its margin likes", pick: (g) => g.modelPick },
  ...BOTS,
];

// Can a pick on this game still be made or changed? Only once its line is frozen, and only before kickoff.
export const isOpen = (g, now = Date.now()) => g.line != null && now < Date.parse(g.start);

// "win" | "loss" | "push" | "open" (not final yet) | "none" (no pick).
export function outcome(side, g) {
  if (!side) return "none";
  const c = cover(g);
  if (!c) return "open";
  return c === "push" ? "push" : side === c ? "win" : "loss";
}

// Records on the games you picked: everyone is graded on that same set, so "beat the Model" is a
// head-to-head. Returns one row per player with the season record and covers per week.
export function standings(games, picks) {
  const mine = games.filter((g) => picks[g.id] && g.line != null);
  const weeks = [...new Set(mine.filter((g) => cover(g)).map((g) => g.week))].sort((a, b) => a - b);
  const rows = PLAYERS.map((p) => {
    const r = { w: 0, l: 0, p: 0 };
    const byWeek = Object.fromEntries(weeks.map((w) => [w, { w: 0, l: 0, p: 0 }]));
    for (const g of mine) {
      const o = outcome(p.pick(g, picks), g);
      if (o !== "win" && o !== "loss" && o !== "push") continue;
      const k = o[0];
      r[k]++;
      byWeek[g.week][k]++;
    }
    return { p, r, byWeek };
  });
  const model = rows.find((x) => x.p.id === "model");
  for (const x of rows) {
    x.net = x.r.w - x.r.l;
    x.pct = winPct(x.r);
    // Weeks this player covered more of your games than the Model did.
    x.beatModel = x.p.id === "model" ? null : weeks.filter((w) => x.byWeek[w].w > model.byWeek[w].w).length;
  }
  return { weeks, rows };
}

export const winPct = (r) => (r.w + r.l + r.p ? (r.w + r.p / 2) / (r.w + r.l + r.p) : 0);

// The headline numbers (the page's race summary and the hub tile): you vs the Model on your games,
// your rank among all players, the Model on every game with a line, and this week's open games.
export function summary(games, picks, week, now = Date.now()) {
  const { rows } = standings(games, picks);
  const you = rows.find((x) => x.p.id === "you"), model = rows.find((x) => x.p.id === "model");
  const sorted = [...rows].sort((a, b) => b.pct - a.pct || b.r.w - a.r.w);
  const rank = 1 + sorted.filter((x) => x.pct > you.pct || (x.pct === you.pct && x.r.w > you.r.w)).length;
  const board = { w: 0, l: 0, p: 0 };
  for (const g of games) {
    const o = g.line == null ? "none" : outcome(g.modelPick, g);
    if (o === "win" || o === "loss" || o === "push") board[o[0]]++;
  }
  const open = games.filter((g) => g.week === week && isOpen(g, now));
  return {
    you: you.r, model: model.r, graded: you.r.w + you.r.l + you.r.p, rank, players: rows.length,
    leader: { id: sorted[0].p.id, name: sorted[0].p.name, pct: sorted[0].pct }, board,
    week, open: open.length, pickedOpen: open.filter((g) => picks[g.id]).length,
    nextLock: open.map((g) => g.start).sort()[0] ?? null,
  };
}
