// @ts-nocheck: a verbatim port of the design bundle's raw-WebGL web component.
// Client only: import it from an effect, it defines <accretion-disc> on first load.
// <accretion-disc> — port of "Accretion Disc 4" (Originkit) to a plain web component. Raw WebGL, transparent canvas.
(() => {
  const TAU = Math.PI * 2, DPR_CAP = 2, ROUT = 100, FOV_DEG = 34;
  const FOCAL = 1 / Math.tan((FOV_DEG * Math.PI) / 180 / 2);
  const RIN_VAL = 24, THICKNESS = 2.4, WIND = 3.4, ARM_SHARPNESS = 2.6, ARM_PULL = 0.45, ARM_SPIN = 0.06;
  const JET_FLOW = 0.09, JET_HELIX = 0.0055, JET_SHARE = 0.28, FOCUS_MULT = 1.75, HALO = 1.7, ORBIT_REF = 0.449;
  const DOT_REF = 0.16, BLUR_REF = 0.64, COUNT_BASE = 20000, COUNT_PER = 3600, TIME_WRAP = 1e5;

  const VERT = `
precision highp float;
attribute vec4 aSeed; attribute float aKind;
uniform float uTime,uTilt,uDist,uAspect,uHalfH,uDotSize,uBlur,uScatter,uArms,uJetAmount,uJetLen,uJetSpread,uZoom; uniform vec2 uShift;
varying float vAlpha; varying float vRamp;
const float FOCAL=${FOCAL.toFixed(6)}; const float ROUT=${ROUT.toFixed(1)}; const float WIND=${WIND.toFixed(3)};
const float THICKNESS=${THICKNESS.toFixed(2)}; const float ORBIT=${ORBIT_REF.toFixed(4)};
void kill(){ gl_Position=vec4(2.0,2.0,2.0,1.0); gl_PointSize=0.0; vAlpha=0.0; vRamp=0.0; }
void main(){
  float rIn=${RIN_VAL.toFixed(1)}; vec3 p; float bright; float ramp;
  if(aKind==0.0){
    float r=sqrt(mix(rIn*rIn,ROUT*ROUT,aSeed.x));
    float f=clamp((r-rIn)/max(ROUT-rIn,1e-3),0.0,1.0);
    float th=aSeed.y+ORBIT*pow(rIn/r,1.5)*uTime;
    float armAngle=uArms*(th-WIND*log(r/rIn))-${ARM_SPIN.toFixed(3)}*uTime*min(uArms,1.0);
    th-=${ARM_PULL.toFixed(2)}*sin(armAngle)/max(uArms,1.0);
    float arm=pow(0.5+0.5*cos(armAngle),${ARM_SHARPNESS.toFixed(1)});
    float flare=0.30+0.70*pow(f,1.2);
    float y=aSeed.z*THICKNESS*uScatter*flare;
    p=vec3(r*cos(th),y,r*sin(th));
    float radial=smoothstep(0.0,0.06,f)*(1.0-smoothstep(0.45,1.0,f));
    radial*=1.0+1.4*exp(-pow((f-0.32)/0.20,2.0));
    float farSide=0.5-0.5*(p.z/max(r,1e-3));
    bright=radial*(0.34+0.75*arm)*mix(0.62,1.0,farSide)*1.45;
    ramp=clamp((1.0-f)*0.55+arm*0.55,0.0,1.0);
  } else {
    if(aSeed.w>uJetAmount){kill();return;}
    float u=fract(aSeed.x+${JET_FLOW.toFixed(3)}*uTime);
    float climb=pow(u,1.35)*uJetLen;
    float cone=tan(uJetSpread)*climb*(0.30+0.70*u)+${RIN_VAL.toFixed(1)}*0.35;
    float rr=aSeed.z*cone; float az=aSeed.y+climb*${JET_HELIX.toFixed(4)};
    p=vec3(rr*cos(az),aKind*climb,rr*sin(az));
    bright=mix(1.0,0.20,smoothstep(0.0,1.0,u))*(0.28+0.72*(1.0-aSeed.z))*1.75;
    ramp=0.30+0.40*(1.0-u);
  }
  float c=cos(uTilt); float s=sin(uTilt);
  vec3 camPos=vec3(0.0,uDist*s,uDist*c); vec3 rel=p-camPos;
  vec3 q=vec3(rel.x,c*rel.y-s*rel.z,s*rel.y+c*rel.z);
  float depth=-q.z; if(depth<1.0){kill();return;}
  gl_Position=vec4(vec2(q.x*FOCAL/(depth*uAspect),q.y*FOCAL/depth)*uZoom+uShift,0.0,1.0);
  float ppw=FOCAL*uHalfH/depth*uZoom; float focusD=uDist*${FOCUS_MULT.toFixed(2)};
  float coc=uBlur*max(0.0,focusD-depth)/focusD;
  float px=(uDotSize+coc)*ppw*${HALO.toFixed(2)};
  vAlpha=bright*pow(uDotSize/max(uDotSize+coc,1e-5),1.6);
  float optical=px/${HALO.toFixed(2)}; if(optical<1.0) vAlpha*=optical*optical;
  vRamp=ramp; gl_PointSize=clamp(px,1.0,96.0);
}`;
  const FRAG = `
precision highp float;
uniform vec3 uBase; uniform vec3 uAccent; varying float vAlpha; varying float vRamp;
void main(){
  vec2 d=gl_PointCoord-0.5; float r2=dot(d,d)*4.0; if(r2>1.0) discard;
  float core=max(0.0,exp(-r2*9.25)-0.0000961); float skirt=max(0.0,exp(-r2*1.80)-0.165299);
  float g=core+0.30*skirt; float e=g*vAlpha; vec3 col=mix(uBase,uAccent,vRamp);
  gl_FragColor=vec4(col*e,e);
}`;

  function compile(gl, type, src) { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.warn('accretion-disc shader:', gl.getShaderInfoLog(sh)); return sh; }
  function link(gl, vs, fs) { const p = gl.createProgram(); gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.warn('accretion-disc link:', gl.getProgramInfoLog(p)); return p; }
  function parseColor(s) { let hx = String(s || '#ffffff').trim().replace('#', ''); if (hx.length === 3) hx = hx.split('').map(c => c + c).join(''); const v = i => (parseInt(hx.slice(i, i + 2), 16) || 0) / 255; return [v(0), v(2), v(4)]; }
  function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function gauss(rnd) { const u1 = Math.max(1e-9, rnd()), u2 = rnd(); return Math.max(-3, Math.min(3, Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2))); }
  function buildCloud(count) {
    const seed = new Float32Array(count * 4), kind = new Float32Array(count), rnd = mulberry32(0x9e3779b9);
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      if (rnd() < JET_SHARE) { seed[o] = rnd(); seed[o + 1] = rnd() * TAU; seed[o + 2] = Math.sqrt(rnd()); seed[o + 3] = rnd(); kind[i] = rnd() < 0.5 ? 1 : -1; }
      else { seed[o] = rnd(); seed[o + 1] = rnd() * TAU; seed[o + 2] = gauss(rnd); seed[o + 3] = rnd(); kind[i] = 0; }
    }
    return { seed, kind };
  }

  // Defaults = the tuned Accretion Disc 4 preset (density 10, dot 107, speed 51, distance 220, scatter 300, tilt 13, jets 100/102/0).
  const DEF = { density: 10, 'dot-size': 107, speed: 51, distance: 220, scatter: 300, blur: 0, tilt: 13, arms: 0, 'jet-amount': 100, 'jet-length': 102, 'jet-spread': 0, base: '#ffffff', accent: '#ffffff', motion: 'on' };

  class AccretionDisc extends HTMLElement {
    static get observedAttributes() { return Object.keys(DEF).concat(['data-zoom', 'data-shift']); }
    num(k) { const v = parseFloat(this.getAttribute(k)); return Number.isFinite(v) ? v : DEF[k]; }
    str(k) { return this.getAttribute(k) || DEF[k]; }
    connectedCallback() {
      if (this._started) return; this._started = true;
      this.style.display = 'block'; if (!this.style.position) this.style.position = 'relative';
      if (!this.style.width) this.style.width = '100%'; if (!this.style.height) this.style.height = '100%';
      this.style.overflow = 'hidden';
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
      this.appendChild(canvas); this._canvas = canvas;
      const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
      if (!gl) return; this._gl = gl;
      const prog = link(gl, VERT, FRAG);
      const U = {}; ['uTime', 'uTilt', 'uDist', 'uAspect', 'uHalfH', 'uDotSize', 'uBlur', 'uScatter', 'uArms', 'uJetAmount', 'uJetLen', 'uJetSpread', 'uBase', 'uAccent', 'uZoom', 'uShift'].forEach(n => U[n] = gl.getUniformLocation(prog, n));
      const aSeed = gl.getAttribLocation(prog, 'aSeed'), aKind = gl.getAttribLocation(prog, 'aKind');
      const seedBuf = gl.createBuffer(), kindBuf = gl.createBuffer();
      let built = 0;
      const rebuild = count => { const { seed, kind } = buildCloud(count); gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf); gl.bufferData(gl.ARRAY_BUFFER, seed, gl.STATIC_DRAW); gl.bindBuffer(gl.ARRAY_BUFFER, kindBuf); gl.bufferData(gl.ARRAY_BUFFER, kind, gl.STATIC_DRAW); built = count; };
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND);
      let bw = 1, bh = 1;
      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
        const w = Math.max(1, Math.round((canvas.clientWidth || this.clientWidth) * dpr)), h = Math.max(1, Math.round((canvas.clientHeight || this.clientHeight) * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        bw = w; bh = h; gl.viewport(0, 0, w, h);
      };
      resize(); this._ro = new ResizeObserver(resize); this._ro.observe(this);
      const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let last = 0, t = 0;
      const frame = now => {
        this._raf = requestAnimationFrame(frame);
        const dt = last === 0 ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
        const motion = this.str('motion') !== 'off' && !reduced;
        t = (t + dt * (motion ? this.num('speed') / 50 : 0)) % TIME_WRAP;
        const count = Math.round(COUNT_BASE + this.num('density') * COUNT_PER);
        if (built !== count) rebuild(count);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.blendFunc(gl.ONE, gl.ONE); gl.useProgram(prog);
        gl.uniform1f(U.uTime, t); gl.uniform1f(U.uTilt, this.num('tilt') * Math.PI / 180); gl.uniform1f(U.uDist, this.num('distance'));
        gl.uniform1f(U.uAspect, bw / Math.max(bh, 1)); gl.uniform1f(U.uHalfH, bh * 0.5);
        gl.uniform1f(U.uDotSize, DOT_REF * this.num('dot-size') / 100); gl.uniform1f(U.uBlur, BLUR_REF * this.num('blur') / 100);
        gl.uniform1f(U.uScatter, this.num('scatter') / 100); gl.uniform1f(U.uArms, this.num('arms'));
        gl.uniform1f(U.uJetAmount, this.num('jet-amount') / 100); gl.uniform1f(U.uJetLen, this.num('jet-length') / 100 * ROUT); gl.uniform1f(U.uJetSpread, this.num('jet-spread') * Math.PI / 180);
        const zoom = parseFloat(this.getAttribute('data-zoom')); gl.uniform1f(U.uZoom, Number.isFinite(zoom) ? zoom : 1);
        const sh = (this.getAttribute('data-shift') || '0,0').split(',').map(parseFloat); gl.uniform2f(U.uShift, sh[0] || 0, sh[1] || 0);
        gl.uniform3fv(U.uBase, parseColor(this.str('base'))); gl.uniform3fv(U.uAccent, parseColor(this.str('accent')));
        gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf); gl.enableVertexAttribArray(aSeed); gl.vertexAttribPointer(aSeed, 4, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, kindBuf); gl.enableVertexAttribArray(aKind); gl.vertexAttribPointer(aKind, 1, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, built);
      };
      this._raf = requestAnimationFrame(frame);
    }
    disconnectedCallback() { cancelAnimationFrame(this._raf); if (this._ro) this._ro.disconnect(); this._started = false; if (this._canvas) this._canvas.remove(); }
  }
  if (!customElements.get('accretion-disc')) customElements.define('accretion-disc', AccretionDisc);
})();

export {};
