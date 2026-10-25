import test from "node:test";
import assert from "node:assert/strict";
import { freezeTime, shouldFreeze, sheetLine, modelSide, cover, outcome, standings, BOTS, isOpen, summary } from "../lib/rules.js";

test("freeze time is the Tuesday 10 AM ET at or before kickoff", () => {
  // Week 9 2026 (EDT): Tue night, Thu night and Sat games all freeze Tue Oct 27 14:00 UTC.
  const tue = Date.parse("2026-10-27T14:00:00Z");
  assert.equal(freezeTime("2026-10-27T23:00:00Z"), tue);
  assert.equal(freezeTime("2026-10-29T23:30:00Z"), tue);
  assert.equal(freezeTime("2026-10-31T16:00:00Z"), tue);
  // A Saturday 11:30 PM ET kickoff is already Sunday in UTC; still that Tuesday.
  assert.equal(freezeTime("2026-11-01T03:30:00Z"), tue);
  // After DST ends (Nov 1), Tuesday 10 AM ET is 15:00 UTC.
  assert.equal(freezeTime("2026-11-07T17:00:00Z"), Date.parse("2026-11-03T15:00:00Z"));
  // A Monday game freezes on the Tuesday before.
  assert.equal(freezeTime("2026-09-07T23:00:00Z"), Date.parse("2026-09-01T14:00:00Z"));
});

test("a line freezes from the first snapshot at or after the freeze time", () => {
  const g = { start: "2026-10-31T16:00:00Z", line: null };
  const odds = { spread: { median: -7 } };
  const sunday = "2026-10-26T01:00:00Z", tuesday = "2026-10-27T14:02:00Z";
  assert.equal(shouldFreeze(g, odds, sunday, Date.parse("2026-10-27T13:00:00Z")), false);
  assert.equal(shouldFreeze(g, odds, tuesday, Date.parse("2026-10-27T15:00:00Z")), true);
  // Already frozen, no spread, or after kickoff: never.
  assert.equal(shouldFreeze({ ...g, line: -7 }, odds, tuesday, Date.parse("2026-10-27T15:00:00Z")), false);
  assert.equal(shouldFreeze(g, { spread: null }, tuesday, Date.parse("2026-10-27T15:00:00Z")), false);
  assert.equal(shouldFreeze(g, odds, tuesday, Date.parse("2026-10-31T16:00:00Z")), false);
});

test("a skipped Tuesday snapshot falls back to the newest one", () => {
  const odds = { spread: { median: 3 } }, sunday = "2026-10-26T01:00:00Z";
  // Tuesday 7 PM ET game: 3 hours before kickoff.
  const tue = { start: "2026-10-27T23:00:00Z", line: null };
  assert.equal(shouldFreeze(tue, odds, sunday, Date.parse("2026-10-27T19:59:59Z")), false);
  assert.equal(shouldFreeze(tue, odds, sunday, Date.parse("2026-10-27T20:00:00Z")), true);
  // Saturday game: Wednesday 4 PM ET (30 hours after the Tuesday freeze), not Tuesday afternoon.
  const sat = { start: "2026-10-31T16:00:00Z", line: null };
  assert.equal(shouldFreeze(sat, odds, sunday, Date.parse("2026-10-28T19:59:59Z")), false);
  assert.equal(shouldFreeze(sat, odds, sunday, Date.parse("2026-10-28T20:00:00Z")), true);
});

test("sheet line: median, quarter points go to DraftKings or toward zero", () => {
  assert.equal(sheetLine({ spread: { median: -7.5 } }), -7.5);
  assert.equal(sheetLine({ spread: { median: -3.75 }, byBook: { draftkings: { homeLine: -4 } } }), -4);
  assert.equal(sheetLine({ spread: { median: -3.75 }, byBook: {} }), -3.5);
  assert.equal(sheetLine({ spread: { median: 6.25 } }), 6);
});

test("model side and covers", () => {
  assert.equal(modelSide(15.2, -7.5), "home"); // likes home by more than the line
  assert.equal(modelSide(5, -7.5), "away");
  const g = { completed: true, homePts: 30, awayPts: 20, line: -10 };
  assert.equal(cover(g), "push");
  assert.equal(cover({ ...g, line: -9.5 }), "home");
  assert.equal(cover({ ...g, line: -10.5 }), "away");
  assert.equal(cover({ ...g, completed: false }), null);
  assert.equal(outcome("home", { ...g, line: -9.5 }), "win");
  assert.equal(outcome(undefined, g), "none");
});

