import type { GameState, Ghost, Player, Point } from "./maze.ts";
import { advanceMovement, steer, type Motion } from "./movement.ts";
import { applyGameUpdate, type GameUpdate, type PlayerCommand } from "./game-protocol.ts";
import { PLAYER_STEP_MS, ghostStepMs } from "./timing.ts";

type Prediction = { motion: Motion; correction: Point; revision: string };
type Pending = { command: PlayerCommand; at: number };
const CORRECTION_MS = 300;

// Rendering runs on local time. Network packets change intentions or reconcile
// state; they never gate an animation frame or a tile crossing.
export class GamePlayback {
  state: GameState | null = null;
  you: string | null = null;
  private clockOffset: number | null = null;
  private frameAt: number | null = null;
  private tracks = new Map<string, Prediction>();
  private pending: Pending[] = [];

  reset(you: string) {
    this.you = you;
    this.state = null;
    this.clockOffset = null;
    this.frameAt = null;
    this.tracks.clear();
    this.pending = [];
  }

  serverNow(localTime: number) {
    return localTime - (this.clockOffset ?? 0);
  }

  receive(state: GameState, receivedAt: number) {
    // A complete board is received only when joining or starting a new level.
    this.state = state;
    this.clockOffset = receivedAt - state.now;
    this.frameAt = receivedAt;
    this.tracks.clear();
    this.pending = [];
    for (const player of state.players) this.reconcile(player.id, player, `${state.level}:${player.respawns}`, true);
    for (const ghost of state.ghosts) this.reconcile(`ghost-${ghost.id}`, ghost, `${state.level}:${ghost.asleepUntil}`, true);
  }

  update(update: GameUpdate, receivedAt: number, sync = false) {
    if (!this.state) return;
    this.advance(receivedAt);
    this.clockOffset = Math.min(this.clockOffset ?? Infinity, receivedAt - update.now);
    const previous = this.state;
    this.state = applyGameUpdate(previous, update, sync);
    const age = Math.max(0, Math.min(250, this.serverNow(receivedAt) - update.now));
    for (const player of update.players ?? []) {
      const revision = `${this.state.level}:${player.respawns}`;
      const track = this.tracks.get(player.id);
      if (!sync && track?.revision === revision) continue; // Score-only patch.
      const projected = { ...player };
      const respawn = track && track.revision !== revision;
      if (player.id === this.you) {
        this.pending = respawn ? [] : this.pending.filter(({ command }) => command.sequence > player.lastInputSeq);
        let cursor = update.now;
        for (const pending of this.pending) {
          const at = Math.max(cursor, Math.min(pending.at, update.now + age));
          advanceMovement(projected, (at - cursor) / PLAYER_STEP_MS);
          steer(projected, pending.command.direction);
          cursor = at;
        }
        advanceMovement(projected, (update.now + age - cursor) / PLAYER_STEP_MS);
      } else advanceMovement(projected, age / PLAYER_STEP_MS);
      this.reconcile(player.id, projected, revision, !!respawn);
    }
    for (const ghost of update.ghosts ?? []) {
      const projected = { ...ghost };
      if (ghost.asleepUntil <= this.serverNow(receivedAt)) advanceMovement(projected, age / ghostStepMs(this.state.level));
      this.reconcile(`ghost-${ghost.id}`, projected, `${this.state.level}:${ghost.asleepUntil}`);
    }
    const active = new Set([
      ...this.state.players.map((p) => p.id), ...this.state.ghosts.map((g) => `ghost-${g.id}`),
    ]);
    for (const key of this.tracks.keys()) if (!active.has(key)) this.tracks.delete(key);
  }

  command(command: PlayerCommand, localTime: number, local = false) {
    this.advance(localTime);
    const track = this.tracks.get(command.id);
    if (!track) return;
    if (local) this.pending.push({ command, at: this.serverNow(localTime) });
    // An echoed command acknowledges delivery. Reapplying it could queue an old
    // turn a second time after the local simulation has already taken the turn.
    else if (command.id === this.you && this.pending.some((p) => p.command.sequence === command.sequence)) return;
    steer(track.motion, command.direction);
  }

  advance(localTime: number) {
    // RAF timestamps describe the start of the frame; an input handler may have
    // already advanced a little further using performance.now(). Never rewind.
    const nowAt = Math.max(localTime, this.frameAt ?? localTime);
    const elapsed = Math.min(nowAt - (this.frameAt ?? nowAt), 250);
    this.frameAt = nowAt;
    if (!this.state || this.state.nextLevelAt) return;
    const now = this.serverNow(localTime);
    for (const [key, track] of this.tracks) {
      const ghost = key.startsWith("ghost-") && this.state.ghosts.find((g) => `ghost-${g.id}` === key);
      if (!ghost || ghost.asleepUntil <= now) {
        advanceMovement(track.motion, elapsed / (ghost ? ghostStepMs(this.state.level) : PLAYER_STEP_MS));
      }
      const decay = Math.exp(-elapsed / CORRECTION_MS);
      track.correction.x *= decay;
      track.correction.y *= decay;
    }
  }

  private reconcile(key: string, actor: Player | Ghost, revision: string, teleport = false) {
    const previous = this.tracks.get(key);
    const difference = previous ? {
      x: previous.motion.x + previous.correction.x - actor.x,
      y: previous.motion.y + previous.correction.y - actor.y,
    } : { x: 0, y: 0 };
    const snap = teleport || previous?.revision !== revision || Math.hypot(difference.x, difference.y) > 1.25;
    this.tracks.set(key, {
      motion: { x: actor.x, y: actor.y, direction: actor.direction, queuedDirection: actor.queuedDirection, moving: actor.moving },
      correction: snap ? { x: 0, y: 0 } : difference,
      revision,
    });
  }

  position(key: string) {
    const track = this.tracks.get(key);
    return track ? {
      ...track.motion,
      x: track.motion.x + track.correction.x,
      y: track.motion.y + track.correction.y,
    } : null;
  }
}
