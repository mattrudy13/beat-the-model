import test from "node:test";
import assert from "node:assert/strict";
import { recordsBefore, apRanks } from "../worker/src/index.js";

test("a record counts only games finished before kickoff", () => {
  const games = [
    // Listed out of order on purpose: records follow kickoff time, not file order.
    { id: 3, start: "2026-09-19T16:00:00Z", home: "Virginia", away: "Duke", completed: false, homePoints: null, awayPoints: null },
    { id: 1, start: "2026-09-05T16:00:00Z", home: "Virginia", away: "Richmond", completed: true, homePoints: 31, awayPoints: 10 },
    { id: 2, start: "2026-09-12T16:00:00Z", home: "NC State", away: "Virginia", completed: true, homePoints: 24, awayPoints: 17 },
    { id: 4, start: "2026-09-26T16:00:00Z", home: "Duke", away: "Virginia", completed: false, homePoints: null, awayPoints: null },
  ];
  const r = recordsBefore(games);
  assert.deepEqual(r[1], { home: "0-0", away: "0-0" });
  assert.deepEqual(r[2], { home: "0-0", away: "1-0" });
  assert.deepEqual(r[3], { home: "1-1", away: "0-0" });
  // An unplayed game doesn't count toward the next one.
  assert.deepEqual(r[4], { home: "0-0", away: "1-1" });
});

test("AP ranks map ESPN team ids to cfb-picks names", () => {
  const teams = { Miami: { id: 2390 }, Virginia: { id: 258 }, Georgia: { id: 61 } };
  const ref = (id) => ({ $ref: `http://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/teams/${id}?lang=en` });
  const poll = { type: "ap", season: { year: 2026 }, ranks: [{ current: 1, team: ref(2390) }, { current: 3, team: ref(61) }, { current: 4, team: ref(9999) }] };
  assert.deepEqual(apRanks(poll, 2026, teams), { Miami: 1, Georgia: 3 });
  // Last season's poll, or a different poll, means no ranks rather than wrong ones.
  assert.equal(apRanks({ ...poll, season: { year: 2025 } }, 2026, teams), null);
  assert.equal(apRanks({ ...poll, type: "usa" }, 2026, teams), null);
});
