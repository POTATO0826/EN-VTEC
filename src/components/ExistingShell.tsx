"use client";

import React from "react";
import DashboardNav from "./DashboardNav";
import { walletBridge } from "./wallet/bridge";

// Original logo, animated background, and wallet presentation are preserved here.
// The only addition is walletBridge: a handle so the registration saga can open
// this same wallet connect instead of shipping a second one. Nothing about the
// wallet's markup, styling or behaviour is changed by it.

type Chain = "Base" | "Ethereum" | "Sepolia";
interface Toast {
  title: string;
  body: string;
  meta: string;
  color: string;
}
interface State {
  tilt: { x: number; y: number } | null;
  intro: string;
  connected: boolean;
  chain: Chain;
  chainOpen: boolean;
  modal: "connect" | "perms" | "sign" | null;
  signing: boolean;
  toast: Toast | null;
  perms: boolean[];
}
interface OrbConfig {
  frag: string;
  integrate: string[];
  colors: Record<string, string>;
  params: Record<string, number>;
  output?: number;
}
interface OrbState {
  raf: number | null;
  canvas: HTMLCanvasElement;
  dispose: () => void;
}

export default class ExistingShell extends React.Component<
  {
    showIntro?: boolean;
    liveBackground?: boolean;
    gpuName?: string;
    children?: React.ReactNode;
  },
  State