test("bots follow their rules", () => {
  const bot = Object.fromEntries(BOTS.map((b) => [b.id, b.pick]));
  const g = { id: 1, home: "Virginia", away: "Ohio State", homeConf: "ACC", awayConf: "Big Ten", line: 14, modelPick: "home" };
  assert.equal(bot.chalk(g), "away");
  assert.equal(bot.dog(g), "home");
  assert.equal(bot.home(g), "home");
  assert.equal(bot.acc(g), "home");
  assert.equal(bot.acc({ ...g, homeConf: "SEC", awayConf: "ACC", home: "LSU", away: "Clemson" }), "away");
  assert.equal(bot.acc({ ...g, homeConf: "ACC", awayConf: "ACC", away: "Clemson" }), "home"); // Virginia
  assert.equal(bot.acc({ ...g, home: "Duke", away: "Clemson", homeConf: "ACC", awayConf: "ACC", line: 3 }), "away"); // favorite
  assert.equal(bot.fade(g), "away");
  assert.equal(bot.coin(g), bot.coin({ ...g })); // same game, same flip
});

test("standings grade everyone on your games only", () => {
  const base = { completed: true, homeConf: "SEC", awayConf: "SEC", home: "A", away: "B" };
  const games = [
    { ...base, id: 1, week: 9, line: -3, homePts: 28, awayPts: 21, modelPick: "home" }, // home covers
    { ...base, id: 2, week: 9, line: -3, homePts: 20, awayPts: 21, modelPick: "home" }, // away covers
    { ...base, id: 3, week: 9, line: -3, homePts: 40, awayPts: 0, modelPick: "home" }, // not picked: ignored
    { ...base, id: 4, week: 10, line: -3, homePts: null, awayPts: null, completed: false, modelPick: "away" },
  ];
  const picks = { 1: { side: "home" }, 2: { side: "away" }, 4: { side: "home" } };
  const { weeks, rows } = standings(games, picks);
  const by = Object.fromEntries(rows.map((x) => [x.p.id, x]));
  assert.deepEqual(weeks, [9]);
  assert.deepEqual(by.you.r, { w: 2, l: 0, p: 0 });
  assert.deepEqual(by.model.r, { w: 1, l: 1, p: 0 });
  assert.deepEqual(by.fade.r, { w: 1, l: 1, p: 0 });
  assert.equal(by.you.beatModel, 1);
});

test("picks open only between the freeze and kickoff", () => {
  const g = { start: "2026-10-31T16:00:00Z", line: -3 };
  assert.equal(isOpen(g, Date.parse("2026-10-31T15:59:59Z")), true);
  assert.equal(isOpen(g, Date.parse("2026-10-31T16:00:00Z")), false);
  assert.equal(isOpen({ ...g, line: null }, Date.parse("2026-10-28T00:00:00Z")), false);
});

test("summary: you vs the Model, rank, and the Model on every game", () => {
  const base = { completed: true, homeConf: "SEC", awayConf: "SEC", home: "A", away: "B", week: 9, start: "2026-10-31T16:00:00Z" };
  const games = [
    { ...base, id: 1, line: -3, homePts: 28, awayPts: 21, modelPick: "home" },
    { ...base, id: 2, line: -3, homePts: 20, awayPts: 21, modelPick: "home" },
    { ...base, id: 3, line: -3, homePts: 40, awayPts: 0, modelPick: "home" },
    { ...base, id: 4, line: null, homePts: 40, awayPts: 0, modelPick: null },
  ];
  const s = summary(games, { 1: { side: "home" }, 2: { side: "away" } }, 9, Date.parse("2026-11-02T00:00:00Z"));
  assert.deepEqual(s.you, { w: 2, l: 0, p: 0 });
  assert.deepEqual(s.model, { w: 1, l: 1, p: 0 });
  assert.deepEqual(s.board, { w: 2, l: 1, p: 0 }); // game 4 has no line: not on the board
  assert.equal(s.rank, 1);
  assert.equal(s.open, 0);
});
