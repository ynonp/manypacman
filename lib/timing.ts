// Simulation updates are more frequent than tile crossings. Each actor advances
// at an even cadence instead of slowing ghosts by occasionally skipping a turn.
export const TICK_MS = 35;
export const PLAYER_STEP_MS = 140;
export const ghostStepMs = (level: number) => level >= 4 ? 175 : 210;
