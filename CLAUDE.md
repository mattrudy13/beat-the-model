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
- The board shows two ranks: the AP poll ("#9" before the name, from ESPN) and cfb-picks' power rank
  ("Model #12"). The `home_rank`/`away_rank` columns are the Model's; `home_ap`/`away_ap` are the AP poll.
- AP ranks come from ESPN's site API rankings feed (`site.api.espn.com/.../rankings`, no key), matched on
  ESPN's team `location`, which equals cfb-picks' team name for all 138 FBS teams (2026). ESPN's smaller
  core API (`sports.core.api.espn.com`) returns 403 to Cloudflare whatever the headers, so don't switch.
- The feed is ~550 KB, so the AP poll runs on its own cron (:50, `AP_CRON`), never inside the :35 sync:
  that one already uses ~11 ms of CPU (2026-10-27, the free tier's limit is 10 ms) and a CPU kill there
  would stop scores and line freezes. If ESPN fails, only the :50 run fails; old AP ranks stay.
- AP ranks update until kickoff, then stay as they were for that game. Records are the record going into
  the game (recomputed every run, so a corrected score fixes them).
- The Worker depends on cfb-picks' JSON shape (`games[].modelMargin`, `homeFbs`, `teams[].abbr/conference`,
  `ratings[].rank`, `odds.games[id].spread.median`, `byBook.draftkings.homeLine`, `takenAt`). If cfb-picks
  changes those, the cron throws and the Cloudflare dashboard logs show why.
- New season: set `SEASON` and `START_WEEK` in `worker/wrangler.toml` and redeploy.
- `?api=`/`?now=` overrides are ignored off localhost on purpose, so a crafted link can't send the
  passphrase to another server.
- Free-tier limits that matter: Workers 10 ms CPU per run (parsing cfb-picks' ~450 KB JSON is the
  biggest cost), D1 100k writes/day (the cron only writes changed rows).
