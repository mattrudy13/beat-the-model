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

test("AP ranks come from the AP poll in ESPN's rankings feed", () => {
  const team = (location) => ({ id: "1", location });
  const ap = { type: "ap", season: { year: 2026 }, ranks: [{ current: 1, team: team("Miami") }, { current: 3, team: team("Georgia") }] };
  const coaches = { type: "usa", season: { year: 2026 }, ranks: [{ current: 1, team: team("Ohio State") }] };
  // The coaches poll comes first on purpose: the AP poll is picked by type, not position.
  assert.deepEqual(apRanks({ rankings: [coaches, ap] }, 2026), { Miami: 1, Georgia: 3 });
  // Last season's poll, or no AP poll, means no ranks rather than wrong ones.
  assert.equal(apRanks({ rankings: [{ ...ap, season: { year: 2025 } }] }, 2026), null);
  assert.equal(apRanks({ rankings: [coaches] }, 2026), null);
});
