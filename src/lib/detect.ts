"use client";

export type Device = {
  id: string;
  name: string;
  kind: "gpu" | "cpu";
  source: "browser" | "agent";
  detail?: string;
};

/**
 * What the browser can tell us. WebGL exposes the GPU name on most systems
 * (Chrome wraps it as "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU …)").
 * On a laptop with two GPUs the browser may only see one of them; the local
 * agent reads the exact list with nvidia-smi.
 */
export function detectFromBrowser(): Device[] {
  const devices: Device[] = [];

  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    const raw = ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
    const name = cleanRenderer(raw);
    if (name) devices.push({ id: `browser:${name}`, name, kind: "gpu", source: "browser" });
  } catch {
    /* no WebGL: fall through to CPU */
  }

  const threads = navigator.hardwareConcurrency;
  devices.push({
    id: "browser:cpu",
    name: "CPU",
    kind: "cpu",
    source: "browser",
    detail: threads ? `${threads} threads` : undefined,
  });
  return devices;
}

function cleanRenderer(raw: string) {
  if (!raw) return "";
  // "ANGLE (Intel, Intel(R) UHD Graphics (0x0000A788) Direct3D11 vs_5_0 ps_5_0, D3D11)"
  // -> vendor, device, backend. The device part is what we want.
  let name = raw;
  if (raw.startsWith("ANGLE (")) {
    const parts = raw.slice(7, -1).split(", ");
    name = parts[1] ?? parts[0];
  }
  name = name
    .replace(/\s*\(0x[0-9a-f]+\)/i, "")
    .replace(/\s+(Direct3D|OpenGL|Vulkan|Metal).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  // Software renderers aren't hardware the user can pick.
  return /swiftshader|llvmpipe|software/i.test(name) ? "" : name;
}