> {
  private _alive = false;
  private _timer?: ReturnType<typeof setInterval>;
  private _toastT?: ReturnType<typeof setTimeout>;
  private _raf?: number;
  private _bgRaf?: number;
  private _orbs: Record<string, OrbState | "failed"> = {};
  private renderer?: import("three").WebGLRenderer;
  private cleanups: Array<() => void> = [];

  state: State = {
    tilt: null,
    intro: "done",
    connected: false,
    chain: "Base",
    chainOpen: false,
    modal: null,
    signing: false,
    toast: null,
    perms: [true, true, false, true],
  };
  introRef = React.createRef<HTMLCanvasElement>();
  bgRef = React.createRef<HTMLCanvasElement>();
  logoRef = React.createRef<HTMLCanvasElement>();
  orbRef = React.createRef<HTMLCanvasElement>();
  orbSmallRef = React.createRef<HTMLCanvasElement>();

  componentDidMount() {
    this._alive = true;
    if (this.props.showIntro === true) {
      this.setState({ intro: "playing" });
      this.startIntro();
    } else {
      this.setState({ intro: "done" });
      this.startBg().catch((e) =>
        console.warn(
          "background unavailable",
          e instanceof Error ? e.message : String(e),
        ),
      );
    }

    this.mountOrbs();
    walletBridge.register(() => this.setState({ modal: "connect" }));
  }
  componentDidUpdate() {
    this.mountOrbs();
  }
  finishIntro() {
    this.setState({ intro: "done" });
    if (this.props.liveBackground !== false && !this.renderer)
      this.startBg().catch((e) =>
        console.warn(
          "background unavailable",
          e instanceof Error ? e.message : String(e),
        ),
      );
  }
  componentWillUnmount() {
    this._alive = false;
    walletBridge.unregister();
    clearInterval(this._timer);
    clearTimeout(this._toastT);
    this.cleanups.forEach((cleanup) => cleanup());
    for (const o of Object.values(this._orbs || {}))
      if (o && o !== "failed") {
        if (o.raf) cancelAnimationFrame(o.raf);
        o.dispose();
      }
    for (const r of [this._raf, this._bgRaf]) if (r) cancelAnimationFrame(r);
    if (this.renderer) this.renderer.dispose();
  }
  SCENE = {
    ref: 540,
    fps: 25,
    half: 72,
    fields: ["#08090B", "#FAFAFA"],
    dot: "#8c8c8c",
    tipAt: 1,
    tip: [
      [100, 182, 1.4],
      [100, 182, 7.2],
      [100, 182, 11.1],
      [96, 186, 14.4],
      [82, 202, 19.6],
      [54, 247, 27.2],
      [46, 339, 35.4],
      [127, 333, 38.4],
      [172, 287, 35.3],
      [200, 251, 30.4],
      [219, 225, 27.7],
      [233, 205, 26.5],
      [239, 200, 26.1],
      [235, 219, 26.8],
      [231, 247, 29.2],
      [238, 290, 34.5],
      [295, 296, 42.4],
      [329, 253, 35.2],
      [350, 218, 29.5],
      [366, 190, 26.2],
      [381, 167, 24.6],
      [395, 155, 24.1],
      [397, 180, 24.8],
      [398, 208, 27.2],
      [399, 242, 32.5],
      [422, 256, 40.4],
      [455, 229, 33.2],
      [481, 199, 25.9],
      [500, 173, 20.9],
      [512, 154, 17.5],
      [518, 143, 15.3],
      [522, 137, 13.6],
      [523, 135, 12.4],
      [523, 135, 10.9],
      [523, 135, 8.5],
      [523, 135, 4.9],
      [523, 135, 0],
    ],
    spine: [
      [99, 177, 3, 3.0],
      [97, 184, 8, 3.4],
      [94, 190, 12, 3.8],
      [90, 196, 15, 4.1],
      [86, 200, 17, 4.2],
      [77, 211, 19, 4.33],
      [69, 222, 20, 5.0],
      [64, 230, 21, 5.25],
      [60, 237, 21, 5.5],
      [52, 253, 22, 5.75],
      [47, 266, 22, 6.0],
      [44, 276, 23, 6.13],
      [41, 290, 24, 6.27],
      [40, 301, 25, 6.4],
      [40, 316, 27, 6.53],
      [42, 328, 30, 6.67],
      [47, 340, 35, 6.8],
      [54, 352, 41, 6.93],
      [59, 358, 45, 7.08],
      [58, 357, 44, 7.23],
      [63, 356, 42, 7.38],
      [92, 355, 40, 7.54],
      [95, 354, 40, 7.69],
      [100, 352, 39, 7.85],
      [114, 344, 37, 8.0],
      [126, 335, 36, 8.2],
      [132, 330, 36, 8.4],
      [140, 323, 35, 8.6],
      [149, 314, 34, 8.8],
      [161, 301, 33, 9.0],
      [192, 268, 33, 9.29],
      [202, 261, 35, 9.57],
      [210, 257, 39, 9.86],
      [217, 254, 42, 10.2],
      [217, 254, 42, 10.6],
      [220, 245, 37, 11.0],
      [224, 235, 33, 11.5],
      [228, 225, 28, 12.0],
      [228, 226, 28, 13.33],
      [223, 239, 34, 14.0],
      [219, 253, 40, 14.5],
      [217, 254, 42, 15.0],
      [219, 255, 41, 15.29],
      [226, 263, 36, 15.57],
      [251, 295, 35, 15.86],
      [258, 302, 40, 16.11],
      [263, 306, 42, 16.33],
      [263, 306, 42, 16.56],
      [268, 305, 40, 16.78],
      [281, 299, 36, 17.0],
      [288, 295, 33, 17.22],
      [296, 288, 31, 17.44],
      [303, 280, 29, 17.67],
      [311, 270, 28, 17.89],
      [318, 261, 27, 18.17],
      [325, 251, 26, 18.5],
      [352, 215, 27, 18.83],
      [367, 204, 32, 19.2],
      [373, 200, 36, 19.6],
      [377, 198, 38, 20.0],
      [377, 198, 38, 20.5],
      [380, 187, 33, 21.0],
      [382, 179, 30, 21.67],
      [381, 181, 31, 22.25],
      [382, 193, 32, 22.75],
      [383, 204, 33, 23.25],
      [383, 204, 33, 23.75],
      [384, 206, 32, 24.2],
      [410, 248, 34, 24.6],
      [413, 253, 37, 25.0],
      [414, 253, 37, 25.5],
      [414, 253, 37, 26.0],
      [417, 253, 36, 26.29],
      [426, 251, 32, 26.57],
      [437, 246, 28, 26.86],
      [445, 241, 26, 27.17],
      [454, 233, 23, 27.5],
      [463, 224, 22, 27.83],
      [473, 211, 21, 28.2],
      [480, 201, 20, 28.6],
      [486, 192, 19, 29.0],
      [495, 179, 17, 29.67],
      [503, 167, 16, 30.5],
      [510, 156, 13, 32.0],
    ],
    flood: {
      at: 49,
      end: 70,
      scale: [
        1.0, 1.08, 1.18, 1.31, 1.47, 1.68, 1.95, 2.28, 2.65, 3.05, 3.35, 3.55,
        3.65, 3.72, 3.78, 3.83, 3.87, 3.9, 3.92, 3.93, 3.94, 4.6,
      ],
      swell: [
        1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.1, 1.33, 1.59, 1.7, 1.75,
        1.79, 1.8, 1.81, 1.82, 1.84, 1.88, 1.94, 2.02, 2.4,
      ],
    },
    sparks: {
      offset: [33.8, -34.2],
      popAt: 43,
      pop: [3.4, 15.3, 21.6, 25.2, 27.4, 28.8],
      radius: 30,
      diverge: [
        1.0, 1.06, 1.15, 1.26, 1.47, 1.73, 2.15, 2.73, 3.56, 4.64, 5.23, 5.59,
        5.79, 5.91, 6.0, 6.06, 6.09, 6.1, 6.12, 6.12, 6.12, 6.12,
      ],
      shrinkAt: 65,
      shrink: [28.6, 26.4, 22.8, 17.8, 10.6, 0],
    },
  };
  PHOSPHOR_FRAG = `
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
  DISPERSION_FRAG = `
#define STEPS 60
#define TURB 5
#define AA 1
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
  dispersionTurb = uP_turb * (1.0 + 0.5 * uInput);
  dispersionExposure = uP_exposure * (1.0 - 0.35 * uOutput);
  vec3 acc = dispersionRender(gl_FragCoord.xy);
  vec3 col = tanh3(acc / max(dispersionExposure, 1.0));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);
  col *= mask;
  a *= mask;
  float r2d = length(orbUV());
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);
  col *= fade;
  a *= fade;
  gl_FragColor = vec4(col, a);
}
`;
  sampleTable(table: number[], base: number, u: number) {
    const k = u - base;
    if (k <= 0) return table[0];
    if (k >= table.length - 1) return table[table.length - 1];
    const i = Math.floor(k);
    return table[i] + (table[i + 1] - table[i]) * (k - i);
  }
  async startIntro() {
    const c = this.introRef.current;
    if (!c) {
      this.finishIntro();
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.finishIntro();
      return;
    }
    try {
      await document.fonts.load('600 100px "Geist"');
    } catch (e) {}
    if (!this._alive || this.state.intro !== "playing") return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ink = document.createElement("canvas");
    const fit = () => {
      c.width = Math.round(c.clientWidth * dpr);
      c.height = Math.round(c.clientHeight * dpr);
      ink.width = c.width;
      ink.height = c.height;
    };
    fit();
    const ctx = c.getContext("2d")!,
      ictx = ink.getContext("2d")!;
    if (!ctx || !ictx) {
      this.finishIntro();
      return;
    }
    const S = this.SCENE,
      halfSecs = S.half / S.fps,
      HOLD = 0.9;
    let t0 = performance.now(),
      paused = 0,
      pausedAt: number | null = null;
    const onVis = () => {
      if (document.hidden) pausedAt = performance.now();
      else if (pausedAt != null) {
        paused += performance.now() - pausedAt;
        pausedAt = null;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    this.cleanups.push(() =>
      document.removeEventListener("visibilitychange", onVis),
    );
    const toScene = (
      g: CanvasRenderingContext2D,
      W: number,
      H: number,
      flip: boolean,
    ) => {
      g.translate(W / 2, H / 2);
      if (flip) g.scale(-1, 1);
      const hs = H / S.ref;
      g.scale(hs, hs);
      g.translate(-S.ref / 2, -S.ref / 2);
    };
    const stampInk = (g: CanvasRenderingContext2D, u: number, k: number) => {
      const sp = S.spine;
      for (let i = 0; i < sp.length - 1; i++) {
        const [ax, ay, ar, af] = sp[i];
        if (af > u) break;
        const [bx, by, br, bf] = sp[i + 1];
        const seg = bf <= u ? 1 : (u - af) / (bf - af);
        const dist = Math.hypot(bx - ax, by - ay);
        const n = Math.max(
          1,
          Math.ceil((dist * seg) / Math.max(2, ar * k * 0.4)),
        );
        for (let j = 0; j <= n; j++) {
          const t = (j / n) * seg;
          g.beginPath();
          g.arc(
            ax + (bx - ax) * t,
            ay + (by - ay) * t,
            (ar + (br - ar) * t) * k,
            0,
            Math.PI * 2,
          );
          g.fill();
        }
      }
    };
    const capsule = (
      g: CanvasRenderingContext2D,
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      r: number,
    ) => {
      if (r <= 0) return;
      g.beginPath();
      if (Math.hypot(x1 - x0, y1 - y0) < 0.5) {
        g.arc(x1, y1, r, 0, Math.PI * 2);
        g.fill();
      } else {
        g.lineWidth = r * 2;
        g.lineCap = "round";
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
    };
    const tipAt = (u: number) => {
      const tip = S.tip;
      const k = Math.min(Math.max(u - S.tipAt, 0), tip.length - 1);
      const i = Math.min(Math.floor(k), tip.length - 2);
      const t = k - i;
      const a = tip[i],
        b = tip[i + 1];
      return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ];
    };
    const draw = (time: number) => {
      const W = c.width / dpr,
        H = c.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const second = time >= halfSecs;
      const local = time - (second ? halfSecs : 0);
      const u = Math.min(local * S.fps, S.half + 40);
      const bg = second ? S.fields[1] : S.fields[0],
        inkC = second ? S.fields[0] : S.fields[1];
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const flooding = u >= S.flood.at;
      const zoom = flooding
        ? this.sampleTable(S.flood.scale, S.flood.at, u)
        : 1;
      const k = flooding ? this.sampleTable(S.flood.swell, S.flood.at, u) : 1;
      const done = u >= S.flood.end + 1;
      ictx.setTransform(1, 0, 0, 1, 0, 0);
      ictx.globalCompositeOperation = "source-over";
      ictx.clearRect(0, 0, ink.width, ink.height);
      ictx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (done) {
        ictx.fillStyle = inkC;
        ictx.fillRect(0, 0, W, H);
      } else {
        ictx.save();
        toScene(ictx, W, H, second);
        ictx.translate(S.ref / 2, S.ref / 2);
        ictx.scale(zoom, zoom);
        ictx.translate(-S.ref / 2, -S.ref / 2);
        ictx.fillStyle = inkC;
        stampInk(ictx, u, k);
        ictx.restore();
      }
      if (second && flooding) {
        const p = Math.min(1, (u - S.flood.at) / (S.flood.end - S.flood.at));
        const fade =
          u > S.flood.end + 1 ? Math.max(0, 1 - (u - S.flood.end - 1) / 14) : 1;
        const sx = 0.82 + (2.35 - 0.82) * p,
          sy = 1 - 0.1 * p;
        ictx.save();
        ictx.globalCompositeOperation = "destination-out";
        ictx.globalAlpha = fade;
        ictx.translate(W / 2, H / 2);
        ictx.scale(sx, sy);
        ictx.font =
          "600 " + Math.round(Math.min(W, H) * 0.11) + 'px "Geist", sans-serif';
        try {
          ictx.letterSpacing = Math.round(p * 14) + "px";
        } catch (e) {}
        ictx.textAlign = "center";
        ictx.textBaseline = "middle";
        ictx.fillStyle = "#000";
        ictx.fillText("GPU VTEC", 0, 0);
        ictx.restore();
      }
      ctx.drawImage(ink, 0, 0, ink.width, ink.height, 0, 0, W, H);
      if (done) return;
      ctx.save();
      toScene(ctx, W, H, second);
      ctx.fillStyle = S.dot;
      ctx.strokeStyle = S.dot;
      const sp = S.sparks;
      if (u >= sp.popAt) {
        const rNow =
          u < S.flood.at
            ? this.sampleTable(sp.pop, sp.popAt, u)
            : u < sp.shrinkAt
              ? sp.radius
              : this.sampleTable(sp.shrink, sp.shrinkAt, u);
        const div = (v: number) =>
          v < S.flood.at ? 1 : this.sampleTable(sp.diverge, S.flood.at, v);
        const now = div(u + 0.5),
          was = div(Math.max(u - 0.5, sp.popAt)),
          cc = S.ref / 2;
        for (const sign of [1, -1])
          capsule(
            ctx,
            cc + sign * sp.offset[0] * was,
            cc + sign * sp.offset[1] * was,
            cc + sign * sp.offset[0] * now,
            cc + sign * sp.offset[1] * now,
            rNow,
          );
      }
      if (u >= S.tipAt && u < S.tipAt + S.tip.length) {
        const [x, y, r] = tipAt(u);
        if (r > 0) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    };
    const total = halfSecs * 2 + HOLD;
    const loop = (now: number) => {
      if (!this._alive || this.state.intro !== "playing") {
        document.removeEventListener("visibilitychange", onVis);
        return;
      }
      if (pausedAt != null) {
        this._raf = requestAnimationFrame(loop);
        return;
      }
      if (c.clientWidth * dpr !== c.width) fit();
      const t = (now - t0 - paused) / 1000;
      draw(t);
      if (t >= total) {
        document.removeEventListener("visibilitychange", onVis);
        this.finishIntro();
        return;
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  // background: chromatic light field (from the zip)
  async startBg() {
    const THREE = await import("three");
    const canvas = this.bgRef.current;
    if (!canvas || !this._alive) return;
    const vs = `precision highp float; void main(){ vec2 p; if(gl_VertexID==0)p=vec2(-1.,-1.); else if(gl_VertexID==1)p=vec2(3.,-1.); else p=vec2(-1.,3.); gl_Position=vec4(p,0.,1.); }`;
    const fs = `precision highp float; precision highp int;
      uniform vec2 uResolution; uniform float uTime; out vec4 outputColor;
      vec3 sn(vec3 v){ return v*inversesqrt(max(dot(v,v),1e-8)); }
      float sa(float v,float r){ return sqrt(v*v+r*r); }
      vec3 warp(vec3 p){ float fr=3.4; for(int i=0;i<6;++i){ fr*=0.625; vec3 ph=p*(fr*0.86)+(fr+uTime); vec3 d=sin(ph)*(1.1/max(fr,1e-4)); p=mix(p.zxy,p,-0.02)+d; } return p; }
      void main(){ vec2 uv=(gl_FragCoord.xy*2.0-uResolution)/max(uResolution.y,1.0); vec3 rdir=sn(vec3(-uv,1.0)); float rd=6.1; vec3 acc=vec3(0.0); const vec3 co=vec3(0.0,1.0,2.0);
        for(int i=0;i<44;++i){ vec3 wp=warp(rdir*rd); float m=mix(rd,wp.z,0.5); float rs=0.001+sa(3.8-m,0.01)*(1.0/11.6); rd+=rs; vec3 cl=sin(rd+float(i)*0.15+co)+1.0; acc+=cl/max(rs,1e-6); }
        vec3 oc=tanh(acc/15000.0); vec3 tc=oc*vec3(0.92,0.97,1.0); float mm=clamp(max(tc.r,max(tc.g,tc.b)),0.0,1.0);
        outputColor=vec4(max(vec3(0.031,0.035,0.043)+tc*mm,vec3(0.0)),1.0); }`;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(),
      camera = new THREE.Camera();
    const uniforms = {
      uResolution: { value: new THREE.Vector2() },
      uTime: { value: 0 },
    };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(9), 3),
    );
    const tri = new THREE.Mesh(
      geo,
      new THREE.RawShaderMaterial({
        uniforms,
        vertexShader: vs,
        fragmentShader: fs,
        glslVersion: THREE.GLSL3,
        depthTest: false,
        depthWrite: false,
      }),
    );
    tri.frustumCulled = false;
    scene.add(tri);
    let W = 0,
      H = 0;
    const resize = () => {
      const w = window.innerWidth,
        h = window.innerHeight;
      if (w === W && h === H) return;
      W = w;
      H = h;
      renderer.setPixelRatio(0.34);
      renderer.setSize(w, h, false);
      renderer.getDrawingBufferSize(uniforms.uResolution.value);
    };
    window.addEventListener("resize", resize, { passive: true });
    this.cleanups.push(() => {
      window.removeEventListener("resize", resize);
      geo.dispose();
      tri.material.dispose();
    });
    resize();
    let last = performance.now(),
      el = 0;
    const loop = (now: number) => {
      if (!this._alive) return;
      this._bgRaf = requestAnimationFrame(loop);
      if (document.hidden) {
        last = now;
        return;
      }
      if (now - last < 40) return;
      el += Math.min((now - last) / 1000, 1 / 24);
      last = now;
      uniforms.uTime.value = el * 0.07;
      renderer.render(scene, camera);
    };
    loop(performance.now());
  }

  // Shaders ported from Orbkit (github.com/zzzzshawn/orbkit).
  // SHDR-01 "Dispersion" is by XorDev (x.com/XorDev), used with permission —
  // non-commercial use only, with attribution. Keep this notice.
  ORB_PRELUDE = `
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
vec2 orbUV() { return (2.0 * gl_FragCoord.xy - uRes) / min(uRes.x, uRes.y); }

