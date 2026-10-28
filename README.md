# Beat the Model

A solo college football pick'em against the spread: me against the
[cfb-picks](https://mattrudy13.github.io/cfb-picks/) model and six rule-based bots.

Live at https://mattrudy13.github.io/beat-the-model/ (from week 9 of 2026).

## How it plays

- **The board** is every FBS-vs-FBS game in the week that has a line. Pick as many or as few as you like.
- **Lines freeze once a week.** Each game's line is the median of US sportsbooks in cfb-picks' Tuesday 10 AM ET
  odds snapshot. If that median lands on a quarter point, DraftKings' number is used, or else the median
  rounded toward zero. It doesn't move after that. A game whose line first shows up later freezes from the
  first snapshot that has it. If the Tuesday snapshot never runs, lines freeze from the newest snapshot
  3 hours before kickoff (midweek games) or Wednesday 4 PM ET (the rest).
- **The Model** takes the side its cfb-picks margin likes against the frozen line, locked when the line
  freezes. cfb-picks only posts the games where its (shrunk) edge clears a threshold, but the side is the
  same.
- **Each team shows** its AP rank (if ranked, e.g. "#9 Ole Miss"), its record going into the game and the
  Model's power rank: "7–1 · Model #12 · Home". Filters: All, Open, Picked, ACC, Model top 25, AP top 25.
- **Picks lock at kickoff.** Until then you can change or clear them. The Model's and the bots' picks
  stay hidden until you pick a game or it locks.
- **Scoring:** everyone (you, the Model and the bots) is graded on *the games you picked*, at the same
  frozen line, so "beat the Model" is a true head-to-head. The Model's record on every game shows
  separately.

The bots: Chalk (favorite), Underdog, Home Team, ACC Homer (ACC side, else Virginia, else the favorite),
Fade the Model, Coin Flip (a fixed flip per game).

## How it's built

- `index.html`, `app.js`, `style.css`: the page (GitHub Pages, no build step). It reads everything from the Worker.
- `lib/rules.js`: the rules (freeze time, sheet line, Model side, covers, bots, standings), shared by the
  page and the Worker. Tests: `npm test` (Node's built-in `node:test`).
- `worker/`: a Cloudflare Worker with a D1 database (`beat-the-model`).
  - Hourly cron (:35): copies games and scores from cfb-picks' published `data/<season>.json` and freezes
    lines from `data/odds-<season>.json`. It also stores each team's record going into the game (from
    cfb-picks' games, FCS opponents included).
  - Hourly cron (:50): AP ranks from ESPN's rankings feed for games not yet kicked off, so each game keeps
    the rank it had at kickoff. Separate from :35 because of the 10 ms CPU limit.
  - Public: `GET /api/state` (everything the page needs) and `GET /api/summary` (headline numbers for the
    hub tile).
  - Need the passphrase: `POST /api/pick`, `POST /api/unlock`, and `POST /api/sync` / `POST /api/sync-ap`,
    which run the :35 and :50 syncs now. Both syncs are behind the **Check now** link in the page footer on an
    unlocked device.
  - Schema changes for the live database go in `worker/migrations/` (run once with `d1 execute --file`,
    before deploying the Worker that needs them; `schema.sql` is for a fresh database).
  - URL: https://beat-the-model.mattrudy13.workers.dev

### Commands

```sh
npm test                                              # rules and Worker helper tests
cd worker && npx wrangler@4 deploy                    # deploy the Worker
cd worker && npx wrangler@4 secret put PICK_KEY       # set or change the passphrase
cd worker && npx wrangler@4 tail --format json        # live logs, with each run's cpuTime
cd worker && npx wrangler@4 d1 execute beat-the-model --remote --command "SELECT * FROM picks"
cd worker && npx wrangler@4 d1 execute beat-the-model --remote --file=migrations/<file>.sql
```

Cloudflare can't run a deployed cron on demand from Wrangler; use **Check now** on the page, or wait for :35/:50.

Local preview: `cd worker && npx wrangler@4 dev --test-scheduled` (uses `worker/.dev.vars`: `PICK_KEY`, and
optionally `NOW` and `START_WEEK` to pretend it's another time), run the crons with
`curl "localhost:8787/__scheduled?cron=35+*+*+*+*"` and `curl "localhost:8787/__scheduled?cron=50+*+*+*+*"`
(the AP poll), then `python3 -m http.server 8000` in the repo root
and open http://localhost:8000/?api=http://localhost:8787. `?api=` and `?now=` only work on localhost.

## History

A prototype with sample data (made-up spreads and picks) was built 2026-10-23 and paused; it's kept locally
in `prototype/` (not in git). v0.1 (2026-10-24) is the real game.

- v0.2 (2026-10-27): AP rank and record going into the game on each team, and the AP top 25 filter.
- v0.3 (2026-10-27): **Check now** (manual sync); the view tabs no longer scroll vertically on phones.
- v0.4 (2026-10-27): AP ranks from ESPN's site feed on their own :50 cron (the core API refuses Cloudflare).
