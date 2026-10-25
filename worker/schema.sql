-- Beat the Model's D1 database. Apply with:
--   npx wrangler d1 execute beat-the-model --remote --file=schema.sql

-- Games copied from cfb-picks (FBS vs FBS, from the start week on). The line, the Model's margin and
-- its pick are written once, when the line freezes, and never change after that.
CREATE TABLE IF NOT EXISTS games (
  id           INTEGER PRIMARY KEY,  -- CFBD game id, same as cfb-picks
  season       INTEGER NOT NULL,
  week         INTEGER NOT NULL,
  start        TEXT    NOT NULL,     -- kickoff, ISO UTC; picks lock here
  neutral      INTEGER NOT NULL,
  home         TEXT    NOT NULL,
  away         TEXT    NOT NULL,
  home_abbr    TEXT,
  away_abbr    TEXT,
  home_conf    TEXT,
  away_conf    TEXT,
  home_rank    INTEGER,              -- cfb-picks power rank (the Model's, not the AP poll)
  away_rank    INTEGER,
  home_pts     INTEGER,
  away_pts     INTEGER,
  completed    INTEGER NOT NULL DEFAULT 0,
  line         REAL,                 -- home spread, negative = home favored; NULL until frozen
  line_at      TEXT,                 -- when the odds snapshot it came from was taken
  books        INTEGER,              -- US books in that snapshot's median
  model_margin REAL,                 -- cfb-picks model margin (home − away) at the freeze
  model_pick   TEXT CHECK (model_pick IN ('home', 'away'))
);
CREATE INDEX IF NOT EXISTS games_season_week ON games (season, week);

-- Your picks: one row per game, changeable until kickoff (the Worker enforces it).
CREATE TABLE IF NOT EXISTS picks (
  game_id   INTEGER PRIMARY KEY REFERENCES games (id),
  side      TEXT NOT NULL CHECK (side IN ('home', 'away')),
  picked_at TEXT NOT NULL
);

-- Small key/value facts for the page: current week, when the data and odds were last read.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
