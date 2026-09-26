"use client";

import * as React from "react";

// The chromatic light field behind every page. Rendered at a third of the
// screen resolution and ~25 fps, then blurred, so it stays cheap.
const VERTEX = `precision highp float; void main(){ vec2 p; if(gl_VertexID==0)p=vec2(-1.,-1.); else if(gl_VertexID==1)p=vec2(3.,-1.); else p=vec2(-1.,3.); gl_Position=vec4(p,0.,1.); }`;
const FRAGMENT = `precision highp float; precision highp int;
  uniform vec2 uResolution; uniform float uTime; out vec4 outputColor;
  vec3 sn(vec3 v){ return v*inversesqrt(max(dot(v,v),1e-8)); }
  float sa(float v,float r){ return sqrt(v*v+r*r); }
  vec3 warp(vec3 p){ float fr=3.4; for(int i=0;i<6;++i){ fr*=0.625; vec3 ph=p*(fr*0.86)+(fr+uTime); vec3 d=sin(ph)*(1.1/max(fr,1e-4)); p=mix(p.zxy,p,-0.02)+d; } return p; }
  void main(){ vec2 uv=(gl_FragCoord.xy*2.0-uResolution)/max(uResolution.y,1.0); vec3 rdir=sn(vec3(-uv,1.0)); float rd=6.1; vec3 acc=vec3(0.0); const vec3 co=vec3(0.0,1.0,2.0);
    for(int i=0;i<44;++i){ vec3 wp=warp(rdir*rd); float m=mix(rd,wp.z,0.5); float rs=0.001+sa(3.8-m,0.01)*(1.0/11.6); rd+=rs; vec3 cl=sin(rd+float(i)*0.15+co)+1.0; acc+=cl/max(rs,1e-6); }
    vec3 oc=tanh(acc/15000.0); vec3 tc=oc*vec3(0.92,0.97,1.0); float mm=clamp(max(tc.r,max(tc.g,tc.b)),0.0,1.0);
    outputColor=vec4(max(vec3(0.031,0.035,0.043)+tc*mm,vec3(0.0)),1.0); }`;

export default function Background() {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    let alive = true;
    let raf = 0;
    let cleanup = () => {};

    (async () => {
      const THREE = await import("three");
      const canvas = ref.current;
      if (!canvas || !alive) return;

      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      const camera = new THREE.Camera();
      const uniforms = {
        uResolution: { value: new THREE.Vector2() },
        uTime: { value: 0 },
      };
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
      const material = new THREE.RawShaderMaterial({
        uniforms,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        glslVersion: THREE.GLSL3,
        depthTest: false,
        depthWrite: false,
      });
      const tri = new THREE.Mesh(geo, material);
      tri.frustumCulled = false;
      scene.add(tri);

      let W = 0;
      let H = 0;
      const resize = () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (w === W && h === H) return;
        W = w;
        H = h;
        renderer.setPixelRatio(0.34);
        renderer.setSize(w, h, false);
        renderer.getDrawingBufferSize(uniforms.uResolution.value);
      };
      window.addEventListener("resize", resize, { passive: true });
      resize();

      let last = performance.now();
      let elapsed = 0;
      const loop = (now: number) => {
        if (!alive) return;
        raf = requestAnimationFrame(loop);
        if (document.hidden) {
          last = now;
          return;
        }
        if (now - last < 40) return;
        elapsed += Math.min((now - last) / 1000, 1 / 24);
        last = now;
        uniforms.uTime.value = elapsed * 0.07;
        renderer.render(scene, camera);
      };
      loop(performance.now());

      cleanup = () => {
        window.removeEventListener("resize", resize);
        geo.dispose();
        material.dispose();
        renderer.dispose();
      };
    })().catch((e) =>
      console.warn("background unavailable", e instanceof Error ? e.message : String(e)),
    );

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      cleanup();
    };
  }, []);

  return (
    <>
      <canvas
        ref={ref}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 h-full w-full opacity-50 blur-[1px]"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[1]"
        style={{
          background:
            "linear-gradient(180deg, rgba(8,9,11,.45) 0%, rgba(8,9,11,.62) 55%, rgba(8,9,11,.88) 100%)",
        }}
      />
    </>
  );
}