vec3 tanh3(vec3 x) {
  x = clamp(x, -10.0, 10.0);
  vec3 e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}
`;
  startOrb(
    key: string,
    ref: React.RefObject<HTMLCanvasElement | null>,
    cfg: OrbConfig,
  ) {
    this._orbs = this._orbs || {};
    const cv = ref.current;
    if (!cv) return;
    const previous = this._orbs[key];
    if (previous === "failed" || (previous && previous.canvas === cv)) return;
    if (previous) {
      if (previous.raf) cancelAnimationFrame(previous.raf);
      previous.dispose();
    }
    const gl = cv.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
    });
    if (!gl) return;
    const P = cfg.params,
      C = cfg.colors || {},
      keys = Object.keys(P),
      cnames = Object.keys(C);
    const decl =
      keys.map((k) => "uniform float uP_" + k + ";").join("\n") +
      "\n" +
      cnames.map((k) => "uniform vec3 uC_" + k + ";").join("\n");
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) || "Shader compilation failed");
      return s;
    };
    let prog;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(
        prog,
        mk(
          gl.VERTEX_SHADER,
          "attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }",
        ),
      );
      gl.attachShader(
        prog,
        mk(gl.FRAGMENT_SHADER, this.ORB_PRELUDE + decl + "\n" + cfg.frag),
      );
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(prog) || "Shader linking failed");
    } catch (e) {
      console.warn(
        "orb " + key + " unavailable",
        e instanceof Error ? e.message : String(e),
      );
      this._orbs[key] = "failed";
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U: Record<string, WebGLUniformLocation | null> = {};
    for (const k of keys) U[k] = gl.getUniformLocation(prog, "uP_" + k);
    gl.uniform2f(gl.getUniformLocation(prog, "uRes"), cv.width, cv.height);
    gl.uniform1f(gl.getUniformLocation(prog, "uTime"), 0);
    gl.uniform1f(gl.getUniformLocation(prog, "uAnim"), 0);
    gl.uniform1f(gl.getUniformLocation(prog, "uInput"), 0);
    gl.uniform1f(gl.getUniformLocation(prog, "uOutput"), cfg.output || 0);
    for (const k of cnames) {
      const hex = C[k];
      gl.uniform3f(
        gl.getUniformLocation(prog, "uC_" + k),
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255,
      );
    }
    const integ = cfg.integrate || [];
    for (const k of keys) if (integ.indexOf(k) < 0) gl.uniform1f(U[k], P[k]);
    gl.viewport(0, 0, cv.width, cv.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const clocks: Record<string, number> = {};
    for (const k of integ) clocks[k] = 0;
    let last = performance.now();
    const state: OrbState = {
      raf: null,
      canvas: cv,
      dispose: () => {
        gl.deleteBuffer(buf);
        gl.deleteProgram(prog);
      },
    };
    this._orbs[key] = state;
    const loop = (now: number) => {
      if (!this._alive) {
        state.raf = null;
        return;
      }
      state.raf = requestAnimationFrame(loop);
      if (document.hidden) {
        last = now;
        return;
      }
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      for (const k of integ) {
        clocks[k] += dt * P[k];
        gl.uniform1f(U[k], clocks[k]);
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    state.raf = requestAnimationFrame(loop);
  }
  mountOrbs() {
    this.startOrb("logo", this.logoRef, {
      frag: this.DISPERSION_FRAG,
      integrate: ["speed", "spin"],
      colors: { tint: "#ffffff" },
      params: {
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
      },
    });
    this.startOrb("agent", this.orbRef, {
      frag: this.PHOSPHOR_FRAG,
      integrate: ["drift", "scroll", "speed", "spin"],
      colors: { glow: "#57ffe3", deep: "#0b3b2d" },
      params: {
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
      },
    });
  }
  onTiltMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    this.setState({
      tilt: {
        x: ((e.clientX - r.left) / r.width) * 2 - 1,
        y: ((e.clientY - r.top) / r.height) * 2 - 1,
      },
    });
  };
  onTiltLeave = () => this.setState({ tilt: null });
  showToast(t: Toast, ms = 6000) {
    this.setState({ toast: t });
    clearTimeout(this._toastT);
    this._toastT = setTimeout(
      () => this._alive && this.setState({ toast: null }),
      ms || 6000,
    );
  }

  renderVals() {
    const st = this.state;
    const introDone = st.intro === "done";
    const GOOD = "#7DE2D1",
      MUTED = "#8A8F98",
      FG = "#EDEEF0",
      ACC = "#6E8CFF";
    const chainColors = {
      Base: "#6E8CFF",
      Ethereum: "#8A8F98",
      Sepolia: "#A78BFA",
    };
    const balance = st.connected ? "1.240" : "0.000";
    return {
      introOn: !introDone,
      introDone,
      skipIntro: () => this.finishIntro(),
      bgRef: this.bgRef,
      introRef: this.introRef,
      walletOff: !st.connected,
      walletOn: st.connected,
      chain: st.chain,
      chainColor: chainColors[st.chain],
      balance,
      chainOpen: st.chainOpen,
      toggleChain: () => this.setState((s) => ({ chainOpen: !s.chainOpen })),
      chains: (
        [
          ["Base", "L2"],
          ["Ethereum", "L1"],
          ["Sepolia", "testnet"],
        ] as const
      ).map(([name, mark]) => ({
        name,
        mark,
        color: chainColors[name],
        pick: () => {
          this.setState({ chain: name, chainOpen: false });
          this.showToast(
            {
              title: "Network switched",
              body: name,
              meta: "wallet_switchEthereumChain",
              color: chainColors[name],
            },
            3000,
          );
        },
      })),
      openConnect: () => this.setState({ modal: "connect" }),
      openPerms: () => this.setState({ modal: "perms", chainOpen: false }),
      closeModal: () => this.setState({ modal: null, signing: false }),
      stop$: (e: React.MouseEvent) => e.stopPropagation(),
      modalOpen: !!st.modal,
      panelOpen: st.modal === "perms" || st.modal === "sign",
      modalConnect: st.modal === "connect",
      tiltMove: this.onTiltMove,
      tiltLeave: this.onTiltLeave,
      tiltX: (-(st.tilt ? st.tilt.y : 0) * 20).toFixed(2),
      tiltY: ((st.tilt ? st.tilt.x : 0) * 20).toFixed(2),
      tiltEase: st.tilt
        ? "transform .12s linear"
        : "transform 1.2s cubic-bezier(.2,0,0,1)",
      logoRef: this.logoRef,
      logoDx: (-5 * (st.tilt ? st.tilt.x : 0)).toFixed(1) + "px",
      logoDy: (-8 * (st.tilt ? st.tilt.y : 0)).toFixed(1) + "px",
      tiltLayers: Array.from({ length: 10 }, (_, k) => {
        const i = k + 1,
          px = st.tilt ? st.tilt.x : 0,
          py = st.tilt ? st.tilt.y : 0,
          size = 200 * (1 - i * 0.05);
        return {
          size: size + "px",
          half: -size / 2 + "px",
          border: (4 * (1 - i * 0.05)).toFixed(1) + "px",
          alpha: (1 - (i - 1) * 0.1).toFixed(2),
          dx: (-13 * i * px).toFixed(1) + "px",
          dy: (-19 * i * py).toFixed(1) + "px",
        };
      }),
      modalPerms: st.modal === "perms",
      modalSign: st.modal === "sign",
      connectMetamask: () => {
        this.setState({ connected: true, modal: null });
        walletBridge.setConnected("vince-prover.eth", st.chain);
        this.showToast(
          {
            title: "Wallet connected",
            body: "vince-prover.eth",
            meta: st.chain + " · session key requested",
            color: ACC,
          },
          3500,
        );
        setTimeout(() => this._alive && this.setState({ modal: "perms" }), 900);
      },
      perms: [
        [
          "Accept jobs on my behalf",
          "ProofJobMarket.acceptJob",
          "≤ $2.00 research / job",
        ],
        [
          "Submit proofs onchain",
          "ProofJobMarket.submitProof",
          "gas ≤ $1.00 / tx",
        ],
        ["Withdraw rewards", "transfer to cold wallet", "unlimited"],
        ["Commit evidence hashes", "EvidenceRegistry.commit", "unlimited"],
      ].map(([label, sub, limit], i) => {
        const on = st.perms[i];
        return {
          label,
          sub,
          limit: on ? limit : "not granted",
          limitColor: on ? ACC : MUTED,
          trackBg: on ? FG : "#1E2127",
          knobLeft: on ? "18px" : "2px",
          knobBg: on ? "#08090B" : MUTED,
          toggle: () =>
            this.setState((s) => {
              const p = s.perms.slice();
              p[i] = !p[i];
              return { perms: p };
            }),
        };
      }),
      toastOn: !!st.toast,
      toast: st.toast || { title: "", body: "", meta: "", color: ACC },
    };
  }
  render() {
    const {
      balance,
      bgRef,
      chain,
      chainColor,
      chainOpen,
      chains,
      closeModal,
      connectMetamask,
      introDone,
      introOn,
      introRef,
      logoDx,
      logoDy,
      logoRef,
      modalConnect,
      modalPerms,
      openConnect,
      openPerms,
      panelOpen,
      perms,
      skipIntro,
      stop$,
      tiltEase,
      tiltLayers,
      tiltLeave,
      tiltMove,
      tiltX,
      tiltY,
      toast,
      toastOn,
      toggleChain,
      walletOff,
      walletOn,
    } = this.renderVals();
    return (
      <>
        <div
          style={{
            position: `relative`,
            width: `100%`,
            minHeight: `100vh`,
            background: `#08090B`,
            overflow: `hidden`,
          }}
        >
          <canvas
            ref={bgRef}
            style={{
              position: `fixed`,
              inset: `0`,
              width: `100%`,
              height: `100%`,
              zIndex: `0`,
              pointerEvents: `none`,
              opacity: `.5`,
              filter: `blur(1px)`,
            }}
          ></canvas>
          <div
            style={{
              position: `fixed`,
              inset: `0`,
              zIndex: `1`,
              pointerEvents: `none`,
              background: `linear-gradient(180deg, rgba(8,9,11,.45) 0%, rgba(8,9,11,.62) 55%, rgba(8,9,11,.88) 100%)`,
            }}
          ></div>

          {introOn && (
            <>
              <div
                style={{
                  position: `fixed`,
                  inset: `0`,
                  zIndex: `200`,
                  background: `#08090B`,
                }}
              >
                <canvas
                  ref={introRef}
                  style={{
                    position: `absolute`,
                    inset: `0`,
                    width: `100%`,
                    height: `100%`,
                    display: `block`,
                  }}
                ></canvas>
                <button
                  onClick={skipIntro}
                  style={{
                    position: `absolute`,
                    right: `24px`,
                    bottom: `24px`,
                    height: `32px`,
                    padding: `0 12px`,
                    borderRadius: `6px`,
                    font: `500 13px/1 'Geist', sans-serif`,
                    whiteSpace: `nowrap`,
                    color: `#8A8F98`,
                    background: `transparent`,
                    border: `1px solid #3a3d44`,
                    cursor: `pointer`,
                    mixBlendMode: `difference`,
                  }}
                  className="hover-0"
                >
                  {"Skip"}
                </button>
              </div>
            </>
          )}

          {introDone && (
            <>
              <div
                style={{
                  position: `relative`,
                  zIndex: `2`,
                  minHeight: `100vh`,
                  display: `flex`,
                  flexDirection: `column`,
                }}
              >
                <header className="console-header">
                  <div
                    style={{
                      display: `flex`,
                      alignItems: `center`,
                      gap: `10px`,
                    }}
                  >
                    <canvas
                      ref={logoRef}
                      width="96"
                      height="96"
                      style={{
                        width: `28px`,
                        height: `28px`,
                        display: `block`,
                      }}
                    ></canvas>
                    <span
                      style={{
                        font: `600 14px/1 'Geist', sans-serif`,
                        letterSpacing: `.04em`,
                      }}
                    >
                      {"GPU VTEC"}
                    </span>
                  </div>

                  <DashboardNav />

                  <div
                    style={{
                      display: `flex`,
                      alignItems: `center`,
                      gap: `8px`,
                      position: `relative`,
                    }}
                  >
                    {walletOff && (
                      <>
                        <button
                          onClick={openConnect}
                          style={{
                            height: `36px`,
                            padding: `0 16px`,
                            borderRadius: `6px`,
                            font: `500 14px/1 'Geist', sans-serif`,
                            whiteSpace: `nowrap`,
                            background: `#EDEEF0`,
                            color: `#08090B`,
                            border: `1px solid #EDEEF0`,
                            cursor: `pointer`,
                          }}
                          className="hover-2"
                        >
                          {"Connect MetaMask"}
                        </button>
                      </>
                    )}
                    {walletOn && (
                      <>
                        <button
                          onClick={toggleChain}
                          style={{
                            height: `36px`,
                            padding: `0 12px`,
                            borderRadius: `6px`,
                            display: `inline-flex`,
                            alignItems: `center`,
                            gap: `8px`,
                            font: `500 14px/1 'Geist', sans-serif`,
                            whiteSpace: `nowrap`,
                            background: `rgba(16,18,22,.6)`,
                            backdropFilter: `blur(12px)`,
                            color: `#EDEEF0`,
                            border: `1px solid #1E2127`,
                            cursor: `pointer`,
                          }}
                          className="hover-3"
                        >
                          <span
                            style={{
                              width: `8px`,
                              height: `8px`,
                              borderRadius: `999px`,
                              background: chainColor,
                            }}
                          ></span>
                          {chain}
                        </button>
                        <button
                          onClick={openPerms}
                          style={{
                            height: `36px`,
                            padding: `0 12px`,
                            borderRadius: `6px`,
                            display: `inline-flex`,
                            alignItems: `center`,
                            gap: `10px`,
                            font: `500 14px/1 'Geist', sans-serif`,
                            whiteSpace: `nowrap`,
                            background: `rgba(16,18,22,.6)`,
                            backdropFilter: `blur(12px)`,
                            color: `#EDEEF0`,
                            border: `1px solid #1E2127`,
                            cursor: `pointer`,
                          }}
                          className="hover-4"
                        >
                          <span
                            style={{
                              width: `18px`,
                              height: `18px`,
                              borderRadius: `999px`,
                              background: `linear-gradient(135deg, #6E8CFF, #A78BFA 55%, #7DE2D1)`,
                            }}
                          ></span>
                          {"vince-prover.eth"}
                          <span
                            style={{
                              font: `500 13px/1 'Geist Mono', monospace`,
                              color: `#8A8F98`,
                              whiteSpace: `nowrap`,
                            }}
                          >
                            {balance}
                            {" ETH"}
                          </span>
                        </button>
                        {chainOpen && (
                          <>
                            <div
                              style={{
                                position: `absolute`,
                                top: `44px`,
                                left: `0`,
                                zIndex: `50`,
                                width: `200px`,
                                padding: `4px`,
                                borderRadius: `8px`,
                                background: `#101216`,
                                border: `1px solid #1E2127`,
                                animation: `rise .2s ease both`,
                              }}
                            >
                              {chains.map((c, index) => (
                                <React.Fragment key={index}>
                                  <button
                                    onClick={c.pick}
                                    style={{
                                      width: `100%`,
                                      display: `flex`,
                                      alignItems: `center`,
                                      gap: `10px`,
                                      height: `32px`,
                                      padding: `0 8px`,
                                      borderRadius: `4px`,
                                      background: `transparent`,
                                      border: `none`,
                                      color: `#EDEEF0`,
                                      font: `400 13px/1 'Geist', sans-serif`,
                                      cursor: `pointer`,
                                      textAlign: `left`,
                                    }}
                                    className="hover-5"
                                  >
                                    <span
                                      style={{
                                        width: `8px`,
                                        height: `8px`,
                                        borderRadius: `999px`,
                                        background: c.color,
                                      }}
                                    ></span>
                                    {c.name}
                                    <span
                                      style={{
                                        marginLeft: `auto`,
                                        font: `400 11px/1 'Geist Mono', monospace`,
                                        color: `#8A8F98`,
                                      }}
                                    >
                                      {c.mark}
                                    </span>
                                  </button>
                                </React.Fragment>
                              ))}
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </header>

                {this.props.children}
              </div>
            </>
          )}

          {panelOpen && (
            <>
              <div
                onClick={closeModal}
                style={{
                  position: `fixed`,
                  inset: `0`,
                  zIndex: `100`,
                  display: `grid`,
                  placeItems: `center`,
                  background: `rgba(8,9,11,.7)`,
                  backdropFilter: `blur(6px)`,
                  padding: `24px`,
                }}
              >
                <div
                  onClick={stop$}
                  style={{
                    width: `100%`,
                    maxWidth: `420px`,
                    borderRadius: `12px`,
                    border: `1px solid #1E2127`,
                    background: `#101216`,
                    padding: `24px`,
                    animation: `rise .25s cubic-bezier(.16,1,.3,1) both`,
                    display: `flex`,
                    flexDirection: `column`,
                    gap: `18px`,
                  }}
                >
                  {modalPerms && (
                    <>
                      <div>
                        <div
                          style={{ font: `600 18px/1.2 'Geist', sans-serif` }}
                        >
                          {"Agent permissions"}
                        </div>
                        <div
                          style={{
                            marginTop: `6px`,
                            font: `400 14px/1.5 'Geist', sans-serif`,
                            color: `#8A8F98`,
                          }}
                        >
                          {
                            "What the session key may do on your behalf. Expires in 23h 12m."
                          }
                        </div>
                      </div>
                      <div style={{ display: `flex`, flexDirection: `column` }}>
                        {perms.map((p, index) => (
                          <React.Fragment key={index}>
                            <button
                              onClick={p.toggle}
                              style={{
                                display: `grid`,
                                gridTemplateColumns: `minmax(0,1fr) auto`,
                                gap: `12px`,
                                alignItems: `center`,
                                padding: `12px 0`,
                                border: `none`,
                                borderTop: `1px solid #1E2127`,
                                background: `transparent`,
                                color: `#EDEEF0`,
                                cursor: `pointer`,
                                textAlign: `left`,
                              }}
                            >
                              <span>
                                <span
                                  style={{
                                    display: `block`,
                                    font: `500 14px/1.3 'Geist', sans-serif`,
                                  }}
                                >
                                  {p.label}
                                </span>
                                <span
                                  style={{
                                    display: `block`,
                                    marginTop: `4px`,
                                    font: `400 12px/1.4 'Geist Mono', monospace`,
                                    color: `#8A8F98`,
                                  }}
                                >
                                  {p.sub}
                                  {" · "}
                                  <span style={{ color: p.limitColor }}>
                                    {p.limit}
                                  </span>
                                </span>
                              </span>
                              <span
                                style={{
                                  width: `36px`,
                                  height: `20px`,
                                  borderRadius: `999px`,
                                  background: p.trackBg,
                                  position: `relative`,
                                  transition: `background .2s`,
                                }}
                              >
                                <span
                                  style={{
                                    position: `absolute`,
                                    top: `2px`,
                                    left: p.knobLeft,
                                    width: `16px`,
                                    height: `16px`,
                                    borderRadius: `999px`,
                                    background: p.knobBg,
                                    transition: `left .2s`,
                                  }}
                                ></span>
                              </span>
                            </button>
                          </React.Fragment>
                        ))}
                      </div>
                      <div
                        style={{
                          display: `flex`,
                          justifyContent: `end`,
                          gap: `8px`,
                        }}
                      >
                        <button
                          onClick={closeModal}
                          style={{
                            height: `36px`,
                            padding: `0 16px`,
                            borderRadius: `6px`,
                            border: `1px solid #1E2127`,
                            background: `transparent`,
                            color: `#EDEEF0`,
                            font: `500 14px/1 'Geist', sans-serif`,
                            whiteSpace: `nowrap`,
                            cursor: `pointer`,
                          }}
                          className="hover-11"
                        >
                          {"Cancel"}
                        </button>
                        <button
                          onClick={closeModal}
                          style={{
                            height: `36px`,
                            padding: `0 16px`,
                            borderRadius: `6px`,
                            border: `1px solid #EDEEF0`,
                            background: `#EDEEF0`,
                            color: `#08090B`,
                            font: `500 14px/1 'Geist', sans-serif`,
                            whiteSpace: `nowrap`,
                            cursor: `pointer`,
                          }}
                          className="hover-12"
                        >
                          {"Save"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {modalConnect && (
            <>
              <div
                onClick={closeModal}
                style={{
                  position: `fixed`,
                  inset: `0`,
                  zIndex: `110`,
                  display: `grid`,
                  placeItems: `center`,
                  background: `rgba(8,9,11,.72)`,
                  backdropFilter: `blur(6px)`,
                  padding: `24px`,
                  animation: `rise .25s cubic-bezier(.16,1,.3,1) both`,
                }}
              >
                <div
                  onClick={stop$}
                  onMouseMove={tiltMove}
                  onMouseLeave={tiltLeave}
                  style={{
                    perspective: `1200px`,
                    width: `320px`,
                    height: `480px`,
                  }}
                >
                  <div
                    style={{
                      position: `relative`,
                      width: `100%`,
                      height: `100%`,
                      borderRadius: `24px`,
                      background: `#000`,
                      overflow: `hidden`,
                      transformStyle: `preserve-3d`,
                      transform: `rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
                      transition: tiltEase,
                      cursor: `pointer`,
                      border: `1px solid #1E2127`,
                    }}
                  >
                    {tiltLayers.map((l, index) => (
                      <React.Fragment key={index}>
                        <div
                          style={{
                            position: `absolute`,
                            left: `50%`,
                            top: `50%`,
                            width: l.size,
                            height: l.size,
                            marginLeft: l.half,
                            marginTop: l.half,
                            borderRadius: `999px`,
                            border: `${l.border} solid rgba(237,238,240,${l.alpha})`,
                            transform: `translate3d(${l.dx}, ${l.dy}, 0)`,
                            transition: tiltEase,
                          }}
                        ></div>
                      </React.Fragment>
                    ))}

                    <img
                      src="assets/MetaMask_Fox.svg.webp"
                      alt="MetaMask"
                      style={{
                        position: `absolute`,
                        left: `50%`,
                        top: `50%`,
                        width: `120px`,
                        height: `120px`,
                        margin: `-60px 0 0 -60px`,
                        objectFit: `contain`,
                        transform: `translate3d(${logoDx}, ${logoDy}, 0)`,
                        transition: tiltEase,
                      }}
                    />

                    <div
                      style={{
                        position: `absolute`,
                        left: `30px`,
                        top: `30px`,
                        display: `flex`,
                        flexDirection: `column`,
                        gap: `4px`,
                      }}
                    >
                      <span
                        style={{
                          font: `400 14px/1 'Geist Mono', monospace`,
                          color: `rgba(237,238,240,.6)`,
                        }}
                      >
                        {"GPU VTEC"}
                      </span>
                      <span
                        style={{
                          font: `600 32px/1 'Geist', sans-serif`,
                          letterSpacing: `-.02em`,
                        }}
                      >
                        {"Connect"}
                      </span>
                    </div>

                    <div
                      style={{
                        position: `absolute`,
                        left: `30px`,
                        right: `30px`,
                        bottom: `30px`,
                        display: `flex`,
                        flexDirection: `column`,
                        gap: `16px`,
                      }}
                    >
                      <span
                        style={{
                          font: `400 14px/1.5 'Geist', sans-serif`,
                          color: `rgba(237,238,240,.6)`,
                        }}
                      >
                        {
                          "Your operator identity. The agent gets a scoped session key, never your keys."
                        }
                      </span>
                      <button
                        onClick={connectMetamask}
                        style={{
                          display: `flex`,
                          alignItems: `center`,
                          gap: `12px`,
                          height: `48px`,
                          padding: `0 14px`,
                          borderRadius: `6px`,
                          border: `1px solid rgba(237,238,240,.18)`,
                          background: `rgba(237,238,240,.06)`,
                          backdropFilter: `blur(8px)`,
                          color: `#EDEEF0`,
                          font: `500 15px/1 'Geist', sans-serif`,
                          whiteSpace: `nowrap`,
                          cursor: `pointer`,
                          textAlign: `left`,
                        }}
                        className="hover-15"
                      >
                        {"Connect MetaMask"}
                        <span
                          style={{
                            marginLeft: `auto`,
                            font: `400 12px/1 'Geist Mono', monospace`,
                            color: `rgba(237,238,240,.6)`,
                          }}
                        >
                          {"detected"}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {toastOn && (
            <>
              <div
                style={{
                  position: `fixed`,
                  right: `24px`,
                  bottom: `24px`,
                  zIndex: `150`,
                  width: `320px`,
                  padding: `14px 16px`,
                  borderRadius: `8px`,
                  border: `1px solid #1E2127`,
                  background: `#101216`,
                  animation: `toastIn .3s cubic-bezier(.16,1,.3,1) both`,
                  display: `flex`,
                  flexDirection: `column`,
                  gap: `6px`,
                }}
              >
                <div
                  style={{
                    font: `500 12px/1 'Geist Mono', monospace`,
                    color: toast.color,
                  }}
                >
                  {toast.title}
                </div>
                <div style={{ font: `500 14px/1.3 'Geist', sans-serif` }}>
                  {toast.body}
                </div>
                <div
                  style={{
                    font: `400 12px/1.3 'Geist Mono', monospace`,
                    color: `#8A8F98`,
                  }}
                >
                  {toast.meta}
                </div>
              </div>
            </>
          )}
        </div>
      </>
    );
  }
}
