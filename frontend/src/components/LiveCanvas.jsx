import { useEffect, useRef } from "react";

const W = 1000;
const H = 600;

function stanceColor(stance) {
  const t = Math.max(0, Math.min(1, (stance + 1) / 2)); // 0 blue .. 1 amber
  const blue = [96, 158, 255];
  const gray = [151, 162, 180];
  const amber = [255, 176, 66];
  let c;
  if (t < 0.5) {
    const k = t * 2;
    c = blue.map((b, i) => b + (gray[i] - b) * k);
  } else {
    const k = (t - 0.5) * 2;
    c = gray.map((b, i) => b + (amber[i] - b) * k);
  }
  return `rgb(${c.map((v) => Math.round(v)).join(",")})`;
}

function moodGlow(stance) {
  const m = Math.max(0, Math.min(1, (stance + 1) / 2));
  return m; // drives shadow glow intensity
}

function mapPt(p) {
  return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H };
}

export default function LiveCanvas({ agents, actions, event, running, onSelect }) {
  const canvasRef = useRef(null);
  const agentsRef = useRef(agents);
  const bubblesRef = useRef([]);
  const wavesRef = useRef([]);
  const agentsRefOut = useRef(new Map()); // id -> agent for click

  useEffect(() => {
    agentsRef.current = agents;
    const map = new Map();
    agents.forEach((a) => map.set(a.id, a));
    agentsRefOut.current = map;
  }, [agents]);

  useEffect(() => {
    const list = Array.isArray(actions) ? actions : [];
    if (!list.length) return;
    const byId = agentsRefOut.current;
    for (const act of list) {
      const a = byId.get(act.agent_id);
      if (!a) continue;
      const pt = mapPt(a);
      let text = "";
      if (act.kind === "post") text = (act.content || "").slice(0, 70);
      else if (act.kind === "reply") text = "↳ " + (act.content || "").slice(0, 60);
      else if (act.kind === "reaction")
        text = act.content === "disliked this" ? "👎 disliked" : "👍 liked";
      else text = "";
      bubblesRef.current.push({
        x: pt.x,
        y: pt.y,
        text,
        stance: a.stance,
        born: performance.now(),
        life: 3200 + Math.random() * 1200,
      });
      if (bubblesRef.current.length > 60) bubblesRef.current.shift();
    }
  }, [actions]);

  useEffect(() => {
    if (!event) return;
    wavesRef.current.push({ x: W / 2, y: H / 2, born: performance.now(), life: 1600 });
  }, [event]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let raf;
    const draw = (now) => {
      ctx.clearRect(0, 0, W, H);
      // backdrop
      const bg = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, 620);
      bg.addColorStop(0, "#0b101f");
      bg.addColorStop(1, "#060912");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // faint grid
      ctx.strokeStyle = "rgba(139,152,255,0.055)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 8; i++) {
        const gx = (i / 8) * W;
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
        const gy = (i / 8) * H;
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }

      // axis labels
      ctx.fillStyle = "rgba(147,160,198,0.45)";
      ctx.font = "10px 'JetBrains Mono', ui-monospace, monospace";
      ctx.fillText("◀ OPPOSE", 18, H - 16);
      ctx.fillText("SUPPORT ▶", W - 100, H - 16);

      // shockwave(s)
      wavesRef.current = wavesRef.current.filter((w) => now - w.born < w.life);
      for (const w of wavesRef.current) {
        const k = (now - w.born) / w.life;
        const r = 40 + k * 340;
        ctx.beginPath();
        ctx.arc(w.x, w.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,120,60,${0.6 * (1 - k)})`;
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.stroke();
      }
      if (event && running) {
        const k = (now / 700) % 1;
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, 30 + k * 200, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,80,80,${0.5 * (1 - k)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // agents
      const agents = agentsRef.current;
      for (const a of agents) {
        const pt = mapPt(a);
        const wob = Math.sin(now / 900 + a.id.length) * 2.5;
        const x = pt.x + wob;
        const y = pt.y + wob;
        const r = 3 + Math.min(a.influence || 0.4, 1) * 5;
        const col = stanceColor(a.stance);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.95;
        ctx.fill();
        ctx.shadowColor = col;
        ctx.shadowBlur = 8 * moodGlow(a.stance);
        ctx.beginPath();
        ctx.arc(x, y, r + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }

      // bubbles
      bubblesRef.current = bubblesRef.current.filter((b) => now - b.born < b.life);
      for (const b of bubblesRef.current) {
        const k = (now - b.born) / b.life;
        const alpha = k < 0.12 ? k / 0.12 : 1 - Math.max(0, (k - 0.55) / 0.45);
        const y = b.y - 10 - k * 26;
        ctx.globalAlpha = Math.max(alpha, 0);
        const col = stanceColor(b.stance);
        ctx.font = "12px Inter, ui-sans-serif, sans-serif";
        const w = ctx.measureText(b.text).width + 16;
        ctx.fillStyle = "rgba(8,12,26,0.9)";
        ctx.beginPath();
        ctx.roundRect(b.x - w / 2, y - 16, w, 22, 7);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "#e8eefc";
        ctx.fillText(b.text, b.x - w / 2 + 8, y + 1);
        ctx.globalAlpha = 1;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  function handleClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const py = ((e.clientY - rect.top) / rect.height) * H;
    let best = null;
    let bestD = 1e9;
    for (const a of agentsRef.current) {
      const pt = mapPt(a);
      const d = Math.hypot(pt.x - px, pt.y - py);
      if (d < 22 && d < bestD) {
        bestD = d;
        best = a;
      }
    }
    if (best && onSelect) onSelect(best);
  }

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      onClick={handleClick}
      className="live-canvas"
    />
  );
}
