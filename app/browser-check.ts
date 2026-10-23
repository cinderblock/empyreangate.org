/// <reference types="@webgpu/types" />
/**
 * A short test of what this browser can do for the playground, run in the
 * page when the visitor asks what's missing (components/BrowserCheck.tsx):
 * each part the site leans on, tried for real rather than looked up. Nothing
 * here sends anything; the results go out only in a report the visitor
 * chooses to send.
 */

import { errorText, tryContext } from "./failures";

export type CheckKey = "webgpu" | "webgl2" | "webgl" | "canvas2d" | "wasm";

/** works: did all it was asked. limited: works, but not the way the site
 * hopes (a software renderer, pixels altered on the way back). missing:
 * isn't there, or failed. */
export type CheckState = "works" | "limited" | "missing";

export interface CheckResult {
  key: CheckKey;
  label: string;
  state: CheckState;
  /** What the test saw, in a sentence. */
  detail: string;
  ms: number;
}

/** What each part does on this site, for the dialog. */
export const CHECK_USES: Record<CheckKey, string> = {
  webgpu: "Runs your pattern: the live preview, and the previews on nodes.",
  webgl2:
    "Draws the previews on nodes, and the home page's live render. Without it, previews are drawn on a plain 2D canvas and the home page shows a still picture.",
  webgl: "Only asked when WebGL2 isn't there, to say how far graphics go.",
  canvas2d: "Draws the previews on nodes where there's no WebGL2.",
  wasm: "The gate's patch engine: checking, saving and submitting patterns.",
};

const LABELS: Record<CheckKey, string> = {
  webgpu: "WebGPU",
  webgl2: "WebGL2",
  webgl: "WebGL",
  canvas2d: "2D canvas",
  wasm: "WebAssembly",
};

type Outcome = { state: CheckState; detail: string };

const works = (detail: string): Outcome => ({ state: "works", detail });
const limited = (detail: string): Outcome => ({ state: "limited", detail });
const missing = (detail: string): Outcome => ({ state: "missing", detail });

/** A GPU driver can hang a request rather than refuse it. */
function within<T>(ms: number, what: string, p: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${what} didn't answer in ${ms / 1000} s`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Renderer names that mean the CPU is doing the GPU's work. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

const COMPUTE_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  data[id.x] = data[id.x] * 2u + 1u;
}`;

/** A compute shader that must give the right numbers back, then a frame
 * on a WebGPU canvas: what the playground's runtime does first. */
async function testWebGpu(): Promise<Outcome> {
  const gpu = navigator.gpu as GPU | undefined;
  if (!gpu)
    return missing(
      "No navigator.gpu: this browser has no WebGPU, or has it turned off.",
    );
  const adapter = await within(
    8000,
    "requestAdapter",
    gpu.requestAdapter({ powerPreference: "high-performance" }),
  );
  if (!adapter)
    return missing(
      "navigator.gpu is there, but it offered no adapter: the browser won't use this GPU for WebGPU.",
    );
  const info = adapter.info as GPUAdapterInfo & { isFallbackAdapter?: boolean };
  const name =
    [info.vendor, info.architecture, info.device, info.description]
      .filter(Boolean)
      .join(", ") || "an adapter with no details";
  const device = await within(8000, "requestDevice", adapter.requestDevice());
  try {
    device.pushErrorScope("validation");
    const n = 64;
    const data = device.createBuffer({
      size: n * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });
    const input = new Uint32Array(data.getMappedRange());
    for (let i = 0; i < n; i++) input[i] = i;
    data.unmap();
    const read = device.createBuffer({
      size: n * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: {
        module: device.createShaderModule({ code: COMPUTE_WGSL }),
        entryPoint: "main",
      },
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: data } }],
      }),
    );
    pass.dispatchWorkgroups(1);
    pass.end();
    enc.copyBufferToBuffer(data, 0, read, 0, n * 4);
    device.queue.submit([enc.finish()]);
    const invalid = await device.popErrorScope();
    if (invalid)
      return missing(`${name}: the compute shader failed: ${invalid.message}`);
    await within(
      8000,
      "Reading the result back",
      read.mapAsync(GPUMapMode.READ),
    );
    const out = new Uint32Array(read.getMappedRange().slice(0));
    read.unmap();
    const wrong = out.findIndex((v, i) => v !== i * 2 + 1);
    if (wrong >= 0)
      return missing(
        `${name}: the compute shader gave wrong numbers (at ${wrong}: ${out[wrong]}, not ${wrong * 2 + 1}).`,
      );

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 4;
    const context = canvas.getContext("webgpu");
    if (!context)
      return missing(`${name}: computes, but gave no WebGPU canvas context.`);
    device.pushErrorScope("validation");
    context.configure({
      device,
      format: gpu.getPreferredCanvasFormat(),
      alphaMode: "opaque",
    });
    const draw = device.createCommandEncoder();
    draw
      .beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 1, g: 0.5, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      })
      .end();
    device.queue.submit([draw.finish()]);
    const drawn = await device.popErrorScope();
    await within(8000, "The frame", device.queue.onSubmittedWorkDone());
    if (drawn)
      return missing(
        `${name}: computes, but couldn't draw a frame: ${drawn.message}`,
      );
    if (info.isFallbackAdapter)
      return limited(
        `${name}: works, but on a software (fallback) adapter, so it's slow.`,
      );
    return works(`Computed and drew a frame on ${name}.`);
  } finally {
    device.destroy();
  }
}

