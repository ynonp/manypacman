"use client";

import { useEffect, useRef } from "react";
import { COLS, ROWS, MAZE, type Direction } from "@/lib/maze";

import type { GamePlayback } from "@/lib/game-playback";

const TILE = 26;
const WIDTH = COLS * TILE;
const HEIGHT = ROWS * TILE;
const ANGLES: Record<Direction, number> = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };


function walls(ctx: CanvasRenderingContext2D) {
  // Trace the exposed edges of wall tiles into continuous arcade-style outlines.
  const edges = new Map<string, { x: number; y: number }[]>();
  const wall = (x: number, y: number) => MAZE[y]?.[x] === "#";
  const edge = (x: number, y: number, toX: number, toY: number) => {
    const key = `${x},${y}`;
    edges.set(key, [...(edges.get(key) ?? []), { x: toX, y: toY }]);
  };
  MAZE.forEach((row, y) => [...row].forEach((cell, x) => {
    if (cell !== "#") return;
    if (!wall(x, y - 1)) edge(x, y, x + 1, y);
    if (!wall(x + 1, y)) edge(x + 1, y, x + 1, y + 1);
    if (!wall(x, y + 1)) edge(x + 1, y + 1, x, y + 1);
    if (!wall(x - 1, y)) edge(x, y + 1, x, y);
  }));
  ctx.beginPath();
  while (edges.size) {
    const first = edges.keys().next().value!;
    const [startX, startY] = first.split(",").map(Number);
    let key = first;
    ctx.moveTo(startX * TILE, startY * TILE);
    do {
      const list = edges.get(key);
      if (!list?.length) break;
      const next = list.pop()!;
      if (!list.length) edges.delete(key);
      ctx.lineTo(next.x * TILE, next.y * TILE);
      key = `${next.x},${next.y}`;
    } while (key !== first);
    ctx.closePath();
  }
  ctx.fillStyle = "#101c35";
  ctx.fill("evenodd");
  ctx.lineWidth = 1.4;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#34568b";
  ctx.stroke();
}

export default function MazeCanvas({ playback, onDirection }: {
  playback: GamePlayback;
  onDirection: (direction: Direction) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const element = canvas.current!;
    const ctx = element.getContext("2d")!;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    element.width = WIDTH * scale;
    element.height = HEIGHT * scale;
    ctx.scale(scale, scale);
    const background = document.createElement("canvas");
    background.width = WIDTH * scale;
    background.height = HEIGHT * scale;
    const bg = background.getContext("2d")!;
    bg.scale(scale, scale);
    walls(bg);
    let frame = 0;
    const position = (key: string, x: number, y: number, direction: Direction) => {
      const pose = playback.position(key) ?? { x, y, direction, moving: false };
      return { x: (pose.x + 0.5) * TILE, y: (pose.y + 0.5) * TILE, direction: pose.direction, moving: pose.moving };
    };
    const render = (time: number) => {
      playback.advance(time);
      const { state, you } = playback;
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.drawImage(background, 0, 0, WIDTH, HEIGHT);
      const now = playback.serverNow(time);
      const power = new Set(state?.powerPellets);
      const pellets = state?.pellets ?? MAZE.flatMap((row, y) => [...row].flatMap((c, x) => c === "." || c === "o" ? [y * COLS + x] : []));
      ctx.fillStyle = "#d5c6a3";
      for (const pellet of pellets) {
        const x = (pellet % COLS + 0.5) * TILE;
        const y = (Math.floor(pellet / COLS) + 0.5) * TILE;
        ctx.beginPath();
        ctx.arc(x, y, power.has(pellet) ? 4.5 + Math.sin(time / 220) : 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const ghost of state?.ghosts ?? []) {
        const key = `ghost-${ghost.id}`;
        const { x, y, direction } = position(key, ghost.x, ghost.y, ghost.direction);
        const frightened = state!.poweredUntil > now;
        ctx.save(); ctx.translate(x, y);
        ctx.globalAlpha = ghost.asleepUntil > now ? 0.25 : 1;
        ctx.fillStyle = frightened ? "#5273ee" : ghost.color;
        ctx.beginPath();
        ctx.arc(0, -1, 9, Math.PI, 0);
        ctx.lineTo(9, 9);
        for (let i = 0; i < 3; i++) { ctx.lineTo(6 - i * 6, 6); ctx.lineTo(3 - i * 6, 9); }
        ctx.lineTo(-9, -1); ctx.fill();
        ctx.fillStyle = "#f7f5ec";
        for (const eye of [-3.7, 3.7]) {
          ctx.beginPath(); ctx.ellipse(eye, -1.5, 2.8, 3.5, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = "#17264b";
        for (const eye of [-3.7, 3.7]) {
          ctx.beginPath(); ctx.arc(eye + Math.cos(ANGLES[direction]), -1.5 + Math.sin(ANGLES[direction]), 1.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
      // Draw your Pac last so it stays visible when teammates share a tile.
      const players = [...(state?.players ?? [])].sort((a, b) => Number(a.id === you) - Number(b.id === you));
      for (const player of players) {
        const key = player.id;
        const { x, y, direction, moving } = position(key, player.x, player.y, player.direction);
        ctx.save(); ctx.translate(x, y);
        if (player.id === you) {
          ctx.strokeStyle = player.color; ctx.globalAlpha = 0.55;
          ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
          ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
        ctx.rotate(ANGLES[direction]);
        ctx.globalAlpha = player.immuneUntil > now ? 0.55 + Math.sin(time / 90) * 0.25 : 1;
        const mouth = moving ? 0.15 + (Math.sin(time / 65) + 1) * 0.2 : 0.22;
        ctx.fillStyle = player.color;
        ctx.shadowColor = player.color; ctx.shadowBlur = player.id === you ? 12 : 5;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 9.5, mouth, Math.PI * 2 - mouth); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = "#11151b";
        ctx.beginPath(); ctx.arc(0.7, -5, 1.35, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [playback]);

  return <canvas ref={canvas} className="maze-canvas" role="img"
    aria-label="Shared Pac-Man maze. Use arrow keys or WASD to move your Pac-Man."
    onPointerDown={(e) => { touch.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerUp={(e) => {
      const start = touch.current;
      touch.current = null;
      if (!start) return;
      const dx = e.clientX - start.x; const dy = e.clientY - start.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return;
      onDirection(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? "right" : "left" : dy > 0 ? "down" : "up");
    }}
    onPointerCancel={() => { touch.current = null; }} />;
}
