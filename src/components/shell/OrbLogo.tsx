"use client";

import * as React from "react";

// Shader ported from Orbkit (github.com/zzzzshawn/orbkit).
// SHDR-01 "Dispersion" is by XorDev (x.com/XorDev), used with permission —
// non-commercial use only, with attribution. Keep this notice.
const PRELUDE = `
precision highp float;
uniform vec2 uRes;
vec2 orbUV() { return (2.0 * gl_FragCoord.xy - uRes) / min(uRes.x, uRes.y); }
vec3 tanh3(vec3 x) {
  x = clamp(x, -10.0, 10.0);
  vec3 e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}
`;

const FRAGMENT = `
#define STEPS 60
#define TURB 5
float dispersionTurb;
float dispersionExposure;
mat2 rot2(float a) { float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }
vec3 dispersionRender(vec2 fragCoord) {
  float animTime = uP_speed;
  float spinAng = uP_spin;
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));
  vec3 acc = vec3(0.0);
  float T = 1.0;
  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.3;
  for (int it = 0; it < STEPS; it++) {
    vec3 p = ro + rd * z;
    vec3 q = p;
    q.xz = rot2(spinAng) * q.xz;
    q.yz = rot2(uP_tilt) * q.yz;
    vec3 a = q;
    for (int j = 0; j < TURB; j++) {
      float dj = float(j) + 3.0;
      a -= dispersionTurb * sin(a * dj + animTime + float(it)).yzx / dj;
    }
    float wall = abs(length(a) - uP_envRadius);
    float s = a.z + a.y - animTime;
    float d = max(wall + abs(cos(s)) / uP_sheets, 1e-4);
    vec3 w = (cos(s - z * uP_stria + vec3(0.0, 1.0, 8.0) * uP_disperse) + 1.0) / d;
    w = min(w, vec3(uP_stepClamp));
    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(p));
    w = (w + uP_fill) * env;
    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);
    z += d;
    if (T < 0.004 || z > zEnd) break;
  }
  return acc;
}
void main() {
  dispersionTurb = uP_turb;
  dispersionExposure = uP_exposure;
  vec3 acc = dispersionRender(gl_FragCoord.xy);
  vec3 col = tanh3(acc / max(dispersionExposure, 1.0));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);
  col *= mask;
  a *= mask;
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, length(orbUV()));
  gl_FragColor = vec4(col * fade, a * fade);
}
`;

// speed and spin are integrated over time; everything else is a constant.
const PARAMS: Record<string, number> = {
  speed: 0.5,
  spin: 0.25,
  camDist: 7,
  focal: 2.25,
  tilt: 0.5,
  turb: 0.3,
  sheets: 7,
  disperse: 1,
  stria: 1,
  envRadius: 2.6,
  envCore: 1,
  fill: 1.5,
  stepClamp: 20,
  scatter: 0.02,
  exposure: 60,
  contrast: 1,
  saturation: 1,
  alphaGain: 2,
  edge: 1,
  edgeFade: 0.98,
};
const ANIMATED = ["speed", "spin"];

/** The colourful dispersion orb. Falls back to a plain dot without WebGL. */
export default function OrbLogo({ size = 28 }: { size?: number }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
    });
    if (!canvas || !gl) {
      setFailed(true);
      return;
    }

    const keys = Object.keys(PARAMS);
    const decl = keys.map((k) => `uniform float uP_${k};`).join("\n");
    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader) || "shader compile failed");
      return shader;
    };

    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(
        program,
        compile(gl.VERTEX_SHADER, "attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }"),
      );
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, PRELUDE + decl + "\n" + FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(program) || "shader link failed");
    } catch (e) {
      console.warn("logo orb unavailable", e instanceof Error ? e.message : String(e));
      setFailed(true);
      return;
    }

    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uniform: Record<string, WebGLUniformLocation | null> = {};
    for (const k of keys) {
      uniform[k] = gl.getUniformLocation(program, `uP_${k}`);
      if (!ANIMATED.includes(k)) gl.uniform1f(uniform[k], PARAMS[k]);
    }
    gl.uniform2f(gl.getUniformLocation(program, "uRes"), canvas.width, canvas.height);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const clocks: Record<string, number> = { speed: 0, spin: 0 };
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) {
        last = now;
        return;
      }
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      for (const k of ANIMATED) {
        clocks[k] += dt * PARAMS[k];
        gl.uniform1f(uniform[k], clocks[k]);
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  if (failed) {
    return (
      <span
        aria-hidden
        className="inline-block rounded-full"
        style={{
          width: size,
          height: size,
          background: "linear-gradient(135deg, #6E8CFF, #A78BFA 55%, #7DE2D1)",
        }}
      />
    );
  }
  return (
    <canvas
      ref={ref}
      width={96}
      height={96}
      aria-hidden
      style={{ width: size, height: size, display: "block" }}
    />
  );
}
