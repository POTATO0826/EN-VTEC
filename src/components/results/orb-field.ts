// @ts-nocheck: a verbatim port of the design bundle's raw-WebGL web component.
// Client only: import it from an effect, it defines <orb-field> on first load.
// <orb-field> — hub-and-spoke constellation in raw WebGL. Every orb is a glowing particle burst (rays of particles
// streaming out from a hot core, à la "Glowing Particles"), stems carry flowing particles between them, and the
// whole group turns slowly. Selecting an orb zooms in and parks it at data-focus-x (clip space).
// Attributes: data-domains (JSON [{id,label,color}]), data-selected, data-focus-x, data-spin, data-motion.
// Events: orb-select {id}, orb-hover {id|null}.
(() => {
  const RING = 3.2, SAT_R = 0.5, HUB_R = 0.85, NODE_R = 0.18, DIST = 11, TILT = 0.32, F = 2.4, MAX_ORBS = 16;
  const HUB_COLOR = [0.81, 0.90, 1.0], STEM_COLOR = [0.81, 0.90, 1.0], HOT = [1, 1, 1];
  const CAM = `
uniform mat3 uModel; uniform float uTilt,uDist,uAspect,uZoom,uFocal; uniform vec2 uShift;
vec3 toCam(vec3 m, out float depth){ vec3 p=uModel*m; float c=cos(uTilt), s=sin(uTilt);
  vec3 cam=vec3(0.0,uDist*s,uDist*c); vec3 rel=p-cam; vec3 q=vec3(rel.x, c*rel.y-s*rel.z, s*rel.y+c*rel.z); depth=-q.z; return q; }
vec2 toClip(vec3 q, float depth){ return vec2(q.x*uFocal/(depth*uAspect), q.y*uFocal/depth)*uZoom+uShift; }`;

  // haze + hot core quad per orb
  const HAZE_V = `precision highp float; attribute vec3 aCenter; attribute vec2 aCorner; attribute float aRadius; attribute vec3 aColor; attribute vec2 aMisc;
${CAM} varying vec2 vUv; varying vec3 vColor; varying float vAlpha;
void main(){ float depth; vec3 q=toCam(aCenter,depth); vec2 clip=toClip(q,depth);
  float hs=aRadius*aMisc.x*1.9; float ppw=uFocal/depth*uZoom;
  gl_Position=vec4(clip+aCorner*hs*ppw*vec2(1.0/uAspect,1.0),0.0,1.0); vUv=aCorner; vColor=aColor; vAlpha=aMisc.y; }`;
  const HAZE_F = `precision highp float; uniform vec3 uHot; varying vec2 vUv; varying vec3 vColor; varying float vAlpha;
void main(){ float d=length(vUv); if(d>1.0) discard; float haze=pow(1.0-d,1.7); float core=pow(1.0-d,9.0);
  vec3 col=vColor*haze*0.42+uHot*core*0.9; float a=(haze*0.42+core*0.9)*vAlpha; gl_FragColor=vec4(col*vAlpha,a); }`;

  // burst particles: rays streaming outward from each orb centre
  const BURST_V = `precision highp float; attribute vec3 aCenter; attribute vec3 aDir; attribute float aOffset; attribute float aSeed; attribute float aRadius; attribute vec3 aColor; attribute float aOrb;
${CAM} uniform float uTime,uHalfH,uDpr; uniform float uScale[${MAX_ORBS}]; uniform float uAlpha[${MAX_ORBS}];
varying float vLife; varying float vBright; varying vec3 vColor;
void main(){ int i=int(aOrb+0.5); float sc=uScale[i]; float al=uAlpha[i];
  float t=fract(aOffset+uTime*0.26*(0.65+aSeed*0.7));
  float life=mix(aSeed,1.0,0.85); float r=aRadius*sc*life*(1.0-pow(1.0-t,3.0));
  float ang=uTime*0.45+aOrb*1.7; vec3 d=vec3(aDir.x*cos(ang)-aDir.z*sin(ang), aDir.y, aDir.x*sin(ang)+aDir.z*cos(ang));
  float depth; vec3 q=toCam(aCenter+d*r,depth); gl_Position=vec4(toClip(q,depth),0.0,1.0);
  float ppw=uFocal*uHalfH/depth*uZoom; float shrink=1.0-t*0.45;
  gl_PointSize=clamp(aRadius*sc*0.12*shrink*ppw*uDpr,1.0,48.0);
  float birth=smoothstep(0.0,0.05,t); float death=1.0-smoothstep(0.82,1.0,t);
  float flick=0.5+0.5*sin(uTime*9.0+aSeed*43.0+aOffset*61.0);
  vBright=birth*death*flick*al; vLife=t; vColor=aColor; }`;
  const BURST_F = `precision highp float; uniform vec3 uHot; varying float vLife; varying float vBright; varying vec3 vColor;
void main(){ float d=length(gl_PointCoord-0.5)*2.0; if(d>1.0) discard; float fall=1.0-d;
  float shape=pow(fall,5.0)+pow(fall,1.6)*0.3; vec3 col=mix(uHot,vColor,smoothstep(0.0,0.55,vLife)); float a=shape*vBright; gl_FragColor=vec4(col*a,a); }`;

  const LINE_V = `precision highp float; attribute vec3 aPos; attribute float aAlpha; ${CAM} varying float vA;
void main(){ float depth; vec3 q=toCam(aPos,depth); gl_Position=vec4(toClip(q,depth),0.0,1.0); vA=aAlpha; }`;
  const LINE_F = `precision highp float; uniform vec3 uColor; varying float vA; void main(){ gl_FragColor=vec4(uColor*vA,vA); }`;

  const PT_V = `precision highp float; attribute vec3 aStart; attribute vec3 aEnd; attribute float aOffset; attribute float aSeed; attribute float aDir; attribute float aStem;
${CAM} uniform float uTime,uSpeed,uHalfH,uDpr; uniform float uFade[8]; varying float vB; varying float vT;
void main(){ float t=fract(aOffset+uTime*uSpeed*(0.6+0.8*aSeed)); if(aDir<0.0) t=1.0-t;
  float depth; vec3 q=toCam(mix(aStart,aEnd,t),depth); gl_Position=vec4(toClip(q,depth),0.0,1.0);
  float ppw=uFocal*uHalfH/depth*uZoom; gl_PointSize=clamp((0.05+0.06*aSeed)*ppw*uDpr,1.0,40.0);
  float fade=uFade[int(aStem+0.5)]; float flick=0.6+0.4*sin(uTime*7.0+aSeed*40.0);
  vB=sin(3.1416*t)*flick*fade; vT=t; }`;
  const PT_F = `precision highp float; uniform vec3 uColor; uniform vec3 uHot; varying float vB; varying float vT;
void main(){ float d=length(gl_PointCoord-0.5)*2.0; if(d>1.0) discard; float fall=1.0-d;
  float shape=pow(fall,4.0)+pow(fall,1.5)*0.3; vec3 col=mix(uHot,uColor,0.5); float a=shape*vB; gl_FragColor=vec4(col*a,a); }`;

  function compile(gl, type, src) { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.warn('orb-field shader:', gl.getShaderInfoLog(sh)); return sh; }
  function link(gl, vs, fs) { const p = gl.createProgram(); gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.warn('orb-field link:', gl.getProgramInfoLog(p)); return p; }
  function hex(s) { let h = String(s || '#cfe6ff').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const v = i => (parseInt(h.slice(i, i + 2), 16) || 0) / 255; return [v(0), v(2), v(4)]; }
  const lerp = (a, b, k) => a + (b - a) * k;
  function model(spin, wob) { const cy = Math.cos(spin), sy = Math.sin(spin), cx = Math.cos(wob), sx = Math.sin(wob);
    return new Float32Array([cy, sx * sy, -cx * sy, 0, cx, sx, sy, -sx * cy, cx * cy]); }
  function mul(M, p) { return [M[0] * p[0] + M[3] * p[1] + M[6] * p[2], M[1] * p[0] + M[4] * p[1] + M[7] * p[2], M[2] * p[0] + M[5] * p[1] + M[8] * p[2]]; }
  function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

  class OrbField extends HTMLElement {
    static get observedAttributes() { return ['data-domains', 'data-selected', 'data-focus-x', 'data-spin', 'data-motion']; }
    constructor() { super(); this.orbs = []; this.stems = []; this.hover = null; this.zoom = 1; this.shift = [0, 0]; this.spin = 0.6; this.vel = 0; this.time = 0; this.labels = new Map(); }
    attributeChangedCallback(n) { if (n === 'data-domains' && this.layer) this.buildScene(); }
    get selected() { return this.getAttribute('data-selected') || null; }
    get domains() { try { return JSON.parse(this.getAttribute('data-domains') || '[]'); } catch { return []; } }

    connectedCallback() {
      if (this._started) return; this._started = true;
      this.style.display = 'block'; if (!this.style.position) this.style.position = 'relative';
      if (!this.style.width) this.style.width = '100%'; if (!this.style.height) this.style.height = '100%';
      this.style.overflow = 'hidden';
      const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
      this.appendChild(canvas); this.canvas = canvas;
      this.layer = document.createElement('div'); this.layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden'; this.appendChild(this.layer);
      const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true }); if (!gl) return; this.gl = gl;
      this.pHaze = link(gl, HAZE_V, HAZE_F); this.pBurst = link(gl, BURST_V, BURST_F); this.pLine = link(gl, LINE_V, LINE_F); this.pPt = link(gl, PT_V, PT_F);
      this.bHaze = gl.createBuffer(); this.bBurst = gl.createBuffer(); this.bLine = gl.createBuffer(); this.bPt = gl.createBuffer();
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND);
      this.buildScene();
      const resize = () => { const dpr = Math.min(window.devicePixelRatio || 1, 2); this.W = this.clientWidth || 1; this.H = this.clientHeight || 1; this.dpr = dpr;
        canvas.width = Math.max(1, Math.round(this.W * dpr)); canvas.height = Math.max(1, Math.round(this.H * dpr)); gl.viewport(0, 0, canvas.width, canvas.height); };
      resize(); this.ro = new ResizeObserver(resize); this.ro.observe(this);
      this.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      canvas.addEventListener('pointermove', e => { const r = canvas.getBoundingClientRect(); this.pick(e.clientX - r.left, e.clientY - r.top); });
      canvas.addEventListener('pointerleave', () => this.setHover(null));
      canvas.addEventListener('pointerdown', e => { this.down = [e.clientX, e.clientY]; });
      canvas.addEventListener('pointerup', e => { if (!this.down || Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 6) return; const r = canvas.getBoundingClientRect(); this.pick(e.clientX - r.left, e.clientY - r.top);
        if (this.hover) this.dispatchEvent(new CustomEvent('orb-select', { detail: { id: this.hover }, bubbles: true, composed: true })); });
      let last = 0; const frame = now => { this.raf = requestAnimationFrame(frame); const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now; this.step(dt); };
      this.raf = requestAnimationFrame(frame);
    }
    disconnectedCallback() { cancelAnimationFrame(this.raf); if (this.ro) this.ro.disconnect(); this._started = false; }

    buildScene() {
      const ds = this.domains; const n = Math.max(ds.length, 1);
      this.orbs = [{ id: '__hub', pos: [0, 0, 0], r: HUB_R, color: HUB_COLOR, scale: 1, alpha: 1, hub: true, rays: 700 }];
      this.stems = [];
      ds.forEach((d, i) => {
        const a = (i / n) * Math.PI * 2 + 0.4; const y = 0.5 * Math.sin(a * 2 + 0.7);
        const pos = [RING * Math.cos(a), y, RING * Math.sin(a)];
        this.orbs.push({ id: d.id, label: d.label, pos, r: SAT_R, color: hex(d.color), scale: 1, alpha: 1, stem: i, rays: 380 });
        if (i % 2 === 0) this.orbs.push({ id: '__n' + i, pos: pos.map(v => v * 0.5), r: NODE_R, color: STEM_COLOR, scale: 1, alpha: 1, node: true, stem: i, rays: 70 });
        this.stems.push({ i, a: [0, 0, 0], b: pos, fade: 1 });
      });
      this.orbs = this.orbs.slice(0, MAX_ORBS);
      if (this.gl) { this.buildBursts(); this.buildParticles(); }
      for (const [id, el] of this.labels) if (!this.orbs.find(o => o.id === id)) { el.remove(); this.labels.delete(id); }
      this.orbs.filter(o => o.label).forEach(o => { let el = this.labels.get(o.id); if (!el) { el = document.createElement('div');
        el.style.cssText = 'position:absolute;font-family:inherit;font-weight:600;font-size:11px;line-height:1;letter-spacing:0.12em;text-transform:uppercase;color:#f3f2f2;white-space:nowrap;transform:translateY(-50%);transition:opacity .4s;will-change:left,top';
        this.layer.appendChild(el); this.labels.set(o.id, el); } el.textContent = o.label; });
    }
    buildBursts() {
      const gl = this.gl, rows = [], golden = Math.PI * (3 - Math.sqrt(5)), rnd = rng(987654), perRay = 6;
      this.orbs.forEach((o, oi) => {
        for (let r = 0; r < o.rays; r++) {
          const y = 1 - (r / Math.max(1, o.rays - 1)) * 2, ring = Math.sqrt(Math.max(0, 1 - y * y)), th = golden * r;
          let dx = Math.cos(th) * ring + (rnd() - 0.5) * 0.1, dy = y + (rnd() - 0.5) * 0.1, dz = Math.sin(th) * ring + (rnd() - 0.5) * 0.1;
          const len = Math.hypot(dx, dy, dz) || 1; dx /= len; dy /= len; dz /= len;
          const rayLife = 0.6 + rnd() * 0.4, phase = rnd();
          for (let p = 0; p < perRay; p++) rows.push(...o.pos, dx, dy, dz, phase + (p / perRay) * 0.2, rayLife, o.r, ...o.color, oi);
        }
      });
      this.burstCount = rows.length / 13; gl.bindBuffer(gl.ARRAY_BUFFER, this.bBurst); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(rows), gl.STATIC_DRAW);
    }
    buildParticles() {
      const gl = this.gl, per = 34, rows = [], rnd = rng(12345);
      this.stems.forEach(st => { for (let k = 0; k < per; k++) rows.push(...st.a, ...st.b, rnd(), rnd(), k % 3 === 0 ? -1 : 1, st.i); });
      this.ptCount = this.stems.length * per; gl.bindBuffer(gl.ARRAY_BUFFER, this.bPt); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(rows), gl.STATIC_DRAW);
    }
    setHover(id) { if (id === this.hover) return; this.hover = id; this.canvas.style.cursor = id ? 'pointer' : ''; this.dispatchEvent(new CustomEvent('orb-hover', { detail: { id }, bubbles: true, composed: true })); }
    project(m) { const p = mul(this.M, m); const c = Math.cos(TILT), s = Math.sin(TILT); const rel = [p[0], p[1] - DIST * s, p[2] - DIST * c];
      const q = [rel[0], c * rel[1] - s * rel[2], s * rel[1] + c * rel[2]]; const depth = -q[2]; const aspect = this.W / this.H;
      const raw = [q[0] * F / (depth * aspect), q[1] * F / depth]; return { raw, x: raw[0] * this.zoom + this.shift[0], y: raw[1] * this.zoom + this.shift[1], depth }; }
    pick(px, py) { let best = null, bd = 1e9; if (!this.M) return; for (const o of this.orbs) { if (o.hub || o.node) continue; const pr = this.project(o.pos);
        const sx = (pr.x + 1) / 2 * this.W, sy = (1 - pr.y) / 2 * this.H; const rpx = o.r * o.scale * F / pr.depth * this.zoom * this.H / 2;
        const d = Math.hypot(px - sx, py - sy); if (d < rpx * 1.2 + 6 && d < bd) { bd = d; best = o.id; } } this.setHover(best); }

    step(dt) {
      const gl = this.gl; if (!gl || !this.W) return;
      const motion = this.getAttribute('data-motion') !== 'off' && !this.reduced;
      const baseSpin = parseFloat(this.getAttribute('data-spin')); const spinRate = Number.isFinite(baseSpin) ? baseSpin : 0.12;
      const sel = this.selected, focusX = parseFloat(this.getAttribute('data-focus-x')); const fx = Number.isFinite(focusX) ? focusX : -0.5;
      const k = 1 - Math.exp(-dt * 4.5);
      if (motion) this.time += dt;
      this.vel = lerp(this.vel, motion ? spinRate * (sel ? 0.18 : 1) : 0, k); this.spin += this.vel * dt;
      this.M = model(this.spin, 0.3 + 0.05 * Math.sin(this.time * 0.3));
      this.zoom = lerp(this.zoom, sel ? 2.1 : 1, k);
      const selOrb = this.orbs.find(o => o.id === sel);
      let tgt = [0, 0]; if (selOrb) { const pr = this.project(selOrb.pos); tgt = [fx - pr.raw[0] * this.zoom, 0.02 - pr.raw[1] * this.zoom]; }
      this.shift = [lerp(this.shift[0], tgt[0], k), lerp(this.shift[1], tgt[1], k)];
      if (!this.follow) this.follow = document.querySelector(this.getAttribute('data-follow') || 'accretion-disc');
      if (this.follow) { this.follow.setAttribute('data-zoom', this.zoom.toFixed(4)); this.follow.setAttribute('data-shift', this.shift[0].toFixed(4) + ',' + this.shift[1].toFixed(4)); }
      for (const o of this.orbs) { const isSel = o.id === sel; const tScale = isSel ? 1.3 : (o.id === this.hover ? 1.15 : 1);
        const tAlpha = sel ? (isSel ? 1 : o.hub ? 0.4 : o.node ? 0.25 : 0.18) : 1; o.scale = lerp(o.scale, tScale, k); o.alpha = lerp(o.alpha, tAlpha, k); }
      for (const st of this.stems) st.fade = lerp(st.fade, sel ? (selOrb && selOrb.stem === st.i ? 0.9 : 0.14) : 1, k);

      const aspect = this.W / this.H;
      const setCam = p => { gl.useProgram(p); gl.uniformMatrix3fv(gl.getUniformLocation(p, 'uModel'), false, this.M); gl.uniform1f(gl.getUniformLocation(p, 'uTilt'), TILT);
        gl.uniform1f(gl.getUniformLocation(p, 'uDist'), DIST); gl.uniform1f(gl.getUniformLocation(p, 'uAspect'), aspect); gl.uniform1f(gl.getUniformLocation(p, 'uZoom'), this.zoom);
        gl.uniform1f(gl.getUniformLocation(p, 'uFocal'), F); gl.uniform2f(gl.getUniformLocation(p, 'uShift'), this.shift[0], this.shift[1]); };
      const attr = (p, name, size, stride, off) => { const loc = gl.getAttribLocation(p, name); if (loc < 0) return; gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, off * 4); };
      const disableAll = () => { for (let i = 0; i < 8; i++) gl.disableVertexAttribArray(i); };
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.blendFunc(gl.ONE, gl.ONE); // everything is emissive

      // stems
      disableAll(); setCam(this.pLine);
      const lines = []; for (const st of this.stems) lines.push(...st.a, 0.3 * st.fade, ...st.b, 0.3 * st.fade);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bLine); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);
      attr(this.pLine, 'aPos', 3, 4, 0); attr(this.pLine, 'aAlpha', 1, 4, 3);
      gl.uniform3fv(gl.getUniformLocation(this.pLine, 'uColor'), STEM_COLOR); gl.drawArrays(gl.LINES, 0, this.stems.length * 2);

      // stem particles
      if (this.ptCount) { disableAll(); setCam(this.pPt); const p = this.pPt;
        gl.uniform1f(gl.getUniformLocation(p, 'uTime'), this.time); gl.uniform1f(gl.getUniformLocation(p, 'uSpeed'), 0.16); gl.uniform1f(gl.getUniformLocation(p, 'uHalfH'), this.H / 2); gl.uniform1f(gl.getUniformLocation(p, 'uDpr'), this.dpr);
        const fades = new Float32Array(8); this.stems.forEach(st => fades[st.i] = st.fade); gl.uniform1fv(gl.getUniformLocation(p, 'uFade'), fades);
        gl.uniform3fv(gl.getUniformLocation(p, 'uColor'), STEM_COLOR); gl.uniform3fv(gl.getUniformLocation(p, 'uHot'), HOT);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bPt); attr(p, 'aStart', 3, 10, 0); attr(p, 'aEnd', 3, 10, 3); attr(p, 'aOffset', 1, 10, 6); attr(p, 'aSeed', 1, 10, 7); attr(p, 'aDir', 1, 10, 8); attr(p, 'aStem', 1, 10, 9);
        gl.drawArrays(gl.POINTS, 0, this.ptCount); }

      // haze + core per orb
      disableAll(); setCam(this.pHaze); { const p = this.pHaze; gl.uniform3fv(gl.getUniformLocation(p, 'uHot'), HOT);
        const verts = [], corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
        for (const o of this.orbs) for (const c of corners) verts.push(...o.pos, ...c, o.r, ...o.color, o.scale, o.alpha);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bHaze); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
        attr(p, 'aCenter', 3, 11, 0); attr(p, 'aCorner', 2, 11, 3); attr(p, 'aRadius', 1, 11, 5); attr(p, 'aColor', 3, 11, 6); attr(p, 'aMisc', 2, 11, 9);
        gl.drawArrays(gl.TRIANGLES, 0, this.orbs.length * 6); }

      // bursts
      if (this.burstCount) { disableAll(); setCam(this.pBurst); const p = this.pBurst;
        gl.uniform1f(gl.getUniformLocation(p, 'uTime'), this.time); gl.uniform1f(gl.getUniformLocation(p, 'uHalfH'), this.H / 2); gl.uniform1f(gl.getUniformLocation(p, 'uDpr'), this.dpr);
        const sc = new Float32Array(MAX_ORBS), al = new Float32Array(MAX_ORBS); this.orbs.forEach((o, i) => { sc[i] = o.scale; al[i] = o.alpha; });
        gl.uniform1fv(gl.getUniformLocation(p, 'uScale'), sc); gl.uniform1fv(gl.getUniformLocation(p, 'uAlpha'), al); gl.uniform3fv(gl.getUniformLocation(p, 'uHot'), HOT);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bBurst); attr(p, 'aCenter', 3, 13, 0); attr(p, 'aDir', 3, 13, 3); attr(p, 'aOffset', 1, 13, 6); attr(p, 'aSeed', 1, 13, 7); attr(p, 'aRadius', 1, 13, 8); attr(p, 'aColor', 3, 13, 9); attr(p, 'aOrb', 1, 13, 12);
        gl.drawArrays(gl.POINTS, 0, this.burstCount); }

      // labels
      for (const o of this.orbs) { const el = this.labels.get(o.id); if (!el) continue; const pr = this.project(o.pos);
        const sx = (pr.x + 1) / 2 * this.W, sy = (1 - pr.y) / 2 * this.H; const rpx = o.r * o.scale * F / pr.depth * this.zoom * this.H / 2;
        el.style.left = (sx + rpx + 12) + 'px'; el.style.top = sy + 'px';
        el.style.opacity = sel ? (o.id === sel ? 0 : 0.28) : (o.id === this.hover ? 1 : 0.72); }
    }
  }
  if (!customElements.get('orb-field')) customElements.define('orb-field', OrbField);
})();

export {};
