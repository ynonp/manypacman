"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Direction, GameState } from "@/lib/maze";
import MazeCanvas from "./maze-canvas";
import { GamePlayback } from "@/lib/game-playback";
import type { GameUpdate, PlayerCommand } from "@/lib/game-protocol";

const KEYS: Record<string, Direction> = {
  ArrowUp: "up", w: "up", W: "up", ArrowRight: "right", d: "right", D: "right",
  ArrowDown: "down", s: "down", S: "down", ArrowLeft: "left", a: "left", A: "left",
};
const format = (n: number) => n.toLocaleString("en-US").padStart(5, "0");

function PacIcon({ color = "currentColor", size = 22 }: { color?: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M21.2 6.4a10.5 10.5 0 1 0 0 11.2L12 12Z" fill={color} /><circle cx="11" cy="5.5" r="1.2" fill="#11151b" /></svg>;
}
function SoundIcon({ muted }: { muted: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z" />{muted ? <path d="m16 9 6 6m0-6-6 6" /> : <><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>}</svg>;
}

export default function PacmanGame() {
  const [playback] = useState(() => new GamePlayback());
  const [state, setState] = useState<GameState | null>(null);
  const [you, setYou] = useState<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [sound, setSound] = useState(false);
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState("");
  const [moved, setMoved] = useState(false);
  const [retry, setRetry] = useState(0);
  const identity = useRef<string | null>(null);
  const live = useRef(false);
  const pending = useRef<PlayerCommand | null>(null);
  const sequence = useRef(0);
  const sending = useRef(false);
  const audio = useRef<AudioContext | null>(null);
  const soundOn = useRef(false);
  const lastScore = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);

  const sendDirection = useCallback((direction: Direction | "stop") => {
    if (!identity.current || !live.current) return;
    if (direction !== "stop") setMoved(true);
    const command = { id: identity.current, direction, sequence: ++sequence.current };
    playback.command(command, performance.now(), true);
    pending.current = command;
    const flush = async () => {
      if (sending.current) return;
      sending.current = true;
      try {
        while (pending.current && identity.current && live.current) {
          const input = pending.current;
          pending.current = null;
          const response = await fetch("/api/game", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input), signal: AbortSignal.timeout(4000),
          });
          if (!response.ok) throw new Error("Movement was not delivered");
        }
      } catch {
        pending.current = null;
        live.current = false;
        setStatus("reconnecting");
        setRetry((value) => value + 1);
      } finally { sending.current = false; }
    };
    void flush();
  }, [playback]);

  useEffect(() => {
    const stream = new EventSource("/api/game");
    let lastMessage = Date.now();
    stream.addEventListener("welcome", (event) => {
      const { id } = JSON.parse(event.data);
      identity.current = id;
      playback.reset(id);
      sequence.current = 0;
      setYou(id);
      setMoved(false);
    });
    const refresh = () => {
      const snapshot = playback.state;
      if (!snapshot) return;
      lastMessage = Date.now();
      live.current = true;
      setStatus("live");
      setState(snapshot);
      const score = snapshot.players.find((p) => p.id === identity.current)?.score ?? 0;
      if (soundOn.current && audio.current && score > lastScore.current) {
        const ctx = audio.current;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(600, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.07);
        gain.gain.setValueAtTime(0.055, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        oscillator.connect(gain); gain.connect(ctx.destination);
        oscillator.start(); oscillator.stop(ctx.currentTime + 0.08);
      }
      lastScore.current = score;
    };
    stream.addEventListener("state", (event) => {
      playback.receive(JSON.parse(event.data) as GameState, performance.now());
      refresh();
    });
    for (const type of ["patch", "sync"] as const) {
      stream.addEventListener(type, (event) => {
        playback.update(JSON.parse(event.data) as GameUpdate, performance.now(), type === "sync");
        refresh();
      });
    }
    stream.addEventListener("input", (event) => {
      playback.command(JSON.parse(event.data) as PlayerCommand, performance.now());
      lastMessage = Date.now();
    });
    stream.onerror = () => {
      live.current = false;
      setStatus("reconnecting");
    };
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastMessage > 8000) {
        lastMessage = Date.now();
        setRetry((value) => value + 1);
      }
    }, 4000);
    return () => {
      stream.close(); clearInterval(watchdog);
      live.current = false; identity.current = null; pending.current = null;
    };
  }, [retry, playback]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
          || event.target instanceof HTMLSelectElement || (event.target instanceof HTMLElement && event.target.isContentEditable)
          || dialog.current?.open) return;
      if (event.code === "Space" && event.target instanceof HTMLButtonElement) return;
      if (KEYS[event.key] || event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) sendDirection(event.code === "Space" ? "stop" : KEYS[event.key]);
      }
    };
    const stop = () => sendDirection("stop");
    const visibility = () => { if (document.hidden) stop(); };
    window.addEventListener("keydown", keydown);
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", keydown); window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [sendDirection]);

  useEffect(() => {
    if (help) { sendDirection("stop"); dialog.current?.showModal(); }
    else dialog.current?.close();
  }, [help, sendDirection]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => () => { void audio.current?.close(); }, []);

  const me = state?.players.find((p) => p.id === you);
  const remaining = state?.pellets.length ?? 0;
  const progress = state ? Math.round((1 - remaining / state.totalPellets) * 100) : 0;
  const powered = state ? Math.max(0, Math.ceil((state.poweredUntil - state.now) / 1000)) : 0;
  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setToast("Link copied. Bring your pack."); }
    catch { setHelp(true); setToast("Share this page’s address to invite a friend."); }
  };

  return <div className="app-shell">
    <header className="site-header">
      <a className="wordmark" href="/" aria-label="Many Pac home"><PacIcon size={26} /><span>many<span className="wordmark-light">pac</span><span className="logo-dot">.</span></span></a>
      <div className="header-center"><span className="tiny-dot" /> A MULTIPLAYER ARCADE</div>
      <button className="outline-button invite-button" onClick={share}><span>Invite a friend</span><span aria-hidden="true">↗</span></button>
    </header>

    <main>
      <section className="intro" aria-labelledby="game-title">
        <div><div className="eyebrow"><span className="short-line" /> THE MORE, THE WAKA.</div><h1 id="game-title">ONE MAZE. <span>MANY PACS.</span></h1><p>A classic, with company. Jump in, chase dots, and clear the board together.</p></div>
        <div className="coop-stamp"><span className="stamp-pacs"><PacIcon color="#f5ed63" size={23} /><PacIcon color="#70e4d0" size={23} /><PacIcon color="#f397c8" size={23} /></span><span>LESS COMPETITION.<br /><strong>MORE COOPERATION.</strong></span></div>
      </section>

      <div className="game-layout">
        <section className={`arcade ${powered ? "powered" : ""}`} aria-label="Live cooperative game">
          <div className="arcade-top"><div className="room-name"><span className={`status-dot ${status === "live" ? "online" : ""}`} /><span>{status === "live" ? "THE COMMON ROOM" : status === "connecting" ? "CONNECTING" : "RECONNECTING"}</span></div><div className="level-tag">LEVEL <strong>{String(state?.level ?? 1).padStart(2, "0")}</strong></div></div>
          <div className="board-wrap">
            <MazeCanvas playback={playback} onDirection={sendDirection} />
            {status !== "live" && <div className="board-overlay connection-overlay"><div className="overlay-card"><span className="loader" /><strong>{status === "connecting" ? "Finding your pack…" : "Getting you back in…"}</strong><span>{status === "connecting" ? "One board. Everyone’s invited." : "Your connection will retry automatically."}</span><button className="outline-button" onClick={() => setRetry((value) => value + 1)}>Reconnect now ↗</button></div></div>}
            {!!state?.nextLevelAt && status === "live" && <div className="board-overlay"><div className="overlay-card victory"><PacIcon size={40} /><div className="eyebrow">NICE TEAMWORK</div><strong>MAZE CLEARED!</strong><span>Next level in {Math.max(1, Math.ceil((state.nextLevelAt - state.now) / 1000))}…</span></div></div>}
          </div>
          <div className="arcade-bottom"><span className="board-hint">{powered ? <><span className="power-spark">✦</span> POWER PARTY · {powered}s · GO GET THOSE GHOSTS</> : !moved ? "YOUR PAC IS READY. MAKE YOUR FIRST MOVE." : "EVERY DOT COUNTS. EVERY PAC HELPS."}</span><button className={`icon-button ${sound ? "sound-active" : ""}`} aria-label={sound ? "Mute sound" : "Enable sound"} aria-pressed={sound} onClick={() => {
            const next = !sound;
            if (next) {
              audio.current ??= new AudioContext();
              void audio.current.resume();
            }
            soundOn.current = next; setSound(next);
          }}><SoundIcon muted={!sound} /></button></div>
      <div className="touch-controls" aria-label="Movement controls">{(["up", "left", "down", "right"] as Direction[]).map((direction) => <button key={direction} className={`direction-button dir-${direction}`} aria-label={`Move ${direction}`} onClick={() => sendDirection(direction)}>{({ up: "↑", left: "←", down: "↓", right: "→" })[direction]}</button>)}<button className="stop-button" aria-label="Stop moving" onClick={() => sendDirection("stop")}>■</button></div>
        </section>

        <aside className="sidebar">
          <section className="score-panel"><div className="panel-label"><span>TEAM SCORE</span><span className="mini-badge">CO-OP</span></div><div className="team-score">{format(state?.score ?? 0)}</div><div className="score-caption">A shared maze. A shared victory.</div><div className="progress-heading"><span>MAZE CLEARED</span><strong>{progress}<span>%</span></strong></div><div className="progress-track" role="progressbar" aria-label="Maze cleared" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${progress}%` }} /></div><div className="pellets-left"><span className="pellet-icon" />{state ? remaining : "—"} dots to the next level</div></section>
          <section className="crew-panel"><div className="panel-label"><span>THE PACK</span><span className="crew-count">{status === "live" ? state?.players.length ?? 0 : "—"} ONLINE</span></div><div className="crew-list">{state?.players.map((player) => <div className={`crew-member ${player.id === you ? "is-you" : ""}`} key={player.id}><div className="avatar" style={{ color: player.color }}><PacIcon size={22} /></div><div className="member-name">{player.name}{player.id === you && <span className="you-tag">YOU</span>}</div><div className="member-score">{player.score.toLocaleString("en-US")}</div></div>)}{!state && <div className="waiting-copy">Your pack is on the way…</div>}</div><button className="bring-friends" onClick={share}><span className="plus-icon">+</span><span>There’s room for your friends</span><span aria-hidden="true">↗</span></button></section>
          <section className="field-notes"><div className="panel-label"><span>SMALL DOTS. BIG TEAMWORK.</span><span aria-hidden="true">✳</span></div><p>Eat dots. Dodge ghosts. Grab a power pellet to make the whole pack unstoppable.</p><div className="legend"><span><i className="legend-dot" />10 PTS</span><span><i className="legend-power" />50 PTS + POWER</span></div><div className="notes-bottom"><span>GOT CAUGHT? RESPAWN & KEEP GOING.</span><button aria-label="How to play" className="help-button" onClick={() => setHelp(true)}>?</button></div></section>
          <div className="your-pac"><span className="status-dot online" /><span>{me ? <>YOU’RE <strong style={{ color: me.color }}>{me.name.toUpperCase()}</strong>. GOOD TO HAVE YOU.</> : "NO SIGN-UP. JUST SHOW UP."}</span></div>
        </aside>
      </div>

      <div className="controls-bar"><div className="keyboard-controls"><div className="key-group"><kbd>↑</kbd><div><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd></div></div><span>or <strong>W A S D</strong> to move</span><span className="control-divider" /><kbd className="space-key">SPACE</kbd><span>to stop</span></div><div className="control-note"><span className="tiny-dot" /> Drop in. Team up. Waka on.</div></div>
    </main>
    <footer className="site-footer"><span>BUILT FOR THE PACK<span className="footer-star">✳</span></span><span>NO LOBBY. NO WAITING. JUST WAKA.</span><button onClick={() => setHelp(true)}>HOW TO PLAY ↗</button></footer>
    <div className="toast" role="status">{toast}</div>
    <dialog ref={dialog} className="help-dialog" onCancel={() => setHelp(false)} onClick={(event) => { if (event.target === event.currentTarget) setHelp(false); }}><div className="dialog-body"><button className="dialog-close icon-button" aria-label="Close instructions" onClick={() => setHelp(false)}>×</button><PacIcon color="#f5ed63" size={36} /><div className="eyebrow">WELCOME TO THE PACK</div><h2>A little teamwork.<br />A lot of dots.</h2><p>You join the same live maze as everyone else. Your Pac has a dotted ring around it.</p><ul><li><strong>Move</strong> with arrow keys, WASD, a swipe, or the touch arrows. Your Pac keeps going; turns queue until the next opening.</li><li><strong>Stop</strong> with Space or the square button. Opening these instructions stops your Pac too.</li><li><strong>Collect</strong> small dots for 10 points and power pellets for 50. Power lasts 8 seconds for the whole team. Blue ghosts are worth 200 points.</li><li><strong>Keep going.</strong> Ghosts send you back with a short protective shield. There are no lives to run out of.</li><li><strong>Clear every dot</strong> together to reach the next level. Share this page’s address to bring a friend.</li></ul><button className="primary-button" onClick={() => setHelp(false)}>LET’S WAKA <span>→</span></button></div></dialog>
  </div>;
}
