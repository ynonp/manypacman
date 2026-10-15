import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../lib/game.ts";
import { COLS, MAZE, SPAWNS, isWalkable, tileId } from "../lib/maze.ts";

function quietGame() {
  const game = new Game();
  game.ghosts.forEach((ghost) => { ghost.asleepUntil = Number.MAX_SAFE_INTEGER; });
  return game;
}

test("all pellets and spawns are reachable through the same maze", () => {
  const visited = new Set<number>();
  const queue = [SPAWNS[0]];
  while (queue.length) {
    const { x, y } = queue.shift()!;
    if (!isWalkable(x, y) || visited.has(tileId(x, y))) continue;
    visited.add(tileId(x, y));
    queue.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
  }
  MAZE.forEach((row, y) => {
    assert.equal(row.length, COLS);
    [...row].forEach((cell, x) => {
      if (cell !== "#") assert.ok(visited.has(tileId(x, y)), `Unreachable tile at ${x},${y}`);
    });
  });
  SPAWNS.forEach(({ x, y }) => assert.ok(visited.has(tileId(x, y))));
});

test("each connection gets a distinct Pac and removing one keeps teammates", () => {
  const game = new Game();
  const first = game.addPlayer(0);
  const second = game.addPlayer(0);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.color, second.color);
  assert.notDeepEqual({ x: first.x, y: first.y }, { x: second.x, y: second.y });
  game.removePlayer(first.id);
  assert.deepEqual(game.snapshot(0).players.map((p) => p.id), [second.id]);
  assert.equal(game.input(first.id, "right"), false);
});

test("movement obeys walls, buffers turns, and can stop", () => {
  const game = quietGame();
  const player = game.addPlayer(0);
  Object.assign(player, { x: 1, y: 1, direction: "right" });
  game.input(player.id, "down");
  game.tick(1);
  assert.equal(player.y, 2);
  game.tick(2);
  assert.equal(player.y, 3);
  // At (1,3), right is a wall. Continue down and turn when the corridor opens.
  game.input(player.id, "right");
  game.tick(3);
  assert.deepEqual({ x: player.x, y: player.y }, { x: 1, y: 4 });
  game.tick(4);
  assert.deepEqual({ x: player.x, y: player.y }, { x: 2, y: 4 });
  game.input(player.id, "stop");
  game.tick(5);
  assert.equal(player.x, 2);
  Object.assign(player, { x: 1, y: 1, direction: "left" });
  game.input(player.id, "left");
  game.tick(6);
  assert.equal(player.x, 1);
});

test("a shared pellet scores once even when two teammates overlap", () => {
  const game = quietGame();
  const first = game.addPlayer(0);
  const second = game.addPlayer(0);
  Object.assign(first, { x: 2, y: 1 });
  Object.assign(second, { x: 2, y: 1 });
  const count = game.pellets.size;
  game.tick(1);
  assert.equal(game.pellets.size, count - 1);
  assert.equal(game.score, 10);
  assert.equal(first.score + second.score, 10);
  game.tick(2);
  assert.equal(game.score, 10);
});

test("a power pellet lets a different teammate eat a ghost", () => {
  const game = quietGame();
  const collector = game.addPlayer(0);
  const teammate = game.addPlayer(0);
  Object.assign(collector, { x: 1, y: 1 });
  Object.assign(teammate, { x: 8, y: 4, immuneUntil: 0 });
  const ghost = game.ghosts[0];
  Object.assign(ghost, { x: 8, y: 4, asleepUntil: 0 });
  game.tick(1000);
  assert.equal(game.poweredUntil, 9000);
  assert.equal(collector.score, 50);
  assert.equal(teammate.score, 210);
  assert.equal(game.score, 260);
  assert.equal(ghost.asleepUntil, 4000);
  assert.equal(teammate.respawns, 0);
});

test("ghosts respawn players with protection and preserve team progress", () => {
  const game = quietGame();
  const player = game.addPlayer(0);
  Object.assign(player, { x: 8, y: 4, immuneUntil: 0, score: 80 });
  game.score = 80;
  game.pellets.delete(tileId(SPAWNS[0].x, SPAWNS[0].y));
  Object.assign(game.ghosts[0], { x: 8, y: 4, asleepUntil: 0 });
  game.tick(5000);
  assert.equal(player.respawns, 1);
  assert.equal(player.x, SPAWNS[0].x);
  assert.equal(player.y, SPAWNS[0].y);
  assert.equal(player.immuneUntil, 8500);
  assert.equal(player.score, 90);
  assert.equal(game.score, 90);
});

test("clearing the board advances everyone to a fresh level after a countdown", () => {
  const game = quietGame();
  const player = game.addPlayer(0);
  game.pellets.clear();
  game.pellets.add(tileId(player.x, player.y));
  game.tick(1000);
  assert.equal(game.nextLevelAt, 5000);
  game.tick(4999);
  assert.equal(game.level, 1);
  game.tick(5000);
  assert.equal(game.level, 2);
  assert.equal(game.nextLevelAt, 0);
  assert.ok(game.pellets.size > 250);
  assert.ok(game.score >= 10);
  assert.equal(player.moving, false);
});

test("snapshots cannot mutate authoritative positions", () => {
  const game = new Game();
  const player = game.addPlayer(0);
  const snapshot = game.snapshot(0);
  snapshot.players[0].x = -100;
  snapshot.ghosts[0].y = -100;
  assert.ok(player.x > 0);
  assert.ok(game.ghosts[0].y > 0);
});


test("actors advance continuously on every physics step, including slower ghosts", () => {
  const game = quietGame();
  const player = game.addPlayer(0);
  Object.assign(player, { x: 2, y: 4 });
  const ghost = game.ghosts[0];
  Object.assign(ghost, { x: 2, y: 1, direction: "right", asleepUntil: 0 });
  game.input(player.id, "right");
  let playerX = player.x;
  let ghostX = ghost.x;
  for (let time = 35; time <= 420; time += 35) {
    game.tick(time, 35);
    assert.ok(Math.abs(player.x - playerX - 0.25) < 1e-8);
    assert.ok(Math.abs(ghost.x - ghostX - 1 / 6) < 1e-8);
    playerX = player.x;
    ghostX = ghost.x;
  }
});

test("commands broadcast immediately and stale sequences cannot undo newer inputs", () => {
  const game = quietGame();
  const player = game.addPlayer(0);
  const events: import("../lib/game-protocol.ts").GameEvent[] = [];
  const unsubscribe = game.subscribe(player.id, (event) => events.push(event));
  try {
    game.input(player.id, "left", 2);
    assert.equal(events.at(-1)!.type, "input");
    game.input(player.id, "right", 1);
    assert.equal(player.queuedDirection, "left");
    assert.equal(player.lastInputSeq, 2);
    for (let time = 35; time <= 280; time += 35) game.tick(time, 35);
    assert.equal(events.filter((event) => event.type === "state").length, 1);
    for (const event of events.filter((event) => event.type === "patch")) {
      assert.equal("pellets" in event.data, false);
    }
  } finally { unsubscribe(); }
});
