import "server-only";
import { Game } from "./game";

// Survive dev hot reloads and share the room between requests in this process.
const globals = globalThis as typeof globalThis & { pacmanRoom?: Game };
export const room = globals.pacmanRoom ??= new Game();
