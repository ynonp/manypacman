// One connected maze. `o` is a power pellet, spaces are empty spawn tiles.
export const MAZE = [
  "#############################",
  "#o............#............o#",
  "#.####.######.#.######.####.#",
  "#.#..#.#....#.#.#....#.#..#.#",
  "#...........................#",
  "#.####.#.###########.#.####.#",
  "#......#.....#.#.....#......#",
  "######.#####.#.#.#####.######",
  "#......#.....#.#.....#......#",
  "#.####.#.###.#.#.###.#.####.#",
  "#......#.............#......#",
  "#.####.###.##   ##.###.####.#",
  "#..........#     #..........#",
  "#.####.###.#######.###.####.#",
  "#....#.................#....#",
  "####.#.#####.#.#.#####.#.####",
  "#......#.....#.#.....#......#",
  "#.####.#.###########.#.####.#",
  "#...........................#",
  "#.####.######.#.######.####.#",
  "#.#..#.#....#.#.#....#.#..#.#",
  "#......#.............#......#",
  "#.####.#.###########.#.####.#",
  "#o.........................o#",
  "#############################",
];

export const COLS = MAZE[0].length;
export const ROWS = MAZE.length;
export const DIRECTIONS = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
} as const;
export type Direction = keyof typeof DIRECTIONS;
export type Point = { x: number; y: number };
export const COLORS = ["#f5ed63", "#70e4d0", "#f397c8", "#a59aff", "#ffae70", "#99db73", "#84c6ff"];
export const SPAWNS: Point[] = [
  { x: 14, y: 18 }, { x: 12, y: 18 }, { x: 16, y: 18 },
  { x: 10, y: 18 }, { x: 18, y: 18 }, { x: 14, y: 14 },
  { x: 12, y: 14 }, { x: 16, y: 14 },
];
export const tileId = (x: number, y: number) => y * COLS + x;
export const isWalkable = (x: number, y: number) =>
  y >= 0 && y < ROWS && x >= 0 && x < COLS && MAZE[y][x] !== "#";

export interface Player extends Point {
  id: string;
  name: string;
  color: string;
  direction: Direction;
  queuedDirection: Direction | null;
  moving: boolean;
  score: number;
  respawns: number;
  immuneUntil: number;
  lastInputSeq: number;
}
export interface Ghost extends Point {
  id: number;
  color: string;
  direction: Direction;
  asleepUntil: number;
  moving: boolean;
  queuedDirection: Direction | null;
}
export interface GameState {
  players: Player[];
  ghosts: Ghost[];
  pellets: number[];
  powerPellets: number[];
  score: number;
  level: number;
  totalPellets: number;
  poweredUntil: number;
  nextLevelAt: number;
  now: number;
}
