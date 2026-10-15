import { useEffect, useId, useRef, useState } from "react";
import { GateEngine } from "../gate/engine";
import { INNER_OVER_OUTER, PIXELS, SPOKES, fromScreen } from "../gate/geometry";
import { SCENES, type Scene } from "../gate/presets";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "../gate/shaders";

/**
 * The live render of the array: a WebGL2 point cloud, one dot per drawn LED,
 * coloured by the ported layer shader. Transparent canvas, additive light.
 *
 * States, exposed as `data-render-state` for styling and tests:
 *   idle     - server-rendered / before the effect runs; the SVG still shows
 *   running  - animating
 *   paused   - off-screen, hidden tab, reduced motion, or the visitor paused it
 *   fallback - WebGL2 unavailable; the SVG still stays
 */
export type RenderState = "idle" | "running" | "paused" | "fallback";

/** Device-pixel ratio cap: 3x phones gain nothing from 70k points. */
const MAX_DPR = 2;

interface GlProgram {
  gl: WebGL2RenderingContext;
  loc: Record<string, WebGLUniformLocation | null>;
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  src: string,
): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error("gate shader failed to compile", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function buildProgram(canvas: HTMLCanvasElement): GlProgram | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!program || !vs || !fs) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("gate program failed to link", gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);
  // Points only, no attributes: the vertex shader derives everything from
  // gl_VertexID. A VAO is still required to draw in WebGL2.
  gl.bindVertexArray(gl.createVertexArray());
  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);

  const names = [
    "u_spokes",
    "u_pixels",
    "u_drawn",
    "u_inner",
    "u_point_size",
    "u_layer",
    "u_layer_count",
    "u_split",
    "u_mix",
    "u_tilt",
    "u_audio",
    "u_beat",
    "u_ripple",
    "u_ripple_count",
    "u_master",
  ];
  const loc: GlProgram["loc"] = {};
  for (const n of names) loc[n] = gl.getUniformLocation(program, n);
  gl.uniform1f(loc.u_spokes, SPOKES);
  gl.uniform1f(loc.u_pixels, PIXELS);
  gl.uniform1f(loc.u_inner, INNER_OVER_OUTER);
  // A touch over unity: a screen is not a dark playa, and the soft clip
  // keeps the brightest dots from blowing out.
  gl.uniform1f(loc.u_master, 1.25);
  return { gl, loc };
}

/**
 * How many of the 378 LEDs per spoke to draw at this size, and how big. The
 * physical strip is far denser than any screen; drawing every LED at 400 px
 * would just stack dots. Aim for ~1.3 device pixels between dot centres.
 */
function decimation(radiusPx: number): { drawn: number; pointSize: number } {
  const span = radiusPx * (1 - INNER_OVER_OUTER);
  const drawn = Math.max(32, Math.min(PIXELS, Math.round(span / 1.3)));
  const spacing = span / (drawn - 1);
  return { drawn, pointSize: Math.max(2, spacing * 3) };
}

/** The ring as 64 faint lines: what shows before WebGL, and instead of it. */
function GateStill() {
  const lines = [];
  for (let s = 0; s < SPOKES; s++) {
    const a = (s / SPOKES) * Math.PI * 2;
    const x = Math.sin(a);
    const y = -Math.cos(a);
    lines.push(
      <line
        key={s}
        x1={(x * INNER_OVER_OUTER * 96).toFixed(2)}
        y1={(y * INNER_OVER_OUTER * 96).toFixed(2)}
        x2={(x * 96).toFixed(2)}
        y2={(y * 96).toFixed(2)}
      />,
    );
  }
  return (
    <svg
      className="gate-still"
      viewBox="-100 -100 200 200"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="gate-still-glow">
          <stop offset="30%" stopColor="#ffb5d7" stopOpacity="0.9" />
          <stop offset="70%" stopColor="#32d5d2" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#413f92" stopOpacity="0.15" />
        </radialGradient>
      </defs>
      <g stroke="url(#gate-still-glow)" strokeWidth="1.1" strokeLinecap="round">
        {lines}
      </g>
    </svg>
  );
}

/** Everything that can say "don't animate", read by the frame loop. */
interface Flags {
  visible: boolean;
  userPaused: boolean;
  reducedMotion: boolean;
  /** The visitor pressed Play despite reduced motion. Their call. */
  playedAnyway: boolean;
}

