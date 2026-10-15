// Run against a running development or production server: npm run test:live
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { applyGameUpdate } from '../lib/game-protocol.ts';
const base = process.env.GAME_URL || 'http://localhost:3000';

async function connect() {
  const abort = new AbortController();
  const response = await fetch(`${base}/api/game`, { signal: abort.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const client = { abort, id: null, state: null, events: 0, fullBoards: 0, syncs: 0, commands: [], repeatedBoard: false };
  let buffer = '';
  client.done = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = JSON.parse(event.split('\ndata: ')[1]);
          if (event.startsWith('event: welcome')) client.id = data.id;
          if (event.startsWith('event: state')) { client.state = data; client.events++; client.fullBoards++; }
          if (client.state && (event.startsWith('event: patch') || event.startsWith('event: sync'))) {
            client.state = applyGameUpdate(client.state, data, event.startsWith('event: sync'));
            client.events++;
            if (event.startsWith('event: sync')) client.syncs++;
            if ('pellets' in data || 'powerPellets' in data) client.repeatedBoard = true;
          }
          if (event.startsWith('event: input')) client.commands.push(data);
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) throw error;
    }
  })();
  return client;
}

async function until(predicate, description) {
  const end = Date.now() + 6000;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out: ${description}`);
}

const clients = [];
try {
  const first = await connect(); clients.push(first);
  const second = await connect(); clients.push(second);
  await until(() => first.id && second.id && [first, second].every((c) => c.state?.players.some((p) => p.id === first.id) && c.state?.players.some((p) => p.id === second.id)), 'both clients share one board');
  assert.notEqual(first.id, second.id);
  console.log('✓ Two independent clients join the same authoritative board');

  const mine = () => first.state.players.find((p) => p.id === first.id);
  const teammate = () => second.state.players.find((p) => p.id === first.id);
  const initialX = mine().x;
  const initialScore = first.state.score;
  const response = await fetch(`${base}/api/game`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: first.id, direction: 'right' }),
  });
  assert.equal(response.status, 204);
  await until(() => second.commands.some((command) => command.id === first.id && command.direction === 'right'), 'commands relayed to teammates');
  await until(() => mine().x !== initialX && teammate().x !== initialX, 'movement visible in both clients');
  await fetch(`${base}/api/game`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: first.id, direction: 'stop' }),
  });
  await until(() => first.state.score >= initialScore && first.state.score === second.state.score
    && JSON.stringify(first.state.pellets) === JSON.stringify(second.state.pellets), 'shared score and pellets match in both clients');
  console.log('✓ Commands relay immediately; movement, score, and pellets synchronize');
  await until(() => first.syncs >= 2, 'periodic corrections arrive');
  assert.equal(first.fullBoards, 1);
  assert.equal(first.repeatedBoard, false);
  console.log('✓ Periodic corrections contain no full board or pellet arrays');

  const badInput = await fetch(`${base}/api/game`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: first.id, direction: '__proto__' }),
  });
  assert.equal(badInput.status, 400);
  const malformed = await fetch(`${base}/api/game`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken',
  });
  assert.equal(malformed.status, 400);
  // Node's fetch ignores custom Host headers; use HTTP directly for this check.
  const proxyStatus = await new Promise((resolve, reject) => {
    const url = new URL('/api/game', base);
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'arcade.example', Origin: 'https://arcade.example' },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end(JSON.stringify({ id: first.id, direction: 'stop' }));
  });
  assert.equal(proxyStatus, 204);
  const crossOrigin = await fetch(`${base}/api/game`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' },
    body: JSON.stringify({ id: first.id, direction: 'stop' }),
  });
  assert.equal(crossOrigin.status, 403);
  console.log('✓ Invalid inputs and foreign origins are rejected; public proxy hosts work');

  second.abort.abort();
  await until(() => !first.state.players.some((p) => p.id === second.id), 'disconnected player removed');
  console.log('✓ Disconnect removes only the departed player');
  const rejoined = await connect(); clients.push(rejoined);
  await until(() => rejoined.id && first.state.players.some((p) => p.id === rejoined.id), 'new client rejoins');
  assert.notEqual(rejoined.id, second.id);
  console.log('✓ Rejoining creates a new Pac on the existing board');
} finally {
  clients.forEach((client) => client.abort.abort());
  await Promise.all(clients.map((client) => client.done));
}
