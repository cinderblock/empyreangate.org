/**
 * The pattern playground: the gate's own node editor, with the gate's own
 * patch compiler and evaluator (wasm) and the very shader the gate runs
 * (WebGPU), all in the visitor's browser. Patches live in IndexedDB; Save
 * writes the same JSON file the gate keeps, so it can be opened on the gate.
 *
 * Client-only: `routes/playground.tsx` loads this after hydration.
 */

import {
  openPatchFromDisk,
  PatchEditor,
  savePatchToDisk,
  type GlobalControl,
  type PatchDoc,
} from "@empyrean-gate/patch-web/editor";
import {
  loadPatchCore,
  PatchRuntime,
  screenToPolar,
  WebGpuUnavailable,
  type PatchCore,
  type RuntimeStatus,
} from "@empyrean-gate/patch-web/runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { PLAYGROUND } from "../content/site";
import { BPM, syntheticAudio } from "../gate/engine";
import SubmitDialog from "./SubmitDialog";
import { LocalPatchStore } from "./store";
import "./playground.css";

/** What a first visit opens: a copy of this built-in preset. */
const STARTER = "Rainbow Sparkle";

const PENS = ["glow", "ripple", "sparkle", "comet", "ring", "beam", "ember"];

/** PRO DJ LINK event outputs, in `fireDjEvent` index order. */
const DJ_EVENTS = [
  ["Play", 0],
  ["Cue", 1],
  ["Loop wrap", 6],
  ["Jump", 8],
  ["Phrase", 9],
  ["Fill-in", 10],
] as const;

type Tool = { mode: "tap"; effect: string } | { mode: "draw"; pen: string };

