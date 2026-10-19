/**
 * The playground's DJ decks: the simulated PRO DJ LINK set that drives
 * `dj_link` nodes (the gate's package plays it; see `DjLinkSim`). Two decks
 * as a DJ works them, the mixer, the Auto DJ and the LINK cable, and below
 * them what the patch sees: the node's outputs and its events as they fire.
 */

import {
  DJ_EVENTS,
  DjSound,
  type DeckAction,
  type DjDeckState,
  type DjEvent,
  type DjLinkSim,
  type DjLinkState,
  type PatchRuntime,
  type PhraseKind,
} from "@empyrean-gate/patch-web/runtime";
import { useEffect, useState, type KeyboardEvent } from "react";

const EVENT_LABELS: Record<DjEvent, string> = {
  play: "Play",
  cue: "Cue",
  cue_release: "Cue release",
  on_air_event: "On air",
  off_air_event: "Off air",
  loop_start: "Loop start",
  loop_wrap: "Loop wrap",
  loop_end: "Loop end",
  jump: "Jump",
  phrase_change: "Phrase",
  fill_in: "Fill-in",
};

const PHRASE_LABELS: Record<PhraseKind, string> = {
  intro: "Intro",
  up: "Build",
  down: "Breakdown",
  chorus: "Chorus",
  outro: "Outro",
  verse: "Verse",
  bridge: "Bridge",
};

const MODE_LABELS: Record<DjDeckState["mode"], string> = {
  empty: "Empty",
  cued: "At the cue",
  playing: "Playing",
  paused: "Paused",
  cuePlaying: "Cue-play (held)",
  ended: "Ended",
};

/** How long an event's lamp stays lit, seconds. */
const LAMP = 0.6;