/** A triangle in one colour, read back from the middle of a tiny canvas. */
function testWebGl(kind: "webgl2" | "webgl"): Outcome {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 4;
  const ctx = tryContext(kind, canvas, {
    preserveDrawingBuffer: true,
    antialias: false,
  });
  if ("refused" in ctx) return missing(`Refused: ${ctx.refused}`);
  const gl = ctx;
  try {
    const v2 = kind === "webgl2";
    const head = v2 ? "#version 300 es\n" : "";
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, head + src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(`a shader didn't compile: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(
      program,
      shader(
        gl.VERTEX_SHADER,
        `${v2 ? "in" : "attribute"} vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`,
      ),
    );
    gl.attachShader(
      program,
      shader(
        gl.FRAGMENT_SHADER,
        v2
          ? "precision mediump float; uniform vec4 c; out vec4 o; void main() { o = c; }"
          : "precision mediump float; uniform vec4 c; void main() { gl_FragColor = c; }",
      ),
    );
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(
        `the program didn't link: ${gl.getProgramInfoLog(program)}`,
      );
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const p = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    gl.uniform4f(gl.getUniformLocation(program, "c"), 1, 0.5, 0, 1);
    gl.viewport(0, 0, 4, 4);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(4);
    gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(
      gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
    );
    if (gl.isContextLost()) return missing(`${renderer}: lost its context.`);
    const near = (a: number, b: number) => Math.abs(a - b) <= 3;
    if (![255, 128, 0, 255].every((want, i) => near(px[i]!, want)))
      return limited(
        `${renderer}: drew, but read back rgba(${px.join(", ")}), not rgba(255, 128, 0, 255): a privacy setting altering pixels?`,
      );
    if (SOFTWARE.test(renderer))
      return limited(`${renderer}: works, but in software, so it's slow.`);
    return works(`Drew and read back on ${renderer}.`);
  } catch (e) {
    return missing(errorText(e));
  } finally {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

/** One colour in, the same colour out. */
function testCanvas2d(): Outcome {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 4;
  const g = canvas.getContext("2d");
  if (!g) return missing("No 2D context.");
  g.fillStyle = "rgb(10, 200, 30)";
  g.fillRect(0, 0, 4, 4);
  const px = Array.from(g.getImageData(1, 1, 1, 1).data);
  if (px.join() !== "10,200,30,255")
    return limited(
      `Drew, but read back rgba(${px.join(", ")}): a privacy setting altering pixels?`,
    );
  return works("Drew and read back.");
}

/** (module (func (export "add") (param i32 i32) (result i32)
 *   local.get 0 local.get 1 i32.add)) */
const ADD_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02,
  0x7f, 0x7f, 0x01, 0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x61,
  0x64, 0x64, 0x00, 0x00, 0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01,
  0x6a, 0x0b,
]);

async function testWasm(): Promise<Outcome> {
  if (typeof WebAssembly === "undefined")
    return missing("No WebAssembly: it may be turned off.");
  const { instance } = await WebAssembly.instantiate(ADD_WASM);
  const add = instance.exports.add as (a: number, b: number) => number;
  return add(2, 3) === 5
    ? works("Ran a small module.")
    : missing("A small module gave the wrong answer.");
}

async function run(
  key: CheckKey,
  test: () => Outcome | Promise<Outcome>,
): Promise<CheckResult> {
  const t0 = performance.now();
  let out: Outcome;
  try {
    out = await test();
  } catch (e) {
    out = missing(errorText(e));
  }
  return {
    key,
    label: LABELS[key],
    ...out,
    ms: Math.round(performance.now() - t0),
  };
}

/** Every test, one after another (they share the GPU). WebGL1 only when
 * WebGL2 is missing. */
export async function runBrowserCheck(): Promise<CheckResult[]> {
  const results = [await run("webgpu", testWebGpu)];
  const gl2 = await run("webgl2", () => testWebGl("webgl2"));
  results.push(gl2);
  if (gl2.state === "missing")
    results.push(await run("webgl", () => testWebGl("webgl")));
  results.push(await run("canvas2d", testCanvas2d));
  results.push(await run("wasm", testWasm));
  return results;
}

/** The results as a report carries them: a line each. */
export function formatCheck(results: CheckResult[]): string {
  return results
    .map((r) => `${r.label}: ${r.state}. ${r.detail} (${r.ms} ms)`)
    .join("\n");
}

/** How to get WebGPU in the browser this is, as far as the user agent says. */
export function webgpuAdvice(ua: string, result: CheckResult): string {
  if (result.detail.startsWith("navigator.gpu is there"))
    return /Firefox\//.test(ua)
      ? "Firefox keeps WebGPU off for some GPUs and drivers; about:support's Graphics section says why. Hardware acceleration must be on in its settings."
      : "Usually a GPU driver the browser blocks, or hardware acceleration turned off in its settings. chrome://gpu (or the browser's own page like it) says why.";
  if (/Firefox\//.test(ua))
    return "Firefox has WebGPU on Windows, but elsewhere it may still be off: in about:config, set dom.webgpu.enabled to true, then restart Firefox.";
  if (/Edg\/|Chrome\//.test(ua))
    return /Linux/.test(ua) && !/Android/.test(ua)
      ? "On Linux, Chrome's WebGPU may still be behind a flag: chrome://flags/#enable-unsafe-webgpu, then restart."
      : "Current Chrome and Edge have WebGPU; an older version, or a policy on a managed computer, may not.";
  if (/Safari\//.test(ua)) return "Safari has WebGPU from version 26.";
  return "A current Chrome, Edge, Safari or Firefox has WebGPU.";
}

/** On a Linux desktop the driver side is worth a look too. */
export function isLinuxDesktop(ua: string): boolean {
  return /Linux/.test(ua) && !/Android/.test(ua);
}
