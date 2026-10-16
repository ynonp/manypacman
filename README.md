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

## Automatic deployment

The `Deploy` GitHub Actions workflow runs on every push to `main`. It can also be
started manually from the Actions tab on `main`. It connects to
`pacman@167.71.41.11`, pulls `main` into `/home/pacman/app`, runs
`npm ci --include=dev` and `npm run build`, then restarts `pacman.service` using
passwordless sudo. The run succeeds once the service is active and the local
HTTP endpoint responds successfully. Deployments run one at a time.

The SSH private key is stored in the repository Actions secret `DEPLOY_SSH_KEY`.
Its public key is installed in `/home/pacman/.ssh/authorized_keys` on the server.
The workflow pins the server's Ed25519 host key; update that value if the server
is replaced or its host key is rotated. To rotate the deployment key, add the new
public key to the server, replace the GitHub secret, verify deployment, and remove
the old public key.

The server needs Git access to this repository, Node.js 22.18 or later, npm,
`flock`, curl, and permission for `pacman` to run
`sudo -n /usr/bin/systemctl restart pacman.service`. Keep the server checkout on
`main` without local tracked-file edits; deployments fail rather than overwrite
those edits. Dependency installation and building happen in the service's working
directory, so deployments can briefly interrupt requests and restarting resets the
in-memory game.

## Checks

```sh
npm test
npm run build
# With the server running:
npm run test:live
```

Tests cover maze reachability, independent players, movement and buffered turns, shared scoring, team power-ups, respawn protection, level progression, continuous movement without packets, delayed corrections, input acknowledgments, and incremental network updates.
# manypacman
