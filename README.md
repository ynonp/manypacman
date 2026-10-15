# manypac.

A drop-in cooperative Pac-Man game. Every browser connection becomes a colored Pac-Man in the same maze. No accounts, rooms, or matchmaking.

## Run locally

Use Node.js 22.18 or later.

```sh
npm install
npm run dev
```

Open http://localhost:3000 in multiple tabs or browsers to play together. For other devices on the same network, use your computer’s LAN address and port 3000.

## Play

- Arrow keys or WASD: choose a direction. Pac-Man keeps moving and queues turns until an opening.
- Space: stop. Mobile players can swipe the board or use the direction buttons.
- Collect dots (10 points) and power pellets (50 points). Power pellets let the entire team eat ghosts (200 points) for eight seconds.
- Ghost collisions respawn the player with temporary protection. Scores and collected dots stay intact; there are no limited lives.
- Clear the maze together to advance to the next level. New players can join at any time.
- Sound is optional. Use the speaker button below the board.

## Production

```sh
npm run build
npm start
```

Run **one long-lived Node.js process**. `PORT` sets the listening port. The authoritative game state lives in memory, shared by the connections to that process; restarting it resets the game. The simulation pauses when the last player leaves and resumes when someone joins. Each page connection gets a new Pac-Man, including after refresh or reconnection.

This architecture is intended for a self-hosted Node server. Do not use static export, short-lived serverless functions, or multiple Node workers/replicas: separate processes would have separate boards. Scaling to multiple processes would require a dedicated shared game service.

Each browser simulates continuous movement locally using the same movement rules as the server. Your controls take effect immediately, without waiting for the network. Commands are relayed to teammates over Server-Sent Events at `/api/game`; pellet removals, scores, ghost turns, and respawns arrive as small patches. Every 500 ms, the server sends position corrections. Small differences blend smoothly, while respawns snap to the spawn tile. Unacknowledged local inputs are replayed after reconciliation.

The full pellet list is sent only when joining or starting a new level. The server runs physics every 35 ms and remains authoritative for walls, ghost AI, collisions, score, power-ups, and level transitions. There are no new runtime dependencies.

If using Nginx, disable buffering for the live endpoint so updates stream immediately:

```nginx
location /api/game {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
```

Proxy the remaining paths to the same Node server as usual. The application also sends `X-Accel-Buffering: no`. HTTPS works without a separate WebSocket configuration.

## Checks

```sh
npm test
npm run build
# With the server running:
npm run test:live
```

Tests cover maze reachability, independent players, movement and buffered turns, shared scoring, team power-ups, respawn protection, level progression, continuous movement without packets, delayed corrections, input acknowledgments, and incremental network updates.
# manypacman
