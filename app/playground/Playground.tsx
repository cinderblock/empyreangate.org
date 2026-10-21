/**
 * The pattern playground: the gate's own node editor, with the gate's own
 * patch compiler and evaluator (wasm) and the very shader the gate runs
 * (WebGPU), all in the visitor's browser. Patches live in IndexedDB; Save
 * writes the same JSON file the gate keeps, so it can be opened on the gate.
 *
 * Client-only: `routes/playground.tsx` loads this after hydration.
 */

import { hasPatchLink, readPatchLink } from "@empyrean-gate/patch-web/agent";
import {
  isBuiltin,
  openPatchFromDisk,
  PatchEditor,
  sameLocation,
  savePatchToDisk,
  type EditorLocation,
  type GlobalControl,
  type PatchDoc,
  type PatchEditorHandle,
} from "@empyrean-gate/patch-web/editor";
import {
  attachGroove,
  attachVisitors,
  GROOVE_BPM,
  loadPatchCore,
  MediaTexture,
  PatchRuntime,
  screenToPolar,
  syntheticMotion,
  WebGpuUnavailable,
  type DjLinkSim,
  type PatchCore,
  type RuntimeStatus,
} from "@empyrean-gate/patch-web/runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { PlayLive, useLive } from "../components/LiveLink";
import ReportProblem from "../components/ReportProblem";
import { PLAYGROUND, SITE } from "../content/site";
import { countFailure, errorText, type FailureCode } from "../failures";
import { startPlaygroundAgent, type PlaygroundInputs } from "./agent";
import DjDecks from "./DjDecks";
import SubmitDialog from "./SubmitDialog";
import { LocalPatchStore } from "./store";
import { parsePlaygroundPath, playgroundPath } from "./urls";
import "./playground.css";

/** Node kinds that only come alive when people tap, draw or touch: their
 * panels offer the simulated visitors. */
const VISITOR_KINDS = new Set([
  "tap",
  "touch",
  "touch_dabs",
  "effects_in",
  "touch_mask",
  "touch_glow",
  "render_points",
  "render_effects",
]);

/** What a first visit opens: a copy of this built-in preset. */
const STARTER = "Rainbow Sparkle";

const PENS = ["glow", "ripple", "sparkle", "comet", "ring", "beam", "ember"];

type Tool = { mode: "tap"; effect: string } | { mode: "draw"; pen: string };

