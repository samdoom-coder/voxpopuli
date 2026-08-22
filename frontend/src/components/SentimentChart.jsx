const W = 480;
const H = 180;
const PAD = 28;

export default function SentimentChart({ series }) {
  if (!series || series.length < 2) {
    return (
      <div className="chart-empty">
        <p>sentiment will appear as rounds complete…</p>
      </div>
    );
  }
  const xs = series.map((s) => s.round);
  const maxR = Math.max(...xs);
  const x = (r) => PAD + ((r - 1) / Math.max(maxR - 1, 1)) * (W - PAD * 2);
  const y = (v) => H / 2 - (Math.max(-1, Math.min(1, v)) * (H / 2 - PAD));
  const pts = series.map((s) => ({ px: x(s.round), py: y(s.sentiment) }));
  const line = pts.map((p) => `${p.px},${p.py}`).join(" ");
  const area = `M ${pts[0].px} ${pts[0].py} ${pts.slice(1).map((p) => `L ${p.px} ${p.py}`).join(" ")} L ${pts[pts.length - 1].px} ${H / 2} L ${pts[0].px} ${H / 2} Z`;
  const last = series[series.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sent-chart">
      <defs>
        <linearGradient id="vp-area" x1="0" y1={PAD} x2="0" y2={H / 2} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="rgba(43,75,238,0.14)" />
          <stop offset="1" stopColor="rgba(43,75,238,0)" />
        </linearGradient>
      </defs>
      <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="#c9c9c2" strokeDasharray="4 4" />
      <text x={PAD} y={PAD - 8} fill="#9a9a90" fontSize="10" fontFamily="JetBrains Mono, monospace">+1 POSITIVE</text>
      <text x={PAD} y={H - PAD + 16} fill="#9a9a90" fontSize="10" fontFamily="JetBrains Mono, monospace">−1 NEGATIVE</text>
      <path d={area} fill="url(#vp-area)" />
      <polyline
        points={line}
        fill="none"
        stroke="#16150f"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {pts.map((p, i) => (
        <circle key={i} cx={p.px} cy={p.py} r={3.5}
                fill={series[i].sentiment >= 0 ? "#2b4bee" : "#b45309"}
                stroke="#fff" strokeWidth="1.5" />
      ))}
      <circle cx={pts[pts.length - 1].px} cy={pts[pts.length - 1].py} r="6.5"
              fill="none" stroke="#16150f" strokeWidth="1.5" opacity="0.85" />
      <text x={W / 2} y={H - 4} textAnchor="middle" fill="#6f6f66"
            fontSize="11" fontFamily="JetBrains Mono, monospace">
        round {last.round} / {maxR} · spread {last.stance_std?.toFixed(2)}
      </text>
    </svg>
  );
}
