import { useEffect, useRef } from "react";

const W = 1000;
const H = 600;
const PAD_X = 64;
const PAD_Y = 56;

// Palette — matches the app's light editorial theme + legend dots
const BLUE = [43, 75, 238]; // opposed  (#2b4bee)
const GRAY = [154, 154, 144]; // neutral (#9a9a90)
const AMBER = [180, 83, 9]; // supportive (#b45309)
const INK = "#16150f";
const MUTED = "#6f6f66";

function stanceColor(stance, alpha = 1) {
  const t = Math.max(0, Math.min(1, (stance + 1) / 2)); // 0 oppose .. 1 support
  let c;
  if (t < 0.5) {
    const k = t * 2;
    c = BLUE.map((b, i) => b + (GRAY[i] - b) * k);
  } else {
    const k = (t - 0.5) * 2;
    c = GRAY.map((b, i) => b + (AMBER[i] - b) * k);
  }
  return `rgba(${c.map((v) => Math.round(v)).join(",")},${alpha})`;
}

function campOf(stance) {
  if (stance > 0.25) return "support";
  if (stance < -0.25) return "oppose";
  return "neutral";
}

function hashStr(s) {
  let h = 2166136261;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// x is LIVE stance (so nodes migrate as opinions shift), y is a stable per-citizen slot
function targetX(stance) {
  const t = Math.max(-1, Math.min(1, stance));
  return W / 2 + t * (W / 2 - PAD_X);
}
function ySlotFor(id) {
  const h = hashStr(id);
  return ((h % 1000) / 1000) * 2 - 1; // -1..1
}
function phaseFor(id) {
  return (hashStr("ph:" + id) % 628) / 100;
}
function targetY(id) {
  return H / 2 + ySlotFor(id) * (H / 2 - PAD_Y);
}

// Deterministic social ties: ring-lattice over stance order (neighbours talk)
// plus one long-range link per citizen to an influencer hub. Stable by id.
function buildEdges(agents) {
  if (agents.length < 2) return [];
  const sorted = [...agents].sort((a, b) => a.stance - b.stance || (a.id < b.id ? -1 : 1));
  const edges = [];
  const seen = new Set();
  const link = (a, b) => {
    if (!a || !b || a.id === b.id) return;
    const k = a.id < b.id ? a.id + "|" + b.id : b.id + "|" + a.id;
    if (seen.has(k)) return;
    seen.add(k);
    edges.push([a.id, b.id]);
  };
  const n = sorted.length;
  for (let i = 0; i < n; i++) {
    link(sorted[i], sorted[(i + 1) % n]);
    if (n > 6) link(sorted[i], sorted[(i + 2) % n]);
  }
  const hubs = [...agents].sort((a, b) => (b.influence || 0) - (a.influence || 0)).slice(0, Math.max(3, Math.round(n * 0.15)));
  for (const a of agents) {
    if (hubs.some((h) => h.id === a.id)) continue;
    const h = hubs[hashStr(a.id) % hubs.length];
    link(a, h);
  }
  return edges;
}

function roundRectPath(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export default function LiveCanvas({ agents, actions, event, running, selectedId, onSelect }) {
  const canvasRef = useRef(null);
  const agentsRef = useRef(agents);
  const posRef = useRef(new Map()); // id -> {x,y} smoothed render position
  const edgesRef = useRef([]);
  const edgeKeyRef = useRef("");
  const bubblesRef = useRef([]);
  const wavesRef = useRef([]);
  const pulseRef = useRef(new Map()); // agent_id -> timestamp of last action
  const hoverRef = useRef(null);
  const selectedRef = useRef(selectedId);
  const byIdRef = useRef(new Map());

  selectedRef.current = selectedId;

  useEffect(() => {
    agentsRef.current = agents;
    const map = new Map();
    for (const a of agents) map.set(a.id, a);
    byIdRef.current = map;
    // init / prune smoothed positions
    const pos = posRef.current;
    for (const a of agents) {
      if (!pos.has(a.id)) pos.set(a.id, { x: targetX(a.stance), y: targetY(a.id) });
    }
    for (const id of [...pos.keys()]) {
      if (!map.has(id)) pos.delete(id);
    }
    // rebuild ties only when membership changes (keeps links stable as stances drift)
    const key = agents.map((a) => a.id).sort().join(",");
    if (key !== edgeKeyRef.current) {
      edgeKeyRef.current = key;
      edgesRef.current = buildEdges(agents);
    }
  }, [agents]);

  // activity pulses + speech bubbles from the live feed
  useEffect(() => {
    const list = Array.isArray(actions) ? actions : [];
    if (!list.length) return;
    const now = performance.now();
    const byId = byIdRef.current;
    for (const act of list.slice(0, 12)) {
      const a = byId.get(act.agent_id);
      if (!a) continue;
      pulseRef.current.set(act.agent_id, now);
      const p = posRef.current.get(act.agent_id) || { x: targetX(a.stance), y: targetY(a.id) };
      let text = "";
      if (act.kind === "post") text = (act.content || "").slice(0, 72);
      else if (act.kind === "reply") text = "↳ " + (act.content || "").slice(0, 62);
      else if (act.kind === "reaction")
        text = (act.content || "").includes("disliked") ? "▼ disliked" : "▲ liked";
      if (!text) continue;
      bubblesRef.current.push({ id: act.agent_id, x: p.x, y: p.y, text, stance: a.stance, born: now, life: 3000 + Math.random() * 1200 });
      if (bubblesRef.current.length > 40) bubblesRef.current.shift();
    }
    if (pulseRef.current.size > 400) {
      const cutoff = now - 8000;
      for (const [k, v] of pulseRef.current) if (v < cutoff) pulseRef.current.delete(k);
    }
  }, [actions]);

  useEffect(() => {
    if (!event) return;
    wavesRef.current.push({ x: W / 2, y: H / 2, born: performance.now(), life: 1700 });
  }, [event]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    // crisp on HiDPI
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let raf;
    const xForZone = (stance) => targetX(stance);

    const draw = (now) => {
      const agents = agentsRef.current;
      const byId = byIdRef.current;
      const pos = posRef.current;

      // ---- paper background
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#f7f7f5";
      ctx.fillRect(0, 0, W, H);

      // ---- camp zones
      const zx0 = xForZone(-0.25);
      const zx1 = xForZone(0.25);
      ctx.fillStyle = "rgba(43,75,238,0.055)";
      ctx.fillRect(PAD_X / 2, 34, zx0 - PAD_X / 2, H - 34 - 34);
      ctx.fillStyle = "rgba(180,83,9,0.07)";
      ctx.fillRect(zx1, 34, W - PAD_X / 2 - zx1, H - 34 - 34);

      // faint grid
      ctx.strokeStyle = "rgba(22,21,15,0.06)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        const gx = (i / 8) * W;
        ctx.beginPath(); ctx.moveTo(gx, 34); ctx.lineTo(gx, H - 34); ctx.stroke();
      }
      for (let i = 1; i < 5; i++) {
        const gy = 34 + (i / 5) * (H - 68);
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }

      // camp dividers + center line
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = "rgba(22,21,15,0.28)";
      for (const zx of [zx0, zx1]) {
        ctx.beginPath(); ctx.moveTo(zx, 34); ctx.lineTo(zx, H - 34); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(22,21,15,0.14)";
      ctx.beginPath(); ctx.moveTo(W / 2, 34); ctx.lineTo(W / 2, H - 34); ctx.stroke();

      // zone labels
      ctx.font = "600 10px 'JetBrains Mono', ui-monospace, monospace";
      ctx.fillStyle = "rgba(43,75,238,0.75)";
      ctx.fillText("◀ OPPOSE", 14, 22);
      ctx.fillStyle = "rgba(111,111,102,0.9)";
      ctx.textAlign = "center";
      ctx.fillText("NEUTRAL", W / 2, 22);
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(180,83,9,0.85)";
      const sup = "SUPPORT ▶";
      ctx.fillText(sup, W - 14 - ctx.measureText(sup).width, 22);

      // live camp counts
      let nO = 0, nN = 0, nS = 0;
      for (const a of agents) {
        const c = campOf(a.stance);
        if (c === "oppose") nO++; else if (c === "support") nS++; else nN++;
      }
      ctx.fillStyle = MUTED;
      ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace";
      ctx.fillText(`${nO} oppose · ${nN} neutral · ${nS} support · ${edgesRef.current.length} ties`, 14, H - 12);

      if (!agents.length) {
        ctx.fillStyle = "#9a9a90";
        ctx.font = "12px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText("build the world to grow the network…", W / 2, H / 2);
        ctx.textAlign = "left";
        raf = requestAnimationFrame(draw);
        return;
      }

      // ---- ease positions toward live stance targets
      for (const a of agents) {
        let p = pos.get(a.id);
        if (!p) { p = { x: targetX(a.stance), y: targetY(a.id) }; pos.set(a.id, p); }
        const tx = targetX(a.stance);
        const ty = targetY(a.id);
        p.x += (tx - p.x) * 0.07;
        p.y += (ty - p.y) * 0.07;
      }

      const hovered = hoverRef.current ? byId.get(hoverRef.current) : null;
      const hoverNbrs = new Set();
      if (hovered) {
        hoverNbrs.add(hovered.id);
        for (const [u, v] of edgesRef.current) {
          if (u === hovered.id) hoverNbrs.add(v);
          else if (v === hovered.id) hoverNbrs.add(u);
        }
      }
      const dim = hovered ? 0.12 : 1;

      // ---- shockwaves (breaking news)
      wavesRef.current = wavesRef.current.filter((w) => now - w.born < w.life);
      for (const wv of wavesRef.current) {
        const k = (now - wv.born) / wv.life;
        ctx.beginPath();
        ctx.arc(wv.x, wv.y, 40 + k * 340, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(220,38,38,${0.55 * (1 - k)})`;
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.stroke();
      }
      if (event && running) {
        const k = (now / 800) % 1;
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, 30 + k * 220, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(220,38,38,${0.45 * (1 - k)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // ---- ties
      for (const [u, v] of edgesRef.current) {
        const a = byId.get(u), b = byId.get(v);
        const pa = pos.get(u), pb = pos.get(v);
        if (!a || !b || !pa || !pb) continue;
        const ca = campOf(a.stance), cb = campOf(b.stance);
        const pu = now - (pulseRef.current.get(u) || 0) < 2600;
        const pv = now - (pulseRef.current.get(v) || 0) < 2600;
        const hot = pu || pv;
        const inFocus = !hovered || (hoverNbrs.has(u) && hoverNbrs.has(v));
        if (hot && inFocus) {
          ctx.strokeStyle = "rgba(22,21,15,0.5)";
          ctx.lineWidth = 1.6;
        } else if (ca === cb && ca !== "neutral" && inFocus) {
          ctx.strokeStyle = ca === "oppose" ? "rgba(43,75,238,0.22)" : "rgba(180,83,9,0.25)";
          ctx.lineWidth = 1;
        } else {
          ctx.strokeStyle = `rgba(22,21,15,${inFocus ? 0.13 * dim + 0.0 + (inFocus && hovered ? 0.13 : 0.13) : 0.05})`;
          ctx.lineWidth = 1;
        }
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      // ---- citizens
      for (const a of agents) {
        const p = pos.get(a.id);
        if (!p) continue;
        const fl = Math.sin(now / 950 + phaseFor(a.id)) * 2.2;
        const x = p.x + fl;
        const y = p.y + Math.cos(now / 1100 + phaseFor(a.id)) * 2.2;
        a._rx = x; a._ry = y;
        const r = 4 + Math.min(a.influence || 0.4, 1) * 6;
        const faded = hovered && !hoverNbrs.has(a.id);
        ctx.globalAlpha = faded ? 0.18 : 1;

        // influencer halo
        if ((a.influence || 0) > 0.65) {
          ctx.beginPath();
          ctx.arc(x, y, r + 4, 0, Math.PI * 2);
          ctx.strokeStyle = stanceColor(a.stance, 0.55);
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
        // fresh-activity ring
        const age = now - (pulseRef.current.get(a.id) || 0);
        if (age < 2600) {
          const k = age / 2600;
          ctx.beginPath();
          ctx.arc(x, y, r + 3 + k * 9, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(22,21,15,${0.55 * (1 - k)})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        // body
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = stanceColor(a.stance, 1);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        // selected / hovered ring + label
        if (a.id === selectedRef.current || a.id === hoverRef.current) {
          ctx.beginPath();
          ctx.arc(x, y, r + 6.5, 0, Math.PI * 2);
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // name labels: hovered + selected + top influencers (decluttered)
      ctx.font = "600 11px Inter, ui-sans-serif, system-ui, sans-serif";
      const labelled = new Set();
      const label = (a) => {
        if (!a || labelled.has(a.id)) return;
        labelled.add(a.id);
        const x = a._rx, y = a._ry;
        const wpx = ctx.measureText(a.name).width + 16;
        roundRectPath(ctx, x - wpx / 2, y - 30, wpx, 20, 6);
        ctx.fillStyle = "rgba(22,21,15,0.92)";
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.fillText(a.name, x, y - 16);
        ctx.textAlign = "left";
      };
      if (hovered) { label(hovered); for (const id of hoverNbrs) label(byId.get(id)); }
      if (selectedRef.current) label(byId.get(selectedRef.current));
      if (!hovered) {
        const hubs = [...agents].sort((x, y) => (y.influence || 0) - (x.influence || 0)).slice(0, 4);
        for (const h of hubs) if ((h.influence || 0) > 0.72) label(h);
      }

      // ---- speech bubbles (light cards)
      bubblesRef.current = bubblesRef.current.filter((b) => now - b.born < b.life);
      for (const b of bubblesRef.current) {
        const k = (now - b.born) / b.life;
        const alpha = k < 0.1 ? k / 0.1 : 1 - Math.max(0, (k - 0.6) / 0.4);
        const p = pos.get(b.id);
        if (!p) continue;
        const y = p.y - 34 - k * 22;
        ctx.globalAlpha = Math.max(alpha, 0) * (hovered && !hoverNbrs.has(b.id) ? 0.25 : 1);
        ctx.font = "12px Inter, ui-sans-serif, sans-serif";
        const wpx = Math.min(ctx.measureText(b.text).width + 18, 300);
        roundRectPath(ctx, p.x - wpx / 2, y - 15, wpx, 22, 7);
        ctx.fillStyle = "rgba(255,255,255,0.97)";
        ctx.fill();
        ctx.strokeStyle = stanceColor(b.stance, 0.9);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.save();
        ctx.beginPath();
        ctx.rect(p.x - wpx / 2 + 1, y - 14, wpx - 2, 20);
        ctx.clip();
        ctx.fillText(b.text, p.x - wpx / 2 + 9, y + 1);
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [event, running]);

  function pick(e, { hover = false } = {}) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const py = ((e.clientY - rect.top) / rect.height) * H;
    let best = null, bestD = 1e9;
    for (const a of agentsRef.current) {
      const x = a._rx ?? targetX(a.stance);
      const y = a._ry ?? targetY(a.id);
      const d = Math.hypot(x - px, y - py);
      const r = 4 + Math.min(a.influence || 0.4, 1) * 6 + 8;
      if (d < r && d < bestD) { bestD = d; best = a; }
    }
    if (hover) {
      const id = best ? best.id : null;
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        e.currentTarget.style.cursor = id ? "pointer" : "crosshair";
      }
      return;
    }
    if (best && onSelect) onSelect(best);
  }

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      onClick={(e) => pick(e)}
      onMouseMove={(e) => pick(e, { hover: true })}
      onMouseLeave={() => { hoverRef.current = null; }}
      className="live-canvas"
    />
  );
}