export default function Playground() {
  const store = useMemo(() => new LocalPatchStore(), []);
  const [core, setCore] = useState<PatchCore | null>(null);
  const [runtime, setRuntime] = useState<PatchRuntime | null>(null);
  const [gpuError, setGpuError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(store.active);
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [doc, setDoc] = useState<PatchDoc | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [tool, setTool] = useState<Tool>({ mode: "tap", effect: "burst" });
  const [hue, setHue] = useState(0.52);
  const [groove, setGroove] = useState(true);
  const [mic, setMic] = useState(false);
  const [motion, setMotion] = useState(false);
  const [mediaName, setMediaName] = useState<string | null>(null);
  const [brightness, setBrightness] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [djMix, setDjMix] = useState(0.5);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Phones: the gate docks at the top as you scroll (unless turned off), and
  // a one-time toast says a desktop is the better tool for building.
  const stageRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const narrow = useMediaQuery(NARROW);
  const [keepInView, setKeepInView] = useStoredFlag(DOCK_KEY, true);
  const [toastSeen, setToastSeen] = useStoredFlag(TOAST_KEY, false);
  const [docked, setDocked] = useState(false);
  const dockActive = narrow && keepInView && !gpuError;

  // Patch core (always) and a GPU runtime (where WebGPU exists). Without
  // WebGPU the editor still works: patches validate, save and submit; only
  // the live preview is missing.
  useEffect(() => {
    let live = true;
    let rt: PatchRuntime | null = null;
    void (async () => {
      let c: PatchCore;
      try {
        c = await loadPatchCore();
      } catch (e) {
        setNotice(
          `The playground could not load the gate's patch engine: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
      if (!live) return;
      store.migrate = c.migrate;
      if (await store.isEmpty()) {
        const starter =
          c.presets.find((p) => p.name === STARTER) ?? c.presets[0];
        if (starter) {
          const seeded = await store.put({
            ...structuredClone(starter),
            id: "",
          });
          store.activate(seeded.id);
        }
      }
      setCore(c);
      setReady(true);
      try {
        rt = await PatchRuntime.create();
        if (!live) {
          rt.dispose();
          return;
        }
        setRuntime(rt);
        // Dev builds expose the runtime for poking at from the console/tests.
        if (import.meta.env.DEV)
          Object.assign(window, { __playground: { runtime: rt, store } });
      } catch (e) {
        setGpuError(
          e instanceof WebGpuUnavailable
            ? `${e.message} The editor still works: you can build, save and submit patterns, but the live preview needs a browser with WebGPU (current Chrome, Edge or Safari).`
            : `The live preview could not start: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    })();
    return () => {
      live = false;
      rt?.dispose();
    };
  }, [store]);

  useEffect(() => store.onActive(setActiveId), [store]);

  // The runtime follows the canvas, its own status, and the open document.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!runtime || !canvas) return;
    runtime.attach(canvas);
    runtime.start();
    const off = runtime.onStatus(setStatus);
    return () => {
      off();
      runtime.detach(canvas);
      runtime.stop();
    };
  }, [runtime]);

  useEffect(() => {
    void runtime?.setPatch(doc);
  }, [runtime, doc]);

  // The dock. The canvas starts full width and, as the page scrolls, scales
  // (a transform: the canvas and its WebGPU context are never re-created)
  // into the sticky bar at the top; its bottom edge tracks the content
  // below it exactly, because the spacer in flow is as tall as the distance
  // it shrinks. Once docked, the canvas is really made small, so the GPU
  // stops drawing a full-size frame for a thumbnail.
  useEffect(() => {
    const stage = stageRef.current;
    const dock = dockRef.current;
    const spacer = spacerRef.current;
    if (!dockActive || !stage || !dock || !spacer) {
      setDocked(false);
      return;
    }
    let raf = 0;
    let wasDocked = false;
    const update = () => {
      raf = 0;
      const w = dock.clientWidth;
      const h = dock.clientHeight;
      const travel = Math.max(1, w - h);
      const contentTop = spacer.getBoundingClientRect().bottom;
      const p = Math.min(1, Math.max(0, (w - contentTop) / travel));
      stage.style.setProperty("--pg-w", `${w}px`);
      stage.style.setProperty("--pg-p", p.toFixed(4));
      stage.style.setProperty("--pg-scale", (1 - p * (1 - h / w)).toFixed(4));
      const isDocked = p >= 0.999;
      if (isDocked !== wasDocked) {
        wasDocked = isDocked;
        setDocked(isDocked);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(dock);
    update();
    return () => {
      window.removeEventListener("scroll", schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      for (const v of ["--pg-w", "--pg-p", "--pg-scale"])
        stage.style.removeProperty(v);
    };
  }, [dockActive]);

  // Without a runtime, still tell the visitor whether the patch would run.
  useEffect(() => {
    if (runtime || !core || !doc) return;
    const errors = core.validate(doc);
    setStatus({
      active: false,
      touch: false,
      error: errors.length ? errors.join("; ") : null,
    });
  }, [runtime, core, doc]);

  // Continuous stand-ins: a synthetic groove (when no microphone) and a fake
  // DJ deck riding the same beat, so audio- and DJ-driven nodes move.
  const grooveRef = useRef({ groove, mic, djMix, t: 0 });
  grooveRef.current.groove = groove;
  grooveRef.current.mic = mic;
  grooveRef.current.djMix = djMix;
  useEffect(() => {
    if (!runtime) return;
    return runtime.onFrame((dt) => {
      const g = grooveRef.current;
      g.t += dt;
      if (!g.mic) {
        if (g.groove) {
          const a = syntheticAudio(g.t);
          runtime.setAudio(
            0,
            new Float32Array([
              a.level,
              a.bass,
              a.mid,
              a.treble,
              a.onset,
              a.beatPhase,
              BPM,
              1,
              a.bass,
              a.mid,
              a.treble,
            ]),
          );
        } else {
          runtime.setAudio(0, new Float32Array(11));
        }
      }
      const beat = Math.floor((g.t * BPM) / 60);
      const phrase = ((g.t * BPM) / 60 / 32) % 1;
      runtime.setDjLink(
        new Float32Array([
          1, // active
          syntheticAudio(g.t).level, // energy
          1,
          -1,
          1,
          -1, // deck, deck_side, event_deck, event_side
          1,
          1,
          1,
          0, // playing, on_air, deck_1_on_air, deck_2_on_air
          0, // looping
          g.djMix,
          0, // mix, mix_activity
          (beat % 4) + 1, // beat_in_bar
          1,
          1,
          phrase,
          0, // phrase_active, phrase_kind, phrase_progress, phrase_fill
        ]),
      );
    });
  }, [runtime]);

  useEffect(
    () => runtime?.setMaster(brightness, speed),
    [runtime, brightness, speed],
  );

  const onDocChange = useCallback(
    (d: PatchDoc | null) => {
      setDoc(d);
      if (d?.id && d.id !== store.active) store.activate(d.id);
    },
    [store],
  );

  // --- the preview as an instrument ----------------------------------------

  const strokes = useRef(
    new Map<number, { x: number; y: number; dir: number }>(),
  );
  const fire = (angle: number, radius: number) => {
    if (tool.mode !== "tap") return;
    runtime?.trigger({
      kind: tool.effect,
      angle,
      radius: Math.min(1, radius),
      hue,
      saturation: 0.85,
      brightness: 1,
    });
  };
  // A patch with Touch nodes owns the surface: every pointer goes to it raw.
  const ownsTouch = status?.touch === true;
  /** Pointers currently down on the canvas (raw-touch mode). */
  const held = useRef(new Set<number>());
  const rawTouch = (
    e: React.PointerEvent<HTMLCanvasElement>,
    phase: "down" | "move" | "up",
  ) => {
    if (phase === "down") held.current.add(e.pointerId);
    else if (phase === "up" && !held.current.delete(e.pointerId)) return;
    runtime?.touch(
      e.pointerId,
      phase,
      screenToPolar(e.currentTarget, e.clientX, e.clientY),
      { hue, saturation: 0.85 },
    );
  };

  const paint = (id: number, clientX: number, clientY: number) => {
    if (tool.mode !== "draw" || !canvasRef.current) return;
    const p = screenToPolar(canvasRef.current, clientX, clientY);
    const x = p.radius * Math.cos(p.angle);
    const y = p.radius * Math.sin(p.angle);
    const prev = strokes.current.get(id);
    let dir = prev?.dir ?? 0;
    if (prev && Math.hypot(x - prev.x, y - prev.y) > 0.004)
      dir = Math.atan2(y - prev.y, x - prev.x);
    strokes.current.set(id, { x, y, dir });
    runtime?.draw(
      tool.pen,
      [{ angle: p.angle, radius: Math.min(1.2, p.radius), dir }],
      {
        hue,
        saturation: 0.85,
      },
    );
  };

  // --- inputs that need a gesture ------------------------------------------

  const toggleMic = async () => {
    if (!runtime) return;
    if (mic) {
      runtime.stopMicrophone();
      setMic(false);
      return;
    }
    try {
      await runtime.startMic();
      setMic(true);
    } catch (e) {
      setNotice(`Microphone: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const toggleMotion = async () => {
    if (!runtime) return;
    if (motion) {
      runtime.stopMotion();
      setMotion(false);
      return;
    }
    try {
      await runtime.startMotion();
      setMotion(true);
    } catch (e) {
      setNotice(`Motion: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const pickMedia = (file: File | null) => {
    if (!runtime) return;
    runtime
      .setMedia(file)
      .then(() => setMediaName(file?.name ?? null))
      .catch((e: unknown) =>
        setNotice(
          `That file could not be played: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
  };

  const hasMotion =
    typeof window !== "undefined" && "DeviceOrientationEvent" in window;
  const effects = core?.effectKinds.filter((k) => k !== "cone") ?? [];

  // Controls that appear twice on a phone (in the dock and in the list).
  const toolPicker = (
    <select
      aria-label="Tool"
      value={tool.mode === "tap" ? `fx:${tool.effect}` : `pen:${tool.pen}`}
      onChange={(e) => {
        const [mode, name] = e.target.value.split(":");
        setTool(
          mode === "fx"
            ? { mode: "tap", effect: name }
            : { mode: "draw", pen: name },
        );
      }}
    >
      <optgroup label="Tap an effect">
        {effects.map((k) => (
          <option key={k} value={`fx:${k}`}>
            {label(k)}
          </option>
        ))}
      </optgroup>
      <optgroup label="Draw with a pen">
        {PENS.map((p) => (
          <option key={p} value={`pen:${p}`}>
            {label(p)} pen
          </option>
        ))}
      </optgroup>
    </select>
  );
  const hueSlider = (
    <input
      type="range"
      className="pg-hue"
      aria-label="Color"
      min={0}
      max={1}
      step={0.005}
      value={hue}
      onChange={(e) => setHue(Number(e.target.value))}
    />
  );
  const brightnessSlider = (
    <input
      type="range"
      aria-label="Brightness"
      min={0}
      max={1}
      step={0.01}
      value={brightness}
      onChange={(e) => setBrightness(Number(e.target.value))}
    />
  );
  const speedSlider = (
    <input
      type="range"
      aria-label="Speed"
      min={0}
      max={3}
      step={0.01}
      value={speed}
      onChange={(e) => setSpeed(Number(e.target.value))}
    />
  );
  // The same two, as the card the editor pins in its canvas: the master is
  // not in the patch, and the graph should never hide it.
  const globals: GlobalControl[] = [
    {
      name: "brightness",
      label: "Brightness",
      value: brightness,
      min: 0,
      max: 1,
      format: (v) => `${Math.round(v * 100)}%`,
      onChange: setBrightness,
    },
    {
      name: "speed",
      label: "Speed",
      value: speed,
      min: 0,
      max: 3,
      format: (v) => `${v.toFixed(2)}×`,
      onChange: setSpeed,
    },
  ];

  return (
    <div className="pg">
      <header className="pg-bar">
        <Link to="/" className="pg-home">
          The Empyrean Gate
        </Link>
        <h1>Pattern playground</h1>
        <span className="pg-bar-hint">
          Build a pattern from the gate's own nodes. It runs here exactly as it
          would on the gate.
        </span>
      </header>

      {notice && (
        <div className="pg-notice" role="status">
          {notice}
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div className="pg-body">
        <section
          className="pg-stage"
          aria-label="Live preview"
          ref={stageRef}
          data-preview={
            gpuError ? "unavailable" : runtime ? "running" : "loading"
          }
          data-dock={dockActive ? (docked ? "docked" : "on") : "off"}
        >
          {gpuError ? (
            <p className="pg-nogpu">{gpuError}</p>
          ) : (
            <div className="pg-dock" ref={dockRef}>
              <div className="pg-dock-side pg-dock-left" inert={!docked}>
                {!ownsTouch && toolPicker}
                {hueSlider}
              </div>
              <canvas
                ref={canvasRef}
                className={`pg-gate pg-gate-${ownsTouch ? "draw" : tool.mode}`}
                aria-label={
                  ownsTouch
                    ? "The gate, running your pattern. Your patch decides what a touch does."
                    : "The gate, running your pattern. Tap to fire effects or draw, depending on the tool."
                }
                // Tapping leaves vertical drags to the page, so a phone can
                // scroll past a full-width canvas; drawing and Touch patches
                // need every move.
                style={{
                  touchAction:
                    ownsTouch || tool.mode === "draw" ? "none" : "pan-y",
                }}
                onPointerDown={(e) => {
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    // Not a pointer the browser tracks (a synthetic event).
                  }
                  if (ownsTouch) {
                    rawTouch(e, "down");
                  } else if (tool.mode === "tap") {
                    const p = screenToPolar(
                      e.currentTarget,
                      e.clientX,
                      e.clientY,
                    );
                    fire(p.angle, p.radius);
                  } else {
                    paint(e.pointerId, e.clientX, e.clientY);
                  }
                }}
                onPointerMove={(e) => {
                  if (ownsTouch) {
                    if (held.current.has(e.pointerId)) rawTouch(e, "move");
                  } else if (
                    tool.mode === "draw" &&
                    strokes.current.has(e.pointerId)
                  ) {
                    paint(e.pointerId, e.clientX, e.clientY);
                  }
                }}
                onPointerUp={(e) => {
                  if (ownsTouch) rawTouch(e, "up");
                  strokes.current.delete(e.pointerId);
                }}
                onPointerCancel={(e) => {
                  if (ownsTouch) rawTouch(e, "up");
                  strokes.current.delete(e.pointerId);
                }}
              />
              <div className="pg-dock-side pg-dock-right" inert={!docked}>
                <label className="pg-dock-slider">
                  <span>Brightness</span>
                  {brightnessSlider}
                </label>
                <label className="pg-dock-slider">
                  <span>Speed</span>
                  {speedSlider}
                </label>
              </div>
            </div>
          )}
          {!gpuError && <div className="pg-dock-spacer" ref={spacerRef} />}

          <div className="pg-inputs">
            {narrow && !gpuError && (
              <label className="pg-check pg-keep">
                <input
                  type="checkbox"
                  checked={keepInView}
                  onChange={(e) => setKeepInView(e.target.checked)}
                />
                Keep the gate in view while you scroll
              </label>
            )}
            <fieldset>
              <legend>Your finger</legend>
              {ownsTouch && (
                <p className="pg-owns-touch">
                  This patch has Touch nodes, so it decides what a finger does:
                  no tap effect or pen is applied. The color below is the
                  toucher's color its Touch nodes see.
                </p>
              )}
              <div className="pg-row">
                {!ownsTouch && toolPicker}
                {hueSlider}
              </div>
            </fieldset>

            <fieldset>
              <legend>Sound</legend>
              <div className="pg-row">
                <label className="pg-check">
                  <input
                    type="checkbox"
                    checked={groove}
                    disabled={mic}
                    onChange={(e) => setGroove(e.target.checked)}
                  />
                  Synthetic beat ({BPM} BPM)
                </label>
                <button
                  type="button"
                  disabled={!runtime}
                  aria-pressed={mic}
                  onClick={() => void toggleMic()}
                >
                  {mic ? "Stop microphone" : "Use microphone"}
                </button>
              </div>
            </fieldset>

            <fieldset>
              <legend>DJ deck (stand-in)</legend>
              <div className="pg-row pg-wrap">
                {DJ_EVENTS.map(([name, index]) => (
                  <button
                    key={name}
                    type="button"
                    disabled={!runtime}
                    onClick={() => runtime?.fireDjEvent(index)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <label className="pg-slider">
                Mix
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={djMix}
                  onChange={(e) => setDjMix(Number(e.target.value))}
                />
              </label>
            </fieldset>

            <fieldset>
              <legend>Motion</legend>
              <div className="pg-row pg-wrap">
                {!hasMotion && (
                  <span className="pg-check">
                    No motion sensors in this browser.
                  </span>
                )}
                {hasMotion && (
                  <button
                    type="button"
                    disabled={!runtime}
                    aria-pressed={motion}
                    onClick={() => void toggleMotion()}
                  >
                    {motion ? "Stop motion" : "Use phone motion"}
                  </button>
                )}
              </div>
            </fieldset>
          </div>
        </section>

        <section className="pg-editor" aria-label="Patch editor">
          <PatchEditor
            store={store}
            registry={core?.registry ?? null}
            presets={core?.presets ?? []}
            ready={ready}
            activeId={activeId}
            status={status}
            canEdit
            minis={runtime}
            showActivate={false}
            globals={globals}
            globalsNote="On the gate, the crew sets these on the night; here they're yours. Speed scales every Time node and phase, brightness scales the Output. To react to them, add a Gate globals node."
            onDocChange={onDocChange}
            nodeExtras={(node) =>
              node.kind === "video_in" ? (
                <div className="pg-video-in">
                  <p className="hint">
                    On the gate, Video in shows the gate's live video. Here,
                    pick a video file to stand in for it (it stays on this
                    computer and isn't saved in the patch). For a fixed picture,
                    use a Still image node instead: it carries its own image.
                  </p>
                  <div className="patch-param-row">
                    <label className="pg-file">
                      <input
                        type="file"
                        accept="video/*,image/*"
                        disabled={!runtime}
                        onChange={(e) => pickMedia(e.target.files?.[0] ?? null)}
                      />
                      {mediaName ? `Playing: ${mediaName}` : "Stand-in video…"}
                    </label>
                    {mediaName && (
                      <button type="button" onClick={() => pickMedia(null)}>
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              ) : null
            }
            toolbarExtra={({ doc: open, open: load }) => (
              <>
                <button
                  type="button"
                  title="Open a patch file from your computer"
                  onClick={() =>
                    openPatchFromDisk()
                      .then((d) => d && load(core ? core.migrate(d) : d, true))
                      .catch((e: unknown) =>
                        setNotice(e instanceof Error ? e.message : String(e)),
                      )
                  }
                >
                  Open file…
                </button>
                {open && (
                  <button
                    type="button"
                    title="Save this patch as a file (the same format the gate uses)"
                    onClick={() =>
                      savePatchToDisk(open).catch((e: unknown) =>
                        setNotice(
                          `Saving failed: ${e instanceof Error ? e.message : String(e)}`,
                        ),
                      )
                    }
                  >
                    Save to disk…
                  </button>
                )}
                {open && PLAYGROUND.turnstileSiteKey && (
                  <button
                    type="button"
                    className="pg-submit"
                    title="Send this pattern to the gate's crew"
                    onClick={() => setSubmitting(true)}
                  >
                    Submit…
                  </button>
                )}
              </>
            )}
          />
        </section>
      </div>

      {submitting && doc && (
        <SubmitDialog
          doc={doc}
          problem={status?.error ?? null}
          onClose={() => setSubmitting(false)}
        />
      )}

      {narrow && !toastSeen && (
        <div className="pg-toast" role="status">
          <p>
            <strong>Works best on a desktop.</strong> You can play the gate and
            turn its knobs here; building a pattern wants a mouse and a big
            screen.
          </p>
          <button type="button" onClick={() => setToastSeen(true)}>
            Got it
          </button>
        </div>
      )}
    </div>
  );
}

function label(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, " ");
}

/** The playground's narrow layout (stacked; matches playground.css). */
const NARROW = "(max-width: 52rem)";
const DOCK_KEY = "empyrean-playground:dock";
const TOAST_KEY = "empyrean-playground:desktop-toast";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/** A yes/no preference kept in localStorage (where storage is allowed). */
function useStoredFlag(
  key: string,
  fallback: boolean,
): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v === "1";
    } catch {
      return fallback;
    }
  });
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        localStorage.setItem(key, v ? "1" : "0");
      } catch {
        // Private mode or storage blocked: the choice lasts the visit.
      }
    },
    [key],
  );
  return [value, set];
}
