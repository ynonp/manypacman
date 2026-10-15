import { randomUUID } from "node:crypto";
import {
  MAZE, COLORS, DIRECTIONS, SPAWNS, isWalkable, tileId,
  type Direction, type GameState, type Ghost, type Player,
} from "./maze.ts";
import { advanceMovement, atCenter, steer } from "./movement.ts";
import { TICK_MS, PLAYER_STEP_MS, ghostStepMs } from "./timing.ts";
import type { GameEvent, GameUpdate } from "./game-protocol.ts";
export { TICK_MS } from "./timing.ts";

const GHOST_SPAWNS = [{ x: 12, y: 12 }, { x: 14, y: 12 }, { x: 16, y: 12 }, { x: 14, y: 11 }];
const OPPOSITE: Record<Direction, Direction> = { up: "down", down: "up", left: "right", right: "left" };
const STEPS = Object.keys(DIRECTIONS) as Direction[];
export const SYNC_MS = 500;

// The server owns outcomes. Clients share movement rules, predict commands, and
// reconcile against occasional corrections; the board is not streamed per tick.
export class Game {
  players = new Map<string, Player>();
  pellets = new Set<number>();
  powerPellets = new Set<number>();
  ghosts: Ghost[] = [];
  score = 0;
  level = 1;
  totalPellets = 0;
  poweredUntil = 0;
  nextLevelAt = 0;
  private elapsed = 0;
  private playerNumber = 0;
  private listeners = new Map<string, (event: GameEvent) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() { this.resetMaze(); }

  private resetMaze() {
    this.pellets.clear();
    this.powerPellets.clear();
    MAZE.forEach((row, y) => [...row].forEach((cell, x) => {
      if (cell === "." || cell === "o") this.pellets.add(tileId(x, y));
      if (cell === "o") this.powerPellets.add(tileId(x, y));
    }));
    this.totalPellets = this.pellets.size;
    this.poweredUntil = 0;
    this.nextLevelAt = 0;
    this.ghosts = GHOST_SPAWNS.map((point, id) => ({
      ...point, id, color: ["#ff7c8c", "#a59aff", "#75d5f0", "#ffb470"][id],
      direction: "up", asleepUntil: 0, moving: true, queuedDirection: null,
    }));
  }

  addPlayer(now = Date.now()) {
    const number = this.playerNumber++;
    const spawn = SPAWNS.find((s) => ![...this.players.values()].some((p) => p.x === s.x && p.y === s.y)) ?? SPAWNS[number % SPAWNS.length];
    const player: Player = {
      ...spawn, id: randomUUID(), name: `Pac ${String(number + 1).padStart(2, "0")}`,
      color: COLORS[number % COLORS.length], direction: "left", queuedDirection: null,
      moving: false, score: 0, respawns: 0, immuneUntil: now + 3500, lastInputSeq: 0,
    };
    this.players.set(player.id, player);
    return player;
  }

  removePlayer(id: string) {
    if (this.players.delete(id)) this.emit({ type: "patch", data: { now: Date.now(), removedPlayers: [id] } });
  }

  input(id: string, direction: Direction | "stop", sequence = 0) {
    const player = this.players.get(id);
    if (!player) return false;
    if (sequence > 0 && sequence <= player.lastInputSeq) return true;
    steer(player, direction);
    player.lastInputSeq = sequence;
    this.emit({ type: "input", data: { id, direction, sequence } });
    return true;
  }

  snapshot(now = Date.now()): GameState {
    return {
      players: [...this.players.values()].map((p) => ({ ...p })),
      ghosts: this.ghosts.map((g) => ({ ...g })),
      pellets: [...this.pellets], powerPellets: [...this.powerPellets],
      score: this.score, level: this.level, totalPellets: this.totalPellets,
      poweredUntil: this.poweredUntil, nextLevelAt: this.nextLevelAt, now,
    };
  }

  private award(player: Player, points: number) {
    player.score += points;
    this.score += points;
  }

  private collect(player: Player, now: number) {
    if (!atCenter(player)) return;
    const tile = tileId(Math.round(player.x), Math.round(player.y));
    if (!this.pellets.delete(tile)) return;
    const power = this.powerPellets.delete(tile);
    this.award(player, power ? 50 : 10);
    if (power) this.poweredUntil = now + 8000;
  }

  private collide(player: Player, ghost: Ghost, now: number) {
    if (ghost.asleepUntil > now || Math.hypot(player.x - ghost.x, player.y - ghost.y) > 0.65) return;
    if (this.poweredUntil > now) {
      this.award(player, 200);
      Object.assign(ghost, GHOST_SPAWNS[ghost.id], { asleepUntil: now + 3000, moving: false });
    } else if (player.immuneUntil <= now) {
      Object.assign(player, SPAWNS[0], {
        moving: false, queuedDirection: null, immuneUntil: now + 3500,
        respawns: player.respawns + 1,
      });
    }
  }