export default function GateRender({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GateEngine | null>(null);
  const flags = useRef<Flags>({
    visible: true,
    userPaused: false,
    reducedMotion: false,
    playedAnyway: false,
  });
  const updateRef = useRef<() => void>(() => {});
  const [state, setState] = useState<RenderState>("idle");
  const [scene, setScene] = useState<Scene>(SCENES[0]);
  const [reducedMotion, setReducedMotion] = useState(false);
  const labelId = useId();

  // Scene changes crossfade in the engine; React only tracks which chip is lit.
  useEffect(() => {
    engineRef.current?.setScene(scene, performance.now() / 1000);
  }, [scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const prog = buildProgram(canvas);
    if (!prog) {
      setState("fallback");
      return;
    }
    const { gl, loc } = prog;
    const engine = new GateEngine(SCENES[0]);
    engineRef.current = engine;
    const f = flags.current;

    let drawn = 64;
    let pointSize = 2;
    let raf = 0;
    let last = performance.now() / 1000;
    let running = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      const d = decimation((Math.min(w, h) / 2) * 0.96);
      drawn = d.drawn;
      pointSize = d.pointSize;
    };

    const frame = (nowMs: number) => {
      const now = nowMs / 1000;
      const dt = Math.min(0.1, Math.max(0, now - last));
      last = now;
      engine.step(now, dt);
      const a = engine.audio;
      gl.uniform1i(loc.u_drawn, drawn);
      gl.uniform1f(loc.u_point_size, pointSize);
      gl.uniform4fv(loc.u_layer, engine.uniforms);
      gl.uniform1i(loc.u_layer_count, engine.layerCount);
      gl.uniform1i(loc.u_split, engine.split);
      gl.uniform1f(loc.u_mix, engine.mix);
      gl.uniform2f(loc.u_tilt, engine.tilt[0], engine.tilt[1]);
      gl.uniform4f(loc.u_audio, a.level, a.bass, a.mid, a.treble);
      gl.uniform2f(loc.u_beat, a.beatPhase, a.onset);
      gl.uniform4fv(loc.u_ripple, engine.rippleUniforms);
      gl.uniform1i(loc.u_ripple_count, engine.rippleCount);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, SPOKES * drawn);
    };

    const loop = (nowMs: number) => {
      if (!running) return;
      frame(nowMs);
      raf = requestAnimationFrame(loop);
    };

    const update = () => {
      const should =
        f.visible &&
        document.visibilityState === "visible" &&
        !f.userPaused &&
        (!f.reducedMotion || f.playedAnyway);
      if (should && !running) {
        running = true;
        last = performance.now() / 1000;
        setState("running");
        raf = requestAnimationFrame(loop);
      } else if (!should) {
        if (running) cancelAnimationFrame(raf);
        running = false;
        setState("paused");
      }
    };
    updateRef.current = update;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      f.reducedMotion = motion.matches;
      setReducedMotion(motion.matches);
      update();
    };
    f.reducedMotion = motion.matches;
    setReducedMotion(motion.matches);
    motion.addEventListener("change", onMotion);

    const ro = new ResizeObserver(() => {
      resize();
      // A paused canvas still needs to look right after a resize.
      if (!running) frame(performance.now());
    });
    ro.observe(canvas);
    resize();
    // One frame straight away so a paused start (reduced motion) isn't blank.
    frame(performance.now());

    const io = new IntersectionObserver(
      (entries) => {
        f.visible = entries.some((e) => e.isIntersecting);
        update();
      },
      { threshold: 0.05 },
    );
    io.observe(canvas);
    document.addEventListener("visibilitychange", update);
    update();

    // Pointer: hover tilts the fields; a tap drops a ripple on the ring.
    const toUnit = (e: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = 1 - ((e.clientY - rect.top) / rect.height) * 2;
      return [x / 0.96, y / 0.96];
    };
    const onMove = (e: PointerEvent) => {
      const [x, y] = toUnit(e);
      engine.setTilt(x * 0.35, y * 0.35);
    };
    const onLeave = () => engine.setTilt(0, 0);
    const onDown = (e: PointerEvent) => {
      const [x, y] = toUnit(e);
      const { theta, rn } = fromScreen(x, y);
      if (rn > 1.08 || rn < INNER_OVER_OUTER - 0.1) return;
      engine.tap(
        theta,
        Math.min(1, Math.max(INNER_OVER_OUTER, rn)),
        performance.now() / 1000,
      );
      if (!running) frame(performance.now());
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onDown);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
      motion.removeEventListener("change", onMotion);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      engineRef.current = null;
      updateRef.current = () => {};
    };
  }, []);

  const paused = state === "paused";
  const live = state === "running" || state === "paused";

  const togglePause = () => {
    const f = flags.current;
    if (paused) {
      f.userPaused = false;
      // An explicit Play overrides the OS preference for this visit.
      if (f.reducedMotion) f.playedAnyway = true;
    } else {
      f.userPaused = true;
    }
    updateRef.current();
  };

  return (
    <div
      className={`gate-render${className ? ` ${className}` : ""}`}
      data-render-state={state}
    >
      <div className="gate-stage">
        <GateStill />
        <canvas
          ref={canvasRef}
          className="gate-canvas"
          role="img"
          aria-labelledby={labelId}
        />
        <p id={labelId} className="visually-hidden">
          Live render of the gate's light patterns: sixty-four spokes of LEDs in
          a ring, animating in the browser. Tap or click the ring to send a
          ripple through it.
        </p>
        {live && (
          <button
            type="button"
            className="gate-playpause"
            aria-label={paused ? "Play animation" : "Pause animation"}
            aria-pressed={paused}
            onClick={togglePause}
          >
            {paused ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M8 5.5v13l10.5-6.5z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <rect x="6.5" y="5.5" width="4" height="13" rx="1" />
                <rect x="13.5" y="5.5" width="4" height="13" rx="1" />
              </svg>
            )}
          </button>
        )}
      </div>
      <div className="gate-controls" role="group" aria-label="Light scenes">
        <div className="gate-chips">
          {SCENES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="chip chip-scene"
              aria-pressed={s.id === scene.id}
              aria-description={s.blurb}
              onClick={() => setScene(s)}
              disabled={state === "fallback"}
            >
              {s.name}
            </button>
          ))}
        </div>
        {state === "fallback" && (
          <p className="gate-note">
            Your browser can't run the live render; this is the array at rest.
          </p>
        )}
        {reducedMotion && paused && (
          <p className="gate-note">
            Paused because your system prefers reduced motion. Play to see it
            move.
          </p>
        )}
      </div>
    </div>
  );
}
