const W = 480;
const H = 252;
const PAD = 28;
const TOP = 36;      // top of sentiment plot
const MID = 142;     // bottom of sentiment plot
const STRIP_TOP = 172;
const STRIP_BOT = 208;

// Canonical color language (matches the network graph + legend):
// blue = oppose, gray = neutral, amber = support, violet = spread (neutral metric)
const C_OPPOSE = "#2b4bee";
const C_SUPPORT = "#b45309";
const C_SPREAD = "#7c3aed";

export default function SentimentChart({ series }) {
  if (!series || series.length < 2) {
    return (
      <div className="chart-empty">
        <p>sentiment will appear as rounds complete…</p>
      </div>
    );
  }
  const maxR = Math.max(...series.map((s) => s.round));
  const x = (r) => PAD + ((r - 1) / Math.max(maxR - 1, 1)) * (W - PAD * 2);
  const y = (v) => MID - ((Math.max(-1, Math.min(1, v)) + 1) / 2) * (MID - TOP);
  // spread (stance_std, 0..1) shares the box: 1 at top, 0 at bottom
  const ys = (v) => MID - Math.max(0, Math.min(1, v)) * (MID - TOP);

  const pts = series.map((s) => ({ px: x(s.round), py: y(s.sentiment) }));
  const spts = series.map((s) => ({ px: x(s.round), py: ys(s.stance_std || 0) }));
  const line = pts.map((p) => `${p.px},${p.py}`).join(" ");
  const sline = spts.map((p) => `${p.px},${p.py}`).join(" ");
  const area = `M ${pts[0].px} ${pts[0].py} ${pts.slice(1).map((p) => `L ${p.px} ${p.py}`).join(" ")} L ${pts[pts.length - 1].px} ${y(0)} L ${pts[0].px} ${y(0)} Z`;
  const last = series[series.length - 1];

  const withCamps = series.filter((s) => s.camps && s.camps.support + s.camps.neutral + s.camps.oppose > 0);
  const band = (W - PAD * 2) / Math.max(series.length, 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sent-chart">
      <defs>
        <linearGradient id="vp-area" x1="0" y1={TOP} x2="0" y2={y(0)} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="rgba(22,21,15,0.07)" />
          <stop offset="1" stopColor="rgba(22,21,15,0)" />
        </linearGradient>
      </defs>

      {/* legend */}
      <g fontFamily="JetBrains Mono, monospace" fontSize="10">
        <line x1={PAD} y1={14} x2={PAD + 18} y2={14} stroke="#16150f" strokeWidth="2" />
        <text x={PAD + 23} y={17} fill="#6f6f66">sentiment</text>
        <line x1={PAD + 108} y1={14} x2={PAD + 126} y2={14} stroke={C_SPREAD} strokeWidth="1.6" strokeDasharray="4 3" />
        <text x={PAD + 131} y={17} fill="#6f6f66">spread</text>
      </g>

      {/* labeled sentiment axis */}
      <g fontFamily="JetBrains Mono, monospace" fontSize="9" fill="#9a9a90">
        <text x={4} y={TOP + 3}>+1</text>
        <text x={8} y={y(0) + 3}>0</text>
        <text x={4} y={MID + 3}>−1</text>
        <text x={W - 8} y={TOP + 3} textAnchor="end" fill={C_SPREAD} opacity="0.8">1</text>
        <text x={W - 8} y={MID + 3} textAnchor="end" fill={C_SPREAD} opacity="0.8">0</text>
      </g>
      <line x1={PAD} y1={TOP} x2={W - PAD} y2={TOP} stroke="#e4e4e0" />
      <line x1={PAD} y1={y(0)} x2={W - PAD} y2={y(0)} stroke="#c9c9c2" strokeDasharray="4 4" />
      <line x1={PAD} y1={MID} x2={W - PAD} y2={MID} stroke="#e4e4e0" />

      <path d={area} fill="url(#vp-area)" />
      <polyline points={sline} fill="none" stroke={C_SPREAD} strokeWidth="1.6"
                strokeDasharray="4 3" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      <polyline points={line} fill="none" stroke="#16150f" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.px} cy={p.py} r={3.5}
                fill={series[i].sentiment >= 0 ? C_SUPPORT : C_OPPOSE}
                stroke="#fff" strokeWidth="1.5" />
      ))}
      <circle cx={pts[pts.length - 1].px} cy={pts[pts.length - 1].py} r="6.5"
              fill="none" stroke="#16150f" strokeWidth="1.5" opacity="0.85" />

      {/* camp-share strip */}
      <text x={PAD} y={STRIP_TOP - 8} fill="#9a9a90" fontSize="10" fontFamily="JetBrains Mono, monospace">
        CAMP SHARE
      </text>
      {withCamps.length >= 2 ? (
        <g>
          {series.map((s, i) => {
            if (!s.camps) return null;
            const total = s.camps.support + s.camps.neutral + s.camps.oppose || 1;
            const bx = PAD + (i / Math.max(series.length - 1, 1)) * (W - PAD * 2) - band / 2 + 1;
            const bw = Math.max(band - 2, 2);
            const h = STRIP_BOT - STRIP_TOP;
            const wO = (s.camps.oppose / total) * bw;
            const wN = (s.camps.neutral / total) * bw;
            return (
              <g key={i}>
                <rect x={bx} y={STRIP_TOP} width={wO} height={h} fill={C_OPPOSE} opacity="0.85" />
                <rect x={bx + wO} y={STRIP_TOP} width={wN} height={h} fill="#c9c9c2" />
                <rect x={bx + wO + wN} y={STRIP_TOP} width={Math.max(bw - wO - wN, 0)} height={h} fill={C_SUPPORT} opacity="0.85" />
              </g>
            );
          })}
          <text x={PAD} y={STRIP_BOT + 14} fill={C_OPPOSE} fontSize="10" fontFamily="JetBrains Mono, monospace">■ oppose</text>
          <text x={PAD + 72} y={STRIP_BOT + 14} fill="#9a9a90" fontSize="10" fontFamily="JetBrains Mono, monospace">■ neutral</text>
          <text x={PAD + 150} y={STRIP_BOT + 14} fill={C_SUPPORT} fontSize="10" fontFamily="JetBrains Mono, monospace">■ support</text>
        </g>
      ) : (
        <text x={W / 2} y={STRIP_TOP + 24} textAnchor="middle" fill="#9a9a90" fontSize="11" fontFamily="JetBrains Mono, monospace">
          camp history records from this run onward
        </text>
      )}

      <text x={W / 2} y={H - 4} textAnchor="middle" fill="#6f6f66"
            fontSize="11" fontFamily="JetBrains Mono, monospace">
        round {last.round} / {maxR} · sentiment {(last.sentiment >= 0 ? "+" : "") + Number(last.sentiment).toFixed(2)} · spread {last.stance_std?.toFixed(2)}
      </text>
    </svg>
  );
}
