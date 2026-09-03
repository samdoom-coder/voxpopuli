// Overlaid A/B sentiment + per-run camp strips.
// Run colors are neutral (ink vs violet) so camp colors keep their meaning.
const W = 720;
const H = 292;
const PAD = 34;
const TOP = 38;
const MID = 168;
const A_TOP = 198;
const A_BOT = 220;
const B_TOP = 230;
const B_BOT = 252;

const C_OPPOSE = "#2b4bee";
const C_SUPPORT = "#b45309";
const C_A = "#16150f";
const C_B = "#7c3aed";

function strip(series, y0, y1, keyPrefix) {
  if (!series.some((s) => s.camps)) return null;
  const n = series.length;
  const band = (W - PAD * 2) / Math.max(n, 1);
  const h = y1 - y0;
  return (
    <g>
      {series.map((s, i) => {
        if (!s.camps) return null;
        const total = s.camps.support + s.camps.neutral + s.camps.oppose || 1;
        const bx = PAD + (i / Math.max(n - 1, 1)) * (W - PAD * 2) - band / 2 + 1;
        const bw = Math.max(band - 2, 2);
        const wO = (s.camps.oppose / total) * bw;
        const wN = (s.camps.neutral / total) * bw;
        return (
          <g key={`${keyPrefix}-${i}`}>
            <rect x={bx} y={y0} width={wO} height={h} fill={C_OPPOSE} opacity="0.85" />
            <rect x={bx + wO} y={y0} width={wN} height={h} fill="#c9c9c2" />
            <rect x={bx + wO + wN} y={y0} width={Math.max(bw - wO - wN, 0)} height={h} fill={C_SUPPORT} opacity="0.85" />
          </g>
        );
      })}
    </g>
  );
}

function line(series, maxR, color) {
  const x = (r) => PAD + ((r - 1) / Math.max(maxR - 1, 1)) * (W - PAD * 2);
  const y = (v) => MID - ((Math.max(-1, Math.min(1, v)) + 1) / 2) * (MID - TOP);
  const pts = series.map((s) => ({ px: x(s.round), py: y(s.sentiment) }));
  return (
    <g>
      <polyline points={pts.map((p) => `${p.px},${p.py}`).join(" ")} fill="none"
                stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.px} cy={p.py} r={3} fill={color} stroke="#fff" strokeWidth="1.2" />
      ))}
    </g>
  );
}

export default function CompareChart({ seriesA, seriesB, nameA, nameB }) {
  const okA = seriesA && seriesA.length >= 2;
  const okB = seriesB && seriesB.length >= 2;
  if (!okA && !okB) {
    return <div className="chart-empty"><p>run both simulations to compare them…</p></div>;
  }
  const maxR = Math.max(
    ...(okA ? seriesA.map((s) => s.round) : [1]),
    ...(okB ? seriesB.map((s) => s.round) : [1]),
  );
  const y = (v) => MID - ((Math.max(-1, Math.min(1, v)) + 1) / 2) * (MID - TOP);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sent-chart">
      <g fontFamily="JetBrains Mono, monospace" fontSize="11">
        <line x1={PAD} y1={16} x2={PAD + 20} y2={16} stroke={C_A} strokeWidth="2.5" />
        <text x={PAD + 26} y={19} fill="#16150f">A · {nameA}</text>
        <line x1={PAD + 220} y1={16} x2={PAD + 240} y2={16} stroke={C_B} strokeWidth="2.5" />
        <text x={PAD + 246} y={19} fill="#16150f">B · {nameB}</text>
      </g>

      <g fontFamily="JetBrains Mono, monospace" fontSize="9" fill="#9a9a90">
        <text x={6} y={TOP + 3}>+1</text>
        <text x={10} y={y(0) + 3}>0</text>
        <text x={6} y={MID + 3}>−1</text>
      </g>
      <line x1={PAD} y1={y(0)} x2={W - PAD} y2={y(0)} stroke="#c9c9c2" strokeDasharray="4 4" />
      <line x1={PAD} y1={TOP} x2={W - PAD} y2={TOP} stroke="#e4e4e0" />
      <line x1={PAD} y1={MID} x2={W - PAD} y2={MID} stroke="#e4e4e0" />

      {okB && line(seriesB, maxR, C_B)}
      {okA && line(seriesA, maxR, C_A)}

      <g fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#9a9a90">
        <text x={PAD} y={A_TOP - 5}>A CAMPS</text>
        <text x={PAD} y={B_TOP - 5}>B CAMPS</text>
      </g>
      {okA && strip(seriesA, A_TOP, A_BOT, "a")}
      {okB && strip(seriesB, B_TOP, B_BOT, "b")}

      <text x={W / 2} y={H - 6} textAnchor="middle" fill="#6f6f66" fontSize="11" fontFamily="JetBrains Mono, monospace">
        sentiment by round · ■ oppose ■ neutral ■ support
      </text>
    </svg>
  );
}
