import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../lib/game.ts";
import { GamePlayback } from "../lib/game-playback.ts";

function fixture() {
  const game = new Game();
  const player = game.addPlayer(0);
  Object.assign(player, { x: 2, y: 4 });
  game.ghosts.forEach((ghost) => { ghost.asleepUntil = Number.MAX_SAFE_INTEGER; });
  const playback = new GamePlayback();
  playback.reset(player.id);
  playback.receive(game.snapshot(0), 0);
  return { game, player, playback };
}

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test("local input moves immediately and stays smooth for 700ms without any packets", () => {
  const { player, playback } = fixture();
  playback.command({ id: player.id, direction: "right", sequence: 1 }, 0, true);
  let previous = 2;
  for (let time = 10; time <= 700; time += 10) {
    playback.advance(time);
    const x = playback.position(player.id)!.x;
    near(x - previous, 10 / 140);
    previous = x;
  }
  near(previous, 7);
  assert.equal(playback.state!.score, 0); // Predicted movement cannot award points.
});

test("remote commands are simulated locally between server corrections", () => {
  const { game, player, playback } = fixture();
  const teammate = game.addPlayer(0);
  Object.assign(teammate, { x: 2, y: 18 });
  playback.update({ now: 0, players: [{ ...teammate }] }, 0);
  playback.command({ id: teammate.id, direction: "right", sequence: 1 }, 0);
  for (let time = 10; time <= 600; time += 10) playback.advance(time);
  near(playback.position(teammate.id)!.x, 2 + 600 / 140);
  near(playback.position(player.id)!.x, 2);
});

test("delayed synchronization preserves unacknowledged input and smooths small errors", () => {
  const { player, playback } = fixture();
  playback.command({ id: player.id, direction: "right", sequence: 1 }, 0, true);
  playback.advance(100);
  const before = playback.position(player.id)!.x;
  playback.update({ now: 80, players: [{ ...player, lastInputSeq: 0 }] }, 100, true);
  near(playback.position(player.id)!.x, before);
  let previous = before;
  for (let time = 110; time <= 700; time += 10) {
    playback.advance(time);
    const x = playback.position(player.id)!.x;
    assert.ok(x > previous, `Movement paused or reversed at ${time}ms`);
    previous = x;
  }
});

test("echoes do not repeat an input after a queued turn has already happened", () => {
  const { player, playback } = fixture();
  const right = { id: player.id, direction: "right" as const, sequence: 1 };
  playback.command(right, 0, true);
  playback.advance(140);
  playback.command({ id: player.id, direction: "up", sequence: 2 }, 140, true);
  playback.advance(280);
  near(playback.position(player.id)!.y, 3);
  playback.command(right, 280);
  assert.equal(playback.position(player.id)!.queuedDirection, null);
});

test("respawns snap to the spawn without animating through maze walls", () => {
  const { player, playback } = fixture();
  playback.command({ id: player.id, direction: "right", sequence: 1 }, 0, true);
  playback.advance(100);
  playback.update({ now: 100, players: [{ ...player, x: 14, y: 18, respawns: 1 }] }, 100);
  near(playback.position(player.id)!.x, 14);
  near(playback.position(player.id)!.y, 18);
  assert.equal(playback.position(player.id)!.moving, false);
});

test("pellet patches update only authoritative board changes", () => {
  const { playback } = fixture();
  const before = playback.state!.pellets;
  const removed = before[0];
  playback.update({ now: 10, removedPellets: [removed], score: 50, poweredUntil: 8010 }, 10);
  assert.equal(playback.state!.pellets.length, before.length - 1);
  assert.equal(playback.state!.powerPellets.includes(removed), false);
  assert.equal(playback.state!.score, 50);
});


test("prediction takes buffered turns and stops at walls without server packets", () => {
  const { player, playback } = fixture();
  playback.command({ id: player.id, direction: "right", sequence: 1 }, 0, true);
  playback.advance(140);
  playback.command({ id: player.id, direction: "up", sequence: 2 }, 140, true);
  playback.advance(280);
  playback.command({ id: player.id, direction: "right", sequence: 3 }, 280, true);
  playback.advance(420);
  playback.advance(560);
  near(playback.position(player.id)!.x, 4);
  near(playback.position(player.id)!.y, 3);
  assert.equal(playback.position(player.id)!.moving, false);
});

test("an input between animation callbacks cannot rewind the simulation clock", () => {
  const { player, playback } = fixture();
  playback.command({ id: player.id, direction: "right", sequence: 1 }, 0, true);
  playback.advance(100);
  playback.advance(90); // RAF timestamp predates a just-processed event.
  playback.advance(140);
  near(playback.position(player.id)!.x, 3);
});
