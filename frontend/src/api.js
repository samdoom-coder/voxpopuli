const BASE = "/api";

async function http(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-json */
  }
  if (!res.ok) {
    throw new Error(data?.error || data?.detail || `${res.status} ${res.statusText}`);
  }
  return data;
}

export const api = {
  health: () => http("/health"),

  createProject: (fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach((f) => fd.append("files", f));
      else fd.append(k, v);
    }
    return fetch(BASE + "/projects", { method: "POST", body: fd }).then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || d.detail || "request failed");
      return d;
    });
  },

  listProjects: () => http("/projects"),
  getProject: (pid) => http(`/projects/${pid}`),

  createSimulation: (payload) =>
    http("/simulations", { method: "POST", body: JSON.stringify(payload) }),
  listSimulations: () => http("/simulations"),
  getSimulation: (sid) => http(`/simulations/${sid}`),
  buildWorld: (sid) => http(`/simulations/${sid}/build`, { method: "POST" }),
  runSimulation: (sid) => http(`/simulations/${sid}/run`, { method: "POST" }),
  stopSimulation: (sid) => http(`/simulations/${sid}/stop`, { method: "POST" }),
  injectEvent: (sid, payload) =>
    http(`/simulations/${sid}/events`, { method: "POST", body: JSON.stringify(payload) }),
  getAgents: (sid) => http(`/simulations/${sid}/agents`),
  getAgentMessages: (sid, aid, limit = 12) =>
    http(`/simulations/${sid}/agents/${aid}/messages?limit=${limit}`),
  getMessages: (sid, limit = 80) => http(`/simulations/${sid}/messages?limit=${limit}`),
  getSnapshots: (sid) => http(`/simulations/${sid}/snapshots`),
  getEvents: (sid) => http(`/simulations/${sid}/events`),
  getReport: (sid) => http(`/simulations/${sid}/report`),
  regenReport: (sid) => http(`/simulations/${sid}/report`, { method: "POST" }),
  getAnalysis: (sid) => http(`/simulations/${sid}/analysis`),
};

export function wsUrl(sid) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/${sid}`;
}