  private chooseGhostDirection(ghost: Ghost, now: number) {
    let choices = STEPS.filter((d) => isWalkable(ghost.x + DIRECTIONS[d].x, ghost.y + DIRECTIONS[d].y));
    if (choices.length > 1) choices = choices.filter((d) => d !== OPPOSITE[ghost.direction]);
    const players = [...this.players.values()];
    const target = players[(ghost.id + Math.floor(this.elapsed / 14000)) % players.length];
    if (!target || !choices.length) return;
    if (Math.random() < 0.24) choices.sort(() => Math.random() - 0.5);
    else choices.sort((a, b) => {
      const distance = (d: Direction) => Math.abs(ghost.x + DIRECTIONS[d].x - target.x) + Math.abs(ghost.y + DIRECTIONS[d].y - target.y);
      return (distance(a) - distance(b)) * (this.poweredUntil > now ? -1 : 1);
    });
    ghost.direction = choices[0];
  }

  tick(now = Date.now(), elapsed = PLAYER_STEP_MS) {
    if (!this.players.size) return;
    const before = this.snapshot(now);
    if (this.nextLevelAt) {
      if (now < this.nextLevelAt) return;
      this.level++;
      this.resetMaze();
      [...this.players.values()].forEach((p, i) => Object.assign(p, SPAWNS[i % SPAWNS.length], {
        moving: false, queuedDirection: null, immuneUntil: now + 3500,
      }));
    }
    // Small physics steps also detect collisions when actors pass one another.
    for (let remaining = elapsed; remaining > 0; remaining -= TICK_MS) {
      const step = Math.min(remaining, TICK_MS);
      this.elapsed += step;
      for (const player of this.players.values()) {
        this.collect(player, now);
        advanceMovement(player, step / PLAYER_STEP_MS, undefined, () => this.collect(player, now));
        for (const ghost of this.ghosts) this.collide(player, ghost, now);
      }
      for (const ghost of this.ghosts) {
        if (ghost.asleepUntil > now) continue;
        ghost.moving = true;
        advanceMovement(ghost, step / ghostStepMs(this.level), () => this.chooseGhostDirection(ghost, now));
      }
      for (const player of this.players.values()) {
        for (const ghost of this.ghosts) this.collide(player, ghost, now);
      }
    }
    if (!this.pellets.size) this.nextLevelAt = now + 4000;
    this.publishChanges(before, now);
  }

  private publishChanges(before: GameState, now: number) {
    if (before.level !== this.level) {
      this.emit({ type: "state", data: this.snapshot(now) });
      return;
    }
    const update: GameUpdate = { now };
    const removed = before.pellets.filter((id) => !this.pellets.has(id));
    if (removed.length) update.removedPellets = removed;
    const players = [...this.players.values()].filter((p) => {
      const previous = before.players.find((old) => old.id === p.id);
      return previous && (previous.respawns !== p.respawns || previous.moving !== p.moving);
    });
    if (players.length) update.players = players.map((p) => ({ ...p }));
    const scores = [...this.players.values()].filter((p) => before.players.find((old) => old.id === p.id)?.score !== p.score);
    if (scores.length) update.playerScores = scores.map(({ id, score }) => ({ id, score }));
    const ghosts = this.ghosts.filter((g) => {
      const previous = before.ghosts[g.id];
      return previous.direction !== g.direction || previous.asleepUntil !== g.asleepUntil || previous.moving !== g.moving;
    });
    if (ghosts.length) update.ghosts = ghosts.map((g) => ({ ...g }));
    if (before.score !== this.score) update.score = this.score;
    if (before.poweredUntil !== this.poweredUntil) update.poweredUntil = this.poweredUntil;
    if (before.nextLevelAt !== this.nextLevelAt) update.nextLevelAt = this.nextLevelAt;
    if (Object.keys(update).length > 1) this.emit({ type: "patch", data: update });
  }

  subscribe(id: string, listener: (event: GameEvent) => void) {
    this.listeners.set(id, listener);
    listener({ type: "state", data: this.snapshot() });
    const player = this.players.get(id);
    if (player) this.emit({ type: "patch", data: { now: Date.now(), players: [{ ...player }] } });
    if (!this.timer) {
      let previous = Date.now();
      let lastSync = previous;
      this.timer = setInterval(() => {
        const now = Date.now();
        // Catch up a delayed callback, while bounding work after process suspension.
        this.tick(now, Math.min(now - previous, 250));
        previous = now;
        if (now - lastSync >= SYNC_MS) {
          lastSync = now;
          this.emit({ type: "sync", data: {
            now, players: [...this.players.values()].map((p) => ({ ...p })),
            ghosts: this.ghosts.map((g) => ({ ...g })), score: this.score,
            poweredUntil: this.poweredUntil, nextLevelAt: this.nextLevelAt,
          } });
        }
      }, TICK_MS);
      this.timer.unref();
    }
    return () => {
      this.listeners.delete(id);
      this.removePlayer(id);
      if (!this.listeners.size && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  private emit(event: GameEvent) {
    for (const listener of this.listeners.values()) listener(event);
  }
}
