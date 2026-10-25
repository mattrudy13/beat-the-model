// Beat the Model's backend: a Cloudflare Worker with a D1 database.
//
// - Cron (hourly): copies this season's FBS games and scores from cfb-picks' published JSON, and
//   freezes each game's line from its odds snapshot (rules in lib/rules.js).
// - GET  /api/state:  everything the page needs (games from the start week on, your picks). Public.
// - GET  /api/summary: the headline numbers (for the hub tile), from the same rules as the page.
// - POST /api/pick:   { game, side: "home" | "away" | null }. Needs the passphrase; refused after kickoff.
// - POST /api/unlock: checks the passphrase, so the page can remember it.
//
// PICK_KEY is a secret (npx wrangler secret put PICK_KEY). Everything else is in wrangler.toml.
// For local tests only, NOW in .dev.vars pretends it's another time (like cfb-picks' NOW=<iso>).

import { shouldFreeze, sheetLine, modelSide, isOpen, summary } from "../../lib/rules.js";

const CFB = "https://mattrudy13.github.io/cfb-picks/data";
const nowOf = (env) => (env.NOW ? Date.parse(env.NOW) : Date.now());

export default {
  async scheduled(controller, env) {
    await sync(env);
  },

  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (req.method === "GET" && url.pathname === "/api/state") return json(await state(env), 200, cors);
      if (req.method === "GET" && url.pathname === "/api/summary") {
        const s = await state(env);
        return json({ season: s.season, syncedAt: s.syncedAt, ...summary(s.games, s.picks, s.week, nowOf(env)) }, 200, cors);
      }
      if (req.method === "POST" && url.pathname === "/api/unlock") {
        return (await authorized(req, env)) ? json({ ok: true }, 200, cors) : json({ error: "Wrong passphrase" }, 401, cors);
      }
      if (req.method === "POST" && url.pathname === "/api/pick") {
        if (!(await authorized(req, env))) return json({ error: "Wrong passphrase" }, 401, cors);
        return await pick(req, env, cors);
      }
      return json({ error: "Not found" }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ error: "Server error" }, 500, cors);
    }
  },
};

// ---- Cron: copy games and scores, freeze lines ----

