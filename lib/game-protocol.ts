import type { Direction, GameState, Ghost, Player } from "./maze.ts";

export interface PlayerCommand {
  id: string;
  direction: Direction | "stop";
  sequence: number;
}
export interface GameUpdate {
  now: number;
  players?: Player[];
  playerScores?: { id: string; score: number }[];
  ghosts?: Ghost[];
  removedPlayers?: string[];
  removedPellets?: number[];
  score?: number;
  poweredUntil?: number;
  nextLevelAt?: number;
}
export type GameEvent =
  | { type: "state"; data: GameState }
  | { type: "patch" | "sync"; data: GameUpdate }
  | { type: "input"; data: PlayerCommand };

export function applyGameUpdate(state: GameState, update: GameUpdate, sync = false): GameState {
  const removed = new Set(update.removedPellets);
  const left = new Set(update.removedPlayers);
  const players = new Map(state.players.filter((p) => !left.has(p.id)).map((p) => [p.id, p]));
  const ghosts = new Map(state.ghosts.map((g) => [g.id, g]));
  update.players?.forEach((p) => players.set(p.id, p));
  update.playerScores?.forEach(({ id, score }) => {
    const player = players.get(id);
    if (player) players.set(id, { ...player, score });
  });
  update.ghosts?.forEach((g) => ghosts.set(g.id, g));
  return {
    ...state,
    now: update.now,
    players: sync && update.players ? update.players : [...players.values()],
    ghosts: sync && update.ghosts ? update.ghosts : [...ghosts.values()],
    pellets: removed.size ? state.pellets.filter((id) => !removed.has(id)) : state.pellets,
    powerPellets: removed.size ? state.powerPellets.filter((id) => !removed.has(id)) : state.powerPellets,
    score: update.score ?? state.score,
    poweredUntil: update.poweredUntil ?? state.poweredUntil,
    nextLevelAt: update.nextLevelAt ?? state.nextLevelAt,
  };
}
