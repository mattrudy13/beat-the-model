# CLAUDE.md

Project notes for Claude Code. README.md has the rules and commands; this file has the decisions and
the things that are easy to get wrong.

## Decisions (Rudy, 2026-10-24)

- **Solo**: Rudy against the Model and six bots. No friends/accounts. Anyone can view; only the passphrase
  holder can pick.
- **Hosting**: GitHub Pages (`mattrudy13/beat-the-model`, `main` at the root) + Cloudflare Worker + D1, so
  picks sync between phone and laptop. Not on the recruiter portfolio; the hub has a tile.
- **One frozen line** per game (Tuesday 10 AM ET snapshot, median of US books). Everyone is graded on it.
- **Any games**: the whole FBS board, pick as many as you like.
- **Scoring**: the Model and the bots are graded only on the games Rudy picked.
- Starts at week 9 of 2026 (`START_WEEK`). No backfilled history.

## Things to keep straight

- `lib/rules.js` is used by both the page and the Worker (wrangler bundles `../../lib/rules.js`). A rules
  change affects locking and grading together. Run `npm test` and redeploy the Worker.
- The Worker writes a game's `line`, `model_margin` and `model_pick` once (`WHERE line IS NULL`). Don't
  rewrite frozen lines or past picks; fix them with an explicit, separate change if ever needed.
- Sign convention matches cfb-picks: `line` is the home spread, negative = home favored; home covers when
  `homePts − awayPts + line > 0`.
- Ranks shown on the board are cfb-picks' power ranks ("Model #12"), not the AP poll.
- The Worker depends on cfb-picks' JSON shape (`games[].modelMargin`, `homeFbs`, `teams[].abbr/conference`,
  `ratings[].rank`, `odds.games[id].spread.median`, `byBook.draftkings.homeLine`, `takenAt`). If cfb-picks
  changes those, the cron throws and the Cloudflare dashboard logs show why.
- New season: set `SEASON` and `START_WEEK` in `worker/wrangler.toml` and redeploy.
- `?api=`/`?now=` overrides are ignored off localhost on purpose, so a crafted link can't send the
  passphrase to another server.
- Free-tier limits that matter: Workers 10 ms CPU per run (parsing cfb-picks' ~450 KB JSON is the
  biggest cost), D1 100k writes/day (the cron only writes changed rows).
