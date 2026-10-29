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

## Decisions (Rudy, 2026-10-27)

- **Team info on the board**: AP rank before the name, TV style ("#9 Ole Miss"); the small line is
  "7–1 · Model #12 · Home". Overall record only (no conference record), FCS games included, hidden at 0–0.
- **Filters**: "AP top 25" added next to "Model top 25" (both kept).
- **Manual sync**: "Check now" in the footer, only for the passphrase holder, so visitors can't trigger syncs.
- **Workflow**: one PR per change; Rudy approves each Worker deploy and merge in chat (auto mode blocks a
  production deploy without that).

## Decisions (Rudy, 2026-10-29)

- **Keep cfb-picks as its own site, linked to this one** (not merged): cfb-picks is the recruiter-facing
  track record and research pages; this is the personal game. Each card gets a "Best Bet" tag where cfb-picks
  posted a pick, and links to both teams' cfb-picks pages.
- (Assumed, not asked) The tag and links follow the same hide-until-you-pick rule as the Model's pick, so they
  don't do the homework.

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
- The feed is ~550 KB, so the AP poll runs on its own cron (:50), never inside the :35 sync, where a CPU
  kill would stop scores and line freezes. If ESPN fails, only the :50 run fails; old AP ranks stay.
  `AP_CRON` in `src/index.js` must match the second cron string in `wrangler.toml`, or the :50 run does the
  :35 sync instead.
- AP ranks update until kickoff, then stay as they were for that game. Records are the record going into
  the game (recomputed every run, so a corrected score fixes them).
- The Worker depends on cfb-picks' JSON shape (`games[].modelMargin`, `start`, `completed`, `homePoints`/
  `awayPoints`, `homeFbs`, `teams[].abbr/conference`, `ratings[].rank`, `odds.games[id].spread.median`,
  `byBook.draftkings.homeLine`, `takenAt`) and ESPN's (`rankings[]` with `type: "ap"`, `season.year`,
  `ranks[].current`, `ranks[].team.location`). If either changes, that cron throws and the logs show why.
- The page (not the Worker) reads cfb-picks' `data/picks-<season>.json` for the Best Bet tag: `weeks.*.picks[]`
  with `gameId`, `model`, `takenAt`, `shadow`, `cat`, `team`, `line` (the pick team's own line) and `result`.
  Same "current model = the newest pick's" rule as the hub. If it fails to load, the board shows without tags.
- Schema changes: add a file to `worker/migrations/`, update `schema.sql` to match, and run the migration
  on the live database **before** deploying the Worker that uses it; the other way round, the :35 cron
  throws on the missing columns.
- New season: set `SEASON` and `START_WEEK` in `worker/wrangler.toml` and redeploy.
- `?api=`/`?now=` overrides are ignored off localhost on purpose, so a crafted link can't send the
  passphrase to another server.
- Free-tier limits that matter: Workers 10 ms CPU per run, D1 100k writes/day (the syncs only write
  changed rows). Measured 2026-10-27 with `wrangler tail`: the :35 sync 11 ms (cron) to 19 ms (Check now),
  almost all of it parsing cfb-picks' ~450 KB JSON; the :50 AP run 9 ms. The :35 run is over the documented
  limit, but Cloudflare hasn't cut it off. If the logs ever show "exceeded CPU", the fix is a slim file from
  cfb-picks with just the fields above, not more work in the Worker.
- Debugging: `npx wrangler@4 tail --format json` streams each run's logs, outcome and `cpuTime`. Wrangler
  can't trigger a deployed cron, so either use Check now (needs the passphrase) or wait for :35/:50.
  `npx wrangler@4 dev --remote` runs a throwaway Worker on Cloudflare's network, useful for testing what an
  outside API returns to Cloudflare (that's how the ESPN 403 was confirmed).