async function getJson(path) {
  const res = await fetch(`${CFB}/${path}`, { cf: { cacheTtl: 0 } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function sync(env) {
  const season = Number(env.SEASON), startWeek = Number(env.START_WEEK);
  const [data, odds] = await Promise.all([getJson(`${season}.json`), getJson(`odds-${season}.json`)]);
  if (data.season !== season) throw new Error(`cfb-picks is on season ${data.season}, Worker on ${season}`);
  // cfb-picks' week = the earliest week with a game not final. Games are copied up to that week,
  // so the board shows next week's games as soon as this week is done, lines to come Tuesday.
  const week = Math.max(startWeek, data.week);
  const rank = Object.fromEntries(data.ratings.map((r) => [r.team, r.rank]));
  const team = (name) => data.teams[name] ?? {};

  const { results } = await env.DB.prepare("SELECT * FROM games WHERE season = ?").bind(season).all();
  const have = new Map(results.map((r) => [r.id, r]));
  const now = nowOf(env);
  const stmts = [];
  let frozen = 0;

  for (const g of data.games) {
    if (!g.homeFbs || !g.awayFbs || g.week < startWeek || g.week > week) continue;
    const old = have.get(g.id);
    const done = g.completed && g.homePoints != null && g.awayPoints != null;
    const row = {
      week: g.week, start: g.start, neutral: g.neutral ? 1 : 0,
      home_pts: done ? g.homePoints : null, away_pts: done ? g.awayPoints : null, completed: done ? 1 : 0,
    };
    if (!old) {
      stmts.push(env.DB.prepare(`INSERT INTO games (id, season, week, start, neutral, home, away, home_abbr, away_abbr,
          home_conf, away_conf, home_rank, away_rank, home_pts, away_pts, completed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        g.id, season, row.week, row.start, row.neutral, g.home, g.away,
        team(g.home).abbr ?? null, team(g.away).abbr ?? null, team(g.home).conference ?? null, team(g.away).conference ?? null,
        rank[g.home] ?? null, rank[g.away] ?? null, row.home_pts, row.away_pts, row.completed));
    } else {
      // Kickoff times move (TV picks) and scores come in; ranks are kept as they were at the freeze.
      const changed = Object.keys(row).filter((k) => old[k] !== row[k]);
      if (old.line == null) {
        if (old.home_rank !== (rank[g.home] ?? null)) { row.home_rank = rank[g.home] ?? null; changed.push("home_rank"); }
        if (old.away_rank !== (rank[g.away] ?? null)) { row.away_rank = rank[g.away] ?? null; changed.push("away_rank"); }
      }
      if (changed.length) {
        stmts.push(env.DB.prepare(`UPDATE games SET ${changed.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
          .bind(...changed.map((k) => row[k]), g.id));
      }
    }

    const o = odds.games[g.id];
    if (shouldFreeze({ start: g.start, line: old?.line ?? null }, o, odds.takenAt, now)) {
      const line = sheetLine(o);
      stmts.push(env.DB.prepare(`UPDATE games SET line = ?, line_at = ?, books = ?, model_margin = ?, model_pick = ?,
          home_rank = ?, away_rank = ? WHERE id = ? AND line IS NULL`).bind(
        line, odds.takenAt, o.spread.books ?? null, g.modelMargin, modelSide(g.modelMargin, line),
        rank[g.home] ?? null, rank[g.away] ?? null, g.id));
      frozen++;
    }
  }

  const meta = { week, dataAt: data.updated, oddsAt: odds.takenAt, syncedAt: new Date(now).toISOString() };
  for (const [k, v] of Object.entries(meta)) {
    stmts.push(env.DB.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(k, String(v)));
  }
  await env.DB.batch(stmts);
  console.log(`sync: week ${week}, ${stmts.length - 4} game writes, ${frozen} lines frozen`);
}

// ---- API ----

async function state(env) {
  const season = Number(env.SEASON);
  const [games, picks, meta] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM games WHERE season = ? ORDER BY start, id").bind(season),
    env.DB.prepare("SELECT p.* FROM picks p JOIN games g ON g.id = p.game_id WHERE g.season = ?").bind(season),
    env.DB.prepare("SELECT * FROM meta"),
  ]);
  const m = Object.fromEntries(meta.results.map((r) => [r.key, r.value]));
  return {
    season, startWeek: Number(env.START_WEEK), week: Number(m.week ?? env.START_WEEK),
    dataAt: m.dataAt ?? null, oddsAt: m.oddsAt ?? null, syncedAt: m.syncedAt ?? null,
    games: games.results.map(gameOut),
    picks: Object.fromEntries(picks.results.map((p) => [p.game_id, { side: p.side, at: p.picked_at }])),
  };
}

// D1 rows are snake_case; the page (and lib/rules.js) use camelCase.
const gameOut = (r) => ({
  id: r.id, week: r.week, start: r.start, neutral: !!r.neutral, home: r.home, away: r.away,
  homeAbbr: r.home_abbr, awayAbbr: r.away_abbr, homeConf: r.home_conf, awayConf: r.away_conf,
  homeRank: r.home_rank, awayRank: r.away_rank, homePts: r.home_pts, awayPts: r.away_pts, completed: !!r.completed,
  line: r.line, lineAt: r.line_at, books: r.books, modelMargin: r.model_margin, modelPick: r.model_pick,
});

async function pick(req, env, cors) {
  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400, cors); }
  const id = Number(body.game), side = body.side ?? null;
  if (!Number.isInteger(id) || ![null, "home", "away"].includes(side)) return json({ error: "Bad request" }, 400, cors);
  const g = await env.DB.prepare("SELECT start, line FROM games WHERE id = ? AND season = ?").bind(id, Number(env.SEASON)).first();
  if (!g) return json({ error: "No such game" }, 404, cors);
  if (!isOpen(g, nowOf(env))) return json({ error: g.line == null ? "This game's line isn't set yet" : "This game has kicked off" }, 409, cors);
  if (side) {
    await env.DB.prepare(`INSERT INTO picks (game_id, side, picked_at) VALUES (?, ?, ?)
      ON CONFLICT (game_id) DO UPDATE SET side = excluded.side, picked_at = excluded.picked_at`)
      .bind(id, side, new Date(nowOf(env)).toISOString()).run();
  } else {
    await env.DB.prepare("DELETE FROM picks WHERE game_id = ?").bind(id).run();
  }
  return json({ ok: true, game: id, side }, 200, cors);
}

// Compares SHA-256 digests so the check takes the same time whatever the guess.
async function authorized(req, env) {
  const given = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  if (!env.PICK_KEY || !given) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, env.PICK_KEY].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://mattrudy13.github.io",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