export default function Playground() {
  const store = useMemo(() => new LocalPatchStore(), []);
  const [core, setCore] = useState<PatchCore | null>(null);
  const [runtime, setRuntime] = useState<PatchRuntime | null>(null);
  // Why there is no live preview: what the page says, and what a report or
  // count says (the error itself, without the advice around it).
  const [gpuError, setGpuError] = useState<{
    code: FailureCode;
    text: string;
    error: string;
  } | null>(null);
  // The patch engine (wasm) didn't load: nothing works without it.
  const [engineError, setEngineError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(store.active);
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [doc, setDoc] = useState<PatchDoc | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The real gate, when it is up: a chip in the bar to go play it.
  const live = useLive();
  const [submitting, setSubmitting] = useState(false);
  // What an agent filled in when it opened Submit for the person.
  const [submitInitial, setSubmitInitial] = useState<{
    name?: string;
    note?: string;
  }>({});
  const editorRef = useRef<PatchEditorHandle>(null);
  // Where the editor is lives in the URL (see urls.ts): the editor reports
  // each move, and Back/Forward (or a typed URL) move the editor.
  const routerLocation = useLocation();
  const navigate = useNavigate();
  const [initialLocation, setInitialLocation] = useState<EditorLocation | null>(
    null,
  );

  const [tool, setTool] = useState<Tool>({ mode: "tap", effect: "burst" });
  const [hue, setHue] = useState(0.52);
  const [groove, setGroove] = useState(true);
  const [mic, setMic] = useState(false);
  const [motion, setMotion] = useState(false);
  // Driving the Phone IMU node by hand (its node panel): the live values the
  // manual source reads, and whether it is the source right now.
  const imuManual = useRef({ yaw: 0, pitch: 0, roll: 0, shake: 0 });
  const [imuOverride, setImuOverride] = useState(false);
  const [imu, setImu] = useState({ yaw: 0, pitch: 0, roll: 0 });
  /** Where Video in's picture comes from: the stand-in film, the camera, or
   * a file (its name). */
  const [video, setVideo] = useState<"film" | "camera" | { file: string }>(
    "film",
  );
  const [visitors, setVisitors] = useState(false);
  const [huePull, setHuePull] = useState(0);
  const [hueTarget, setHueTarget] = useState(0.08);
  const [brightness, setBrightness] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [dj, setDj] = useState<DjLinkSim | null>(null);

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
        countFailure("engine-load");
        setEngineError(
          `The playground could not load the gate's patch engine: ${errorText(e)}`,
        );
        return;
      }
      if (!live) return;
      store.migrate = c.migrate;
      // A link carrying a patch (`#patch=`): it joins the library and opens,
      // before the editor reopens whatever was open last.
      const linked = await importLink(c, store, location.hash);
      if (linked) {
        history.replaceState(null, "", location.pathname + location.search);
        setNotice(linked);
      } else {
        const want = parsePlaygroundPath(location.pathname);
        const known =
          want &&
          (isBuiltin(want.patch)
            ? c.presets.some((p) => p.id === want.patch)
            : await store.has(want.patch));
        if (known) setInitialLocation(want);
        else if (want)
          setNotice(
            isBuiltin(want.patch)
              ? "That built-in pattern isn't in this version of the playground."
              : "That patch isn't in this browser. Patches live in the browser they were made in: to share one, use Save to disk, or send it with Submit.",
          );
      }
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
        const code: FailureCode =
          e instanceof WebGpuUnavailable
            ? "webgpu-unavailable"
            : "webgpu-start";
        countFailure(code);
        setGpuError({
          code,
          error: errorText(e),
          text:
            code === "webgpu-unavailable"
              ? `${errorText(e)} The editor still works: you can build, save and submit patterns, but the live preview needs a browser with WebGPU (current Chrome, Edge or Safari).`
              : `The live preview could not start: ${errorText(e)}`,
        });
      }
    })();
    return () => {
      live = false;
      rt?.dispose();
    };
  }, [store]);

  useEffect(() => store.onActive(setActiveId), [store]);

  // A link followed while the playground is open (same page, new fragment):
  // opened straight into the editor.
  useEffect(() => {
    if (!core) return;
    const onHash = () => {
      if (!hasPatchLink(location.hash)) return;
      void importLink(core, store, location.hash).then((message) => {
        history.replaceState(null, "", location.pathname + location.search);
        if (message) setNotice(message);
        const id = store.active;
        if (id) navigate(playgroundPath({ patch: id, path: [] }));
      });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [core, store, navigate]);

  // The editor moved (opened a patch, a built-in, a Sub-patch): a new URL,
  // or the same step renamed (a new patch's first save, a built-in's copy).
  const onNavigate = useCallback(
    (loc: EditorLocation, how: { replace: boolean }) => {
      const path = playgroundPath(loc);
      if (path === window.location.pathname) return;
      navigate(path + window.location.search, {
        replace: how.replace,
        preventScrollReset: true,
      });
    },
    [navigate],
  );
  // The URL moved (Back, Forward): take the editor there. Its own moves
  // arrive here too, already where they say.
  useEffect(() => {
    if (!ready) return;
    const loc = parsePlaygroundPath(routerLocation.pathname);
    const editor = editorRef.current;
    if (loc && editor && !sameLocation(loc, editor.location()))
      editor.navigate(loc);
  }, [ready, routerLocation.pathname]);

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

  // Music without music: the gate's package plays a simulated DJ set on the
  // PRO DJ LINK inputs and its sound as a synthetic groove (when no
  // microphone), so audio- and DJ-driven nodes move. It keeps the clock, so
  // an agent's restarted capture repeats.
  const grooveRef = useRef<ReturnType<typeof attachGroove> | null>(null);
  useEffect(() => {
    if (!runtime) return;
    const g = attachGroove(runtime);
    grooveRef.current = g;
    setDj(g.dj);
    return () => {
      g.stop();
      grooveRef.current = null;
      setDj(null);
    };
  }, [runtime]);
  useEffect(() => {
    const g = grooveRef.current;
    if (!g) return;
    g.settings.audio = mic ? "off" : groove ? "groove" : "silent";
  }, [runtime, groove, mic]);

  useEffect(
    () => runtime?.setMaster(brightness, speed),
    [runtime, brightness, speed],
  );
  useEffect(
    () => runtime?.setHuePull(hueTarget, huePull),
    [runtime, hueTarget, huePull],
  );

  // People at the gate, when nobody is tapping: taps on the beat, strokes,
  // and fingers when the patch owns touch.
  const visitorsRef = useRef<ReturnType<typeof attachVisitors> | null>(null);
  useEffect(() => {
    if (!runtime) return;
    const v = attachVisitors(runtime, { enabled: false });
    visitorsRef.current = v;
    return () => {
      v.stop();
      visitorsRef.current = null;
    };
  }, [runtime]);
  useEffect(() => {
    if (visitorsRef.current) visitorsRef.current.settings.enabled = visitors;
  }, [runtime, visitors]);

  // For AI agents: WebMCP tools and `window.empyrean` (see agent.ts). The
  // controls they may set are read and written through refs, so the tools
  // stay registered across renders.
  const inputsRef = useRef<PlaygroundInputs>({
    groove,
    brightness,
    speed,
    hue,
    mic,
  });
  inputsRef.current = { groove, brightness, speed, hue, mic };
  const docRef = useRef(doc);
  docRef.current = doc;
  useEffect(() => {
    if (!core) return;
    return startPlaygroundAgent({
      core,
      runtime,
      dj: grooveRef.current,
      store,
      editor: editorRef,
      inputs: () => inputsRef.current,
      setInputs: (next) => {
        if (next.groove !== undefined) setGroove(next.groove);
        if (next.brightness !== undefined) setBrightness(next.brightness);
        if (next.speed !== undefined) setSpeed(next.speed);
        if (next.hue !== undefined) setHue(next.hue);
      },
      openSubmit: (initial) => {
        if (!PLAYGROUND.turnstileSiteKey || !docRef.current) return false;
        setSubmitInitial(initial);
        setSubmitting(true);
        return true;
      },
    });
  }, [core, runtime, store]);

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

  // Desktop browsers expose DeviceOrientationEvent without having any sensor
  // behind it, so "a phone" is judged by how it is held: no hover, a coarse
  // pointer. Anything else gets a stand-in (patch-web's syntheticMotion), so a
  // Phone IMU node can be tried from a desk.
  const likelyPhone = useMediaQuery("(hover: none) and (pointer: coarse)");
  const realMotion =
    likelyPhone &&
    typeof window !== "undefined" &&
    "DeviceOrientationEvent" in window;
  const toggleMotion = async () => {
    if (!runtime) return;
    if (motion) {
      runtime.stopMotion();
      setMotion(false);
      setImuOverride(false);
      return;
    }
    try {
      if (realMotion) await runtime.startMotion();
      else runtime.setMotionSource(syntheticMotion());
      setMotion(true);
      setImuOverride(false);
    } catch (e) {
      setNotice(`Motion: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  /** Drive the Phone IMU node from its panel's sliders (dev and testing):
   * a motion source that reads the sliders' values and the Shake button. */
  const driveImuByHand = (on: boolean) => {
    if (!runtime) return;
    if (!on) {
      runtime.stopMotion();
      setMotion(false);
      setImuOverride(false);
      return;
    }
    const m = imuManual.current;
    runtime.setMotionSource({
      read: () => {
        const shake = m.shake;
        m.shake = 0;
        return {
          yaw: m.yaw * Math.PI * 2,
          pitch: m.pitch,
          roll: m.roll,
          shake,
        };
      },
      stop: () => {},
    });
    setMotion(true);
    setImuOverride(true);
  };
  const setImuAxis = (axis: "yaw" | "pitch" | "roll", v: number) => {
    imuManual.current[axis] = v;
    setImu((cur) => ({ ...cur, [axis]: v }));
  };

  const pickMedia = (file: File | null) => {
    if (!runtime) return;
    runtime
      .setMedia(file)
      .then(() => setVideo(file ? { file: file.name } : "film"))
      .catch((e: unknown) =>
        setNotice(
          `That file could not be played: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
  };
  const pickCamera = () => {
    if (!runtime) return;
    MediaTexture.fromCamera()
      .then((tex) => {
        runtime.setVideoSource(tex);
        setVideo("camera");
      })
      .catch((e: unknown) =>
        setNotice(
          `The camera could not be used: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
  };
  const visitorsToggle = (
    <label className="pg-check">
      <input
        type="checkbox"
        disabled={!runtime}
        checked={visitors}
        onChange={(e) => setVisitors(e.target.checked)}
      />
      Simulated visitors
    </label>
  );

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
    {
      name: "hue_amount",
      label: "Hue pull",
      value: huePull,
      min: 0,
      max: 1,
      format: (v) => (v === 0 ? "off" : `${Math.round(v * 100)}%`),
      onChange: setHuePull,
    },
    {
      name: "hue",
      label: "Pull toward",
      value: hueTarget,
      min: 0,
      max: 1,
      format: (v) => `${Math.round(v * 360)}°`,
      onChange: setHueTarget,
    },
  ];

  return (
    <div className="pg">
      <header className="pg-bar">
        <Link to="/" className="pg-home">
          The Empyrean Gate
        </Link>
        <h1>Pattern playground</h1>
        <PlayLive live={live} className="pg-live" />
        <span className="pg-bar-hint">
          Build a pattern from the gate's own nodes. It runs here exactly as it
          would on the gate.
        </span>
        <a className="pg-agents" href="/playground/agents.md">
          Using an AI agent?
        </a>
        <nav className="pg-bar-links" aria-label="Source code">
          <a href={SITE.engine} rel="noopener" target="_blank">
            Engine ↗
          </a>
          <a href={SITE.editor} rel="noopener" target="_blank">
            Editor ↗
          </a>
          <a href={SITE.software} rel="noopener" target="_blank">
            GitHub ↗
          </a>
        </nav>
      </header>

      {engineError && (
        <div className="pg-failure" role="alert">
          <span>{engineError}</span>
          <ReportProblem code="engine-load" message={engineError} />
        </div>
      )}

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
            <p className="pg-nogpu">
              {gpuError.text}{" "}
              <ReportProblem code={gpuError.code} message={gpuError.error} />
            </p>
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
                  Synthetic beat (the DJ set, {GROOVE_BPM} BPM)
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

            <DjDecks dj={dj} runtime={runtime} />

            <fieldset>
              <legend>People</legend>
              <div className="pg-row pg-wrap">
                {visitorsToggle}
                <span className="pg-check">
                  Stand-ins for the crowd: taps on the beat, strokes now and
                  then, and fingers when the patch owns touch.
                </span>
              </div>
            </fieldset>

            <fieldset>
              <legend>Motion</legend>
              <div className="pg-row pg-wrap">
                <button
                  type="button"
                  disabled={!runtime}
                  aria-pressed={motion}
                  title={
                    realMotion
                      ? "Feed this phone's orientation and shakes to the Phone IMU node"
                      : "Feed the Phone IMU node a stand-in: a slow turn, a sway, a shake now and then"
                  }
                  onClick={() => void toggleMotion()}
                >
                  {realMotion
                    ? motion
                      ? "Stop motion"
                      : "Use phone motion"
                    : motion
                      ? "Stop simulated motion"
                      : "Simulate phone motion"}
                </button>
                {!realMotion && (
                  <span className="pg-check">
                    A stand-in for a phone in a dancer's hand.
                  </span>
                )}
              </div>
            </fieldset>
          </div>
        </section>

        <section className="pg-editor" aria-label="Patch editor">
          <PatchEditor
            editorRef={editorRef}
            store={store}
            registry={core?.registry ?? null}
            presets={core?.presets ?? []}
            codeReference={core?.codeReference ?? null}
            convertToCode={
              core
                ? (d, id) => Promise.resolve(core.convertToCode(d, id))
                : undefined
            }
            ready={ready}
            activeId={activeId}
            initialLocation={initialLocation}
            onNavigate={onNavigate}
            status={status}
            canEdit
            minis={runtime}
            showActivate={false}
            globals={globals}
            globalsNote="On the gate, the crew sets these on the night; here they're yours. Speed scales every Time node and phase, brightness scales the Output, and the hue pull draws every color toward one hue. To react to them, add a Gate globals node."
            onDocChange={onDocChange}
            nodeExtras={(node) =>
              node.kind === "imu" ? (
                <div className="pg-imu">
                  <p className="hint">
                    On the gate this is a dancer's phone. Here, use your own
                    (Motion, in the controls), the stand-in, or drive it by hand
                    for testing.
                  </p>
                  <label className="pg-check">
                    <input
                      type="checkbox"
                      disabled={!runtime}
                      checked={imuOverride}
                      onChange={(e) => driveImuByHand(e.target.checked)}
                    />
                    Drive it by hand
                  </label>
                  {(
                    [
                      ["yaw", "Yaw (turns)", 0, 1],
                      ["pitch", "Pitch", -1, 1],
                      ["roll", "Roll", -1, 1],
                    ] as const
                  ).map(([axis, label, min, max]) => (
                    <label key={axis} className="patch-param">
                      <span className="patch-param-head">{label}</span>
                      <span className="patch-param-row">
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step={0.01}
                          disabled={!imuOverride}
                          value={imu[axis]}
                          onChange={(e) =>
                            setImuAxis(axis, Number(e.target.value))
                          }
                        />
                        <span className="patch-param-value">
                          {imu[axis].toFixed(2)}
                        </span>
                      </span>
                    </label>
                  ))}
                  <button
                    type="button"
                    disabled={!imuOverride}
                    onClick={() => {
                      imuManual.current.shake = 2;
                    }}
                  >
                    Shake
                  </button>
                </div>
              ) : node.kind === "video_in" ? (
                <div className="pg-video-in">
                  <p className="hint">
                    On the gate, Video in shows the gate's live video. Here it
                    plays a stand-in film until you pick your camera or a video
                    file (both stay on this computer and aren't saved in the
                    patch). For a fixed picture, use a Still image node instead:
                    it carries its own image.
                  </p>
                  <div className="patch-param-row">
                    <button
                      type="button"
                      disabled={!runtime}
                      aria-pressed={video === "film"}
                      onClick={() => pickMedia(null)}
                    >
                      Stand-in film
                    </button>
                    <button
                      type="button"
                      disabled={!runtime}
                      aria-pressed={video === "camera"}
                      onClick={pickCamera}
                    >
                      Camera
                    </button>
                    <label className="pg-file">
                      <input
                        type="file"
                        accept="video/*,image/*"
                        disabled={!runtime}
                        onChange={(e) => pickMedia(e.target.files?.[0] ?? null)}
                      />
                      {typeof video === "object"
                        ? `Playing: ${video.file}`
                        : "Video file…"}
                    </label>
                  </div>
                </div>
              ) : VISITOR_KINDS.has(node.kind) ? (
                <div className="pg-visitors">
                  <p className="hint">
                    On the gate, people tap, draw and touch. Here, use the
                    preview yourself, or let simulated visitors do it.
                  </p>
                  {visitorsToggle}
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
          initial={submitInitial}
          onClose={() => {
            setSubmitting(false);
            setSubmitInitial({});
          }}
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

/** Put the patch a `#patch=` link carries into the library and make it the
 * active one. Resolves with a line for the visitor (null: no link). */
async function importLink(
  core: PatchCore,
  store: LocalPatchStore,
  hash: string,
): Promise<string | null> {
  if (!hasPatchLink(hash)) return null;
  try {
    const doc = await readPatchLink(hash);
    if (!doc) return null;
    const stored = await store.put(core.migrate({ ...doc, id: "" }));
    store.list();
    store.activate(stored.id);
    const problems = core.validate(stored);
    return problems.length
      ? `Opened "${stored.name}" from a link. It's in your library now, but it can't run yet: ${problems.join("; ")}`
      : `Opened "${stored.name}" from a link. It's in your library now.`;
  } catch (e) {
    return `That link's pattern couldn't be opened: ${e instanceof Error ? e.message : String(e)}`;
  }
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
