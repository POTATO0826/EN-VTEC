"use client";

import * as React from "react";
import { cn } from "cn";

/**
 * Shdr13 - the local agent's presence.
 *
 * Renders the retained "Phosphor" orb shader as a standalone, self-contained
 * WebGL canvas so the agent can appear in the registration saga without
 * touching the existing shell. Shader ported from Orbkit
 * (github.com/zzzzshawn/orbkit). Non-commercial use with attribution.
 * Keep this notice.
 */

export type OrbState = "idle" | "scanning" | "found";

const PRELUDE = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uAnim;
uniform float uInput;
uniform float uOutput;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(11.7, 7.3);
    a *= 0.5;
  }
  return v;
}
`;

const FRAG = `
void main() {
  float densBias = uP_density + 0.2 * uInput;
  float gainNow = uP_gain * (0.85 + 0.5 * uOutput);
  float cellPx = max(min(uRes.x, uRes.y) / max(uP_cells, 8.0), 4.0);
  vec2 cellIdx = floor(gl_FragCoord.xy / cellPx);
  vec2 cellCentre = (cellIdx + 0.5) * cellPx;
  vec2 g = fract(gl_FragCoord.xy / cellPx);
  vec2 suv = (2.0 * cellCentre - uRes) / min(uRes.x, uRes.y);
  vec2 uv = suv / uP_radius;
  float r2 = dot(uv, uv);
  float mask = 1.0 - step(1.0, r2);
  float z = sqrt(max(1.0 - r2, 0.0));
  vec3 n = vec3(uv, z);
  float rot = uP_spin;
  float cr = cos(rot);
  float sr = sin(rot);
  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);
  vec2 p2 = sp.xy / (abs(sp.z) + 1.2) * uP_scale * 3.0;
  float driftT = uP_drift;
  float scrollT = uP_scroll;
  float t = uP_speed;
  vec2 flow = vec2(driftT * 0.6, -driftT * 0.45 - scrollT);
  float field = fbm(p2 + flow);
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  float dens = clamp((field - 0.5) * 1.8 + densBias + 0.4 * uP_light * lambert
    + uP_pulse * 0.35 * sin(length(uv) * 5.5 - t * 2.4), 0.0, 1.0);
  float rowI = floor(g.y * 4.0);
  float bar = step(0.22, fract(g.y * 4.0)) * step(fract(g.y * 4.0), 0.9);
  float stripe = step(0.18, fract(g.x * 3.0));
  float lit = step(rowI + 0.5, dens * 4.0 * gainNow);
  float glyph = bar * stripe * lit;
  vec2 superCentre = (floor(cellIdx / 2.0) * 2.0 + 1.0) * cellPx;
  vec2 sSuv = (2.0 * superCentre - uRes) / min(uRes.x, uRes.y);
  vec2 sUv2 = sSuv / uP_radius;
  float sz = sqrt(max(1.0 - dot(sUv2, sUv2), 0.0));
  vec3 ssp = vec3(sUv2.x * cr - sz * sr, sUv2.y, sUv2.x * sr + sz * cr);
  float superField = fbm(ssp.xy / (abs(ssp.z) + 1.2) * uP_scale * 3.0 + flow);
  float keep = step(uP_dropout, superField + 0.15 * uOutput);
  glyph *= keep;
  vec3 glyphCol = mix(uC_deep, uC_glow, dens);
  glyphCol += vec3(0.7, 1.0, 0.9) * pow(dens, 3.0) * 0.35;
  float fres = pow(1.0 - z, 2.2);
  vec3 col = uC_deep * 0.22 + glyphCol * glyph + uC_glow * fres * uP_rim;
  col = pow(max(col, 0.0), vec3(uP_contrast));
  float a = mask;
  gl_FragColor = vec4(col * a, a);
}
`;

type Params = Record<string, number>;

const BASE: Params = {
  drift: 3.05,
  scroll: 0.65,
  speed: 0.45,
  pulse: 0.58,
  spin: 0.04,
  radius: 0.9,
  cells: 86,
  scale: 1.6,
  density: 0.33,
  dropout: 0.13,
  light: 0.855,
  rim: 0.51,
  gain: 0.95,
  contrast: 1.3,
};

/** Per-state tuning. The orb is the only thing that says what the agent is doing. */
const STATES: Record<
  OrbState,
  { params: Params; input: number; output: number }
> = {
  idle: {
    params: {
      drift: 1.1,
      scroll: 0.22,
      speed: 0.2,
      pulse: 0.3,
      density: 0.2,
      gain: 0.78,
      rim: 0.4,
    },
    input: 0,
    output: 0,
  },
  scanning: {
    params: {
      drift: 5.4,
      scroll: 1.5,
      speed: 1.1,
      pulse: 0.95,
      spin: 0.12,
      density: 0.36,
      gain: 1.05,
    },
    input: 1,
    output: 0.25,
  },
  found: {
    params: {
      drift: 1.7,
      scroll: 0.4,
      speed: 0.35,
      pulse: 0.42,
      density: 0.42,
      gain: 1.1,
      rim: 0.66,
    },
    input: 0.35,
    output: 1,
  },
};

const INTEGRATED = ["drift", "scroll", "speed", "spin"];

export function Shdr13({
  state = "idle",
  size = 200,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  state?: OrbState;
  size?: number;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const stateRef = React.useRef<OrbState>(state);
  const [failed, setFailed] = React.useState(false);

  stateRef.current = state;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(size * dpr);
    canvas.width = px;
    canvas.height = px;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
    });
    if (!gl) {
      setFailed(true);
      return;
    }

    const names = Object.keys(BASE);
    const colors: Record<string, string> = { glow: "#57ffe3", deep: "#0b3b2d" };
    const decl =
      names.map((k) => `uniform float uP_${k};`).join("\n") +
      "\n" +
      Object.keys(colors)
        .map((k) => `uniform vec3 uC_${k};`)
        .join("\n");

    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || "shader compile failed");
      }
      return shader;
    };

    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(
        program,
        compile(
          gl.VERTEX_SHADER,
          "attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }",
        ),
      );
      gl.attachShader(
        program,
        compile(gl.FRAGMENT_SHADER, PRELUDE + decl + "\n" + FRAG),
      );
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || "shader link failed");
      }
    } catch {
      setFailed(true);
      return;
    }

    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const attr = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);

    const U: Record<string, WebGLUniformLocation | null> = {};
    for (const k of names) U[k] = gl.getUniformLocation(program, `uP_${k}`);
    const uInput = gl.getUniformLocation(program, "uInput");
    const uOutput = gl.getUniformLocation(program, "uOutput");
    gl.uniform2f(gl.getUniformLocation(program, "uRes"), px, px);
    gl.uniform1f(gl.getUniformLocation(program, "uTime"), 0);
    gl.uniform1f(gl.getUniformLocation(program, "uAnim"), 0);
    for (const key of Object.keys(colors)) {
      const hex = colors[key];
      gl.uniform3f(
        gl.getUniformLocation(program, `uC_${key}`),
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255,
      );
    }
    gl.viewport(0, 0, px, px);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const clocks: Params = { drift: 0, scroll: 0, speed: 0, spin: 0 };
    const eased: Params = { ...BASE, ...STATES.idle.params };
    let easedInput = 0;
    let easedOutput = 0;
    let last = performance.now();
    let raf = 0;
    let alive = true;

    const frame = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden) {
        last = now;
        return;
      }
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;

      // Ease between states so a status change reads as the same agent, not a cut.
      const target = STATES[stateRef.current];
      const k = reduced ? 1 : Math.min(dt * 3.2, 1);
      for (const name of names) {
        const want = target.params[name] ?? BASE[name];
        eased[name] += (want - eased[name]) * k;
      }
      easedInput += (target.input - easedInput) * k;
      easedOutput += (target.output - easedOutput) * k;

      for (const name of names) {
        if (INTEGRATED.includes(name)) {
          clocks[name] += (reduced ? 0 : dt) * eased[name];
          gl.uniform1f(U[name], clocks[name]);
        } else {
          gl.uniform1f(U[name], eased[name]);
        }
      }
      gl.uniform1f(uInput, easedInput);
      gl.uniform1f(uOutput, easedOutput);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [size]);

  return (
    <div
      data-slot="shdr-13"
      data-state={state}
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      {...props}
    >
      {failed ? (
        <div
          aria-hidden
          className="size-full rounded-full border border-border/60 bg-[radial-gradient(circle_at_35%_30%,color-mix(in_oklab,var(--success)_38%,transparent),transparent_65%)]"
        />
      ) : (
        <canvas
          ref={canvasRef}
          aria-hidden
          className="block size-full"
          style={{ width: size, height: size }}
        />
      )}
    </div>
  );
}

export default Shdr13;