export default function DjDecks({
  dj,
  runtime,
}: {
  dj: DjLinkSim | null;
  runtime: PatchRuntime | null;
}) {
  const [state, setState] = useState<DjLinkState | null>(null);
  // The set out loud, once the person asks (a click starts the audio).
  const [sound, setSound] = useState<DjSound | null>(null);
  const [volume, setVolume] = useState(0.6);
  const [listenError, setListenError] = useState<string | null>(null);
  useEffect(() => () => sound?.stop(), [sound]);
  useEffect(() => () => setSound(null), [dj]);

  // The set moves with the preview's frames; read it ~15 times a second.
  useEffect(() => {
    if (!dj) {
      setState(null);
      return;
    }
    setState(dj.state());
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last > 66) {
        last = now;
        setState(dj.state());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dj]);

  if (!dj || !state) {
    return (
      <fieldset className="pg-dj">
        <legend>DJ decks (PRO DJ LINK)</legend>
        <p className="pg-dj-hint">The decks play with the live preview.</p>
      </fieldset>
    );
  }

  const refresh = () => setState(dj.state());
  const act = (player: 1 | 2, a: DeckAction) => {
    dj.act(player, a);
    refresh();
  };
  const o = state.outputs;
  const followed = state.decks.find((d) => d.player === state.followed);

  return (
    <fieldset className="pg-dj">
      <legend>DJ decks (PRO DJ LINK)</legend>
      <div className="pg-row pg-wrap">
        <label className="pg-check">
          <input
            type="checkbox"
            checked={state.connected}
            onChange={(e) => {
              dj.connected = e.target.checked;
              refresh();
            }}
          />
          LINK connected
        </label>
        <label className="pg-check">
          <input
            type="checkbox"
            checked={state.auto}
            onChange={(e) => {
              dj.auto = e.target.checked;
              refresh();
            }}
          />
          Auto DJ
        </label>
        <button
          type="button"
          onClick={() => {
            dj.reset(0);
            refresh();
          }}
        >
          Start the set again
        </button>
        <span className="pg-dj-clock">
          {clock(state.time)} · {state.bpm} BPM
        </span>
      </div>
      <div className="pg-row pg-wrap">
        <button
          type="button"
          aria-pressed={!!sound}
          disabled={!runtime}
          onClick={() => {
            if (sound) {
              setSound(null);
              return;
            }
            if (!runtime) return;
            setListenError(null);
            DjSound.listen(runtime, dj, { volume })
              .then(setSound)
              .catch((e: unknown) =>
                setListenError(e instanceof Error ? e.message : String(e)),
              );
          }}
        >
          {sound ? "Stop listening" : "Listen to the set"}
        </button>
        {sound && (
          <>
            <label className="pg-slider pg-dj-volume">
              Volume
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v);
                  sound.volume = v;
                }}
              />
            </label>
            <span className="pg-dj-meter pg-dj-out" aria-hidden="true">
              <span style={{ width: `${Math.round(sound.level() * 100)}%` }} />
            </span>
          </>
        )}
      </div>
      {listenError && <p className="pg-dj-hint">{listenError}</p>}
      {sound && (
        <p className="pg-dj-hint">
          Each deck through its fader and the crossfader. With the microphone
          on, use headphones.
        </p>
      )}
      <p className="pg-dj-hint">
        {state.connected
          ? "A two-deck set, read the way the gate reads real CDJs. Touch a deck to take over from the Auto DJ."
          : "Unplugged: dj_link reads as on a gate with no CDJs (active 0, mix holds). The music plays on."}
      </p>

      <div className="pg-dj-decks">
        {state.decks.map((d) => (
          <Deck
            key={d.player}
            d={d}
            crate={dj.crate.map((t) => t.title)}
            act={(a) => act(d.player, a)}
          />
        ))}
      </div>

      <p className="pg-dj-legend" aria-hidden="true">
        {(["intro", "up", "chorus", "down", "verse", "bridge"] as const).map(
          (k) => (
            <span key={k}>
              <span className={`pg-dj-swatch pg-dj-k-${k}`} />
              {k === "intro" ? "Intro, outro" : PHRASE_LABELS[k]}
            </span>
          ),
        )}
        <span>
          <span className="pg-dj-swatch pg-dj-swatch-fill" />
          Fill-in
        </span>
      </p>

      <label className="pg-slider">
        Crossfader
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={state.crossfader}
          aria-valuetext={`${Math.round((1 - state.crossfader) * 100)}% deck 1, ${Math.round(state.crossfader * 100)}% deck 2`}
          onChange={(e) => {
            dj.setCrossfader(Number(e.target.value));
            refresh();
          }}
        />
      </label>

      <div
        className="pg-dj-sees"
        aria-label="What the patch's PRO DJ LINK node sees"
      >
        <span className="pg-dj-sees-head">The patch sees</span>
        <span className="pg-dj-chip" data-lit={o.active === 1}>
          {o.active ? "active" : "inactive"}
        </span>
        <span className="pg-dj-chip">deck {o.deck || "–"}</span>
        <span className="pg-dj-chip">
          {o.playing ? "playing" : "stopped"}
          {o.on_air ? ", on air" : ""}
        </span>
        <span className="pg-dj-chip">mix {o.mix.toFixed(2)}</span>
        <span className="pg-dj-chip">beat {o.beat_in_bar || "–"}</span>
        <span className="pg-dj-chip">
          {o.phrase_active && followed?.phrase
            ? `${PHRASE_LABELS[followed.phrase.kind]} ${Math.round(o.phrase_progress * 100)}%${o.phrase_fill ? ", fill-in" : ""}`
            : "no phrase"}
        </span>
        <span className="pg-dj-chip pg-dj-energy">
          energy
          <span className="pg-dj-meter" aria-hidden="true">
            <span style={{ width: `${Math.round(o.energy * 100)}%` }} />
          </span>
          {o.energy.toFixed(2)}
        </span>
      </div>
      <div className="pg-dj-events" aria-label="Events as they fire">
        {DJ_EVENTS.map((e) => {
          const f = state.lastFired[e];
          const age = f ? state.time - f.at : Infinity;
          const lit = age < LAMP;
          return (
            <span
              key={e}
              className="pg-dj-event"
              data-lit={lit}
              style={
                lit ? { opacity: 0.45 + 0.55 * (1 - age / LAMP) } : undefined
              }
            >
              {EVENT_LABELS[e]}
              {f && <span className="pg-dj-event-deck">{f.player}</span>}
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}

function Deck({
  d,
  crate,
  act,
}: {
  d: DjDeckState;
  crate: string[];
  act: (a: DeckAction) => void;
}) {
  const playing = d.mode === "playing" || d.mode === "cuePlaying";
  // CUE is held, not clicked: down at the cue point is cue-play, up returns.
  const cueKey = (e: KeyboardEvent, down: boolean) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (down && e.repeat) return;
    act({ action: down ? "cue" : "cue_release" });
  };
  const bar = d.beat > 0 ? Math.floor((d.beat - 1) / 4) + 1 : 0;

  return (
    <div className="pg-dj-deck" data-on-air={d.onAir}>
      <div className="pg-dj-head">
        <span className="pg-dj-num">{d.player}</span>
        <span className="pg-dj-title">
          {d.title ?? "No track"}
          {d.artist && <span className="pg-dj-artist"> {d.artist}</span>}
        </span>
      </div>
      <div className="pg-dj-lamps">
        <span className="pg-dj-lamp" data-lit={d.master}>
          Master
        </span>
        <span className="pg-dj-lamp" data-lit={d.onAir}>
          On air
        </span>
        <span className="pg-dj-lamp" data-lit={d.looping}>
          Loop{d.loopBeats ? ` ${d.loopBeats}` : ""}
        </span>
      </div>
      <PhraseStrip d={d} />
      <p className="pg-dj-readout">
        {MODE_LABELS[d.mode]}
        {d.beat > 0 && ` · bar ${bar}.${d.beatInBar}`}
        {d.phrase &&
          ` · ${PHRASE_LABELS[d.phrase.kind]} ${Math.round(d.phrase.progress * 100)}%${d.phrase.fill ? ", fill-in" : ""}`}
      </p>
      <div className="pg-row pg-wrap pg-dj-buttons">
        <button
          type="button"
          aria-pressed={playing}
          disabled={d.track === null || d.mode === "ended"}
          onClick={() => act({ action: "play" })}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          className="pg-dj-cue"
          aria-pressed={d.mode === "cuePlaying"}
          disabled={d.track === null}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            act({ action: "cue" });
          }}
          onPointerUp={() => act({ action: "cue_release" })}
          onPointerCancel={() => act({ action: "cue_release" })}
          onKeyDown={(e) => cueKey(e, true)}
          onKeyUp={(e) => cueKey(e, false)}
        >
          Cue (hold)
        </button>
        <button
          type="button"
          aria-pressed={d.loopBeats !== null}
          disabled={d.track === null}
          onClick={() =>
            act(
              d.loopBeats !== null
                ? { action: "exit_loop" }
                : { action: "loop", beats: 4 },
            )
          }
        >
          {d.loopBeats !== null ? "Exit loop" : "Loop 4"}
        </button>
        <button
          type="button"
          disabled={d.track === null}
          aria-label="Jump back 16 beats"
          onClick={() => act({ action: "beat_jump", beats: -16 })}
        >
          −16
        </button>
        <button
          type="button"
          disabled={d.track === null}
          aria-label="Jump forward 16 beats"
          onClick={() => act({ action: "beat_jump", beats: 16 })}
        >
          +16
        </button>
        <button
          type="button"
          aria-pressed={d.master}
          onClick={() => act({ action: "master" })}
        >
          Master
        </button>
      </div>
      <label className="pg-slider">
        Track
        <select
          value={d.track ?? ""}
          onChange={(e) =>
            act({ action: "load", track: Number(e.target.value) })
          }
        >
          {d.track === null && <option value="">No track</option>}
          {crate.map((title, i) => (
            <option key={title} value={i}>
              {title}
            </option>
          ))}
        </select>
      </label>
      <label className="pg-slider">
        Fader
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={d.fader}
          onChange={(e) =>
            act({ action: "fader", value: Number(e.target.value) })
          }
        />
      </label>
    </div>
  );
}

/** The track's phrases end to end, the playhead on them. */
function PhraseStrip({ d }: { d: DjDeckState }) {
  if (!d.beats) return <div className="pg-dj-strip" aria-hidden="true" />;
  const at = d.phrase
    ? d.phrases.find((p) => p.number === d.phrase!.number)
    : undefined;
  const pos = at
    ? (at.start - 1 + d.phrase!.progress * (at.end - at.start + 1)) / d.beats
    : (d.beat - 1) / d.beats;
  return (
    <div className="pg-dj-strip" aria-hidden="true">
      {d.phrases.map((p) => (
        <span
          key={p.number}
          className={`pg-dj-phrase pg-dj-k-${p.kind}`}
          style={{ flexGrow: p.end - p.start + 1 }}
        >
          {p.fillFrom !== null && (
            <span
              className="pg-dj-fill"
              style={{
                width: `${((p.end - p.fillFrom + 1) / (p.end - p.start + 1)) * 100}%`,
              }}
            />
          )}
        </span>
      ))}
      <span className="pg-dj-head-pos" style={{ left: `${pos * 100}%` }} />
    </div>
  );
}

function clock(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
