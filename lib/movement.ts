import { DIRECTIONS, isWalkable, type Direction, type Point } from "./maze.ts";

export interface Motion extends Point {
  direction: Direction;
  queuedDirection: Direction | null;
  moving: boolean;
}
const EPSILON = 1e-8;
export const atCenter = (actor: Point) =>
  Math.abs(actor.x - Math.round(actor.x)) < EPSILON && Math.abs(actor.y - Math.round(actor.y)) < EPSILON;

export function steer(actor: Motion, direction: Direction | "stop") {
  if (direction === "stop") {
    actor.moving = false;
    actor.queuedDirection = null;
  } else {
    actor.queuedDirection = direction;
    actor.moving = true;
  }
}

// The exact same continuous movement and buffered-turn rules run in Node and in
// every browser. Tile boundaries are snapped to integers to avoid float drift.
export function advanceMovement(actor: Motion, distance: number, chooseDirection?: () => void, onArrival?: () => void) {
  while (distance > EPSILON && actor.moving) {
    if (atCenter(actor)) {
      actor.x = Math.round(actor.x);
      actor.y = Math.round(actor.y);
      chooseDirection?.();
      const queued = actor.queuedDirection && DIRECTIONS[actor.queuedDirection];
      if (queued && isWalkable(actor.x + queued.x, actor.y + queued.y)) {
        actor.direction = actor.queuedDirection!;
        actor.queuedDirection = null;
      }
      const next = DIRECTIONS[actor.direction];
      if (!isWalkable(actor.x + next.x, actor.y + next.y)) {
        actor.moving = false;
        break;
      }
    }
    const delta = DIRECTIONS[actor.direction];
    const targetX = delta.x > 0 ? Math.floor(actor.x + EPSILON) + 1 : delta.x < 0 ? Math.ceil(actor.x - EPSILON) - 1 : actor.x;
    const targetY = delta.y > 0 ? Math.floor(actor.y + EPSILON) + 1 : delta.y < 0 ? Math.ceil(actor.y - EPSILON) - 1 : actor.y;
    const toCenter = Math.abs(targetX - actor.x) + Math.abs(targetY - actor.y);
    const step = Math.min(distance, toCenter);
    actor.x += delta.x * step;
    actor.y += delta.y * step;
    distance -= step;
    if (toCenter - step < EPSILON) {
      actor.x = targetX;
      actor.y = targetY;
      onArrival?.();
    }
  }
}
