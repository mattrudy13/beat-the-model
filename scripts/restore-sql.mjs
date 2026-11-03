#!/usr/bin/env node
// Turns a backup (backup/state-<season>.json, written daily by .github/workflows/backup.yml) into SQL
// that puts the games, frozen lines and picks back into D1. Rows that are still there are replaced
// with the backup's copy, so check what's missing first. Usage:
//
//   node scripts/restore-sql.mjs backup/state-2026.json > restore.sql
//   cd worker && npx wrangler d1 execute beat-the-model --remote --file=../restore.sql
//
// Games come back first because picks reference them. The Worker's next sync fills in anything newer
// than the backup (scores, kickoff changes) without touching a frozen line.

import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/restore-sql.mjs backup/state-<season>.json");
  process.exit(1);
}
const { season, games, picks } = JSON.parse(readFileSync(file, "utf8"));

const sql = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : typeof v === "boolean" ? (v ? "1" : "0") : `'${String(v).replaceAll("'", "''")}'`);

// D1 column -> the /api/state field it's served as.
const GAME_COLUMNS = {
  id: "id", week: "week", start: "start", neutral: "neutral", home: "home", away: "away",
  home_abbr: "homeAbbr", away_abbr: "awayAbbr", home_conf: "homeConf", away_conf: "awayConf",
  home_rank: "homeRank", away_rank: "awayRank", home_ap: "homeAp", away_ap: "awayAp",
  home_record: "homeRecord", away_record: "awayRecord", home_pts: "homePts", away_pts: "awayPts",
  completed: "completed", line: "line", line_at: "lineAt", books: "books",
  model_margin: "modelMargin", model_pick: "modelPick",
};

const out = [];
for (const g of games) {
  const cols = ["season", ...Object.keys(GAME_COLUMNS)];
  const vals = [season, ...Object.values(GAME_COLUMNS).map((k) => g[k])];
  out.push(`INSERT OR REPLACE INTO games (${cols.join(", ")}) VALUES (${vals.map(sql).join(", ")});`);
}
for (const [gameId, p] of Object.entries(picks)) {
  out.push(`INSERT OR REPLACE INTO picks (game_id, side, picked_at) VALUES (${Number(gameId)}, ${sql(p.side)}, ${sql(p.at)});`);
}
console.log(out.join("\n"));
console.error(`${games.length} games, ${Object.keys(picks).length} picks`);
