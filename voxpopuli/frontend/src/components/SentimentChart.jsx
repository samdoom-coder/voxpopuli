const W = 480;
const H = 180;
const PAD = 28;

export default function SentimentChart({ series }) {
  if (!series || series.length < 2) {
    return (
      <div className="chart-empty">
        <p>Sentiment will appear as rounds complete…</p>
      </div>
    );
  }
  const xs = series.map((s) => s.round);
  const vals = series.map((s) => s.sentiment);
  const maxR = Math.max(...xs);
  const x = (r) => PAD + ((r - 1) / Math.max(maxR - 1, 1)) * (W - PAD * 2);
  const y = (v) => H / 2 - (Math.max(-1, Math.min(1, v)) * (H / 2 - PAD));
  const line = series.map((s) => `${x(s.round)},${y(s.sentiment)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sent-chart">
      <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="rgba(120,150,200,0.25)" strokeDasharray="4 4" />
      <text x={PAD} y={PAD - 6} fill="rgba(150,180,220,0.5)" fontSize="10">+1 positive</text>
      <text x={PAD} y={H - PAD + 14} fill="rgba(150,180,220,0.5)" fontSize="10">−1 negative</text>
      {series.map((s, i) => {
        if (i === 0) return null;
        const prev = series[i - 1];
        return (
          <line
            key={i}
            x1={x(prev.round)}
            y1={y(prev.sentiment)}
            x2={x(s.round)}
            y2={y(s.sentiment)}
            stroke={s.sentiment >= 0 ? "#4a90ff" : "#ffb042"}
            strokeWidth={2}
            opacity={0.85}
          />
        );
      })}
      <polyline points={line} fill="none" stroke="#ffffff" strokeWidth={1.5} opacity={0.25} />
      {series.map((s) => (
        <circle key={s.round} cx={x(s.round)} cy={y(s.sentiment)} r={3.5} fill="#fff" />
      ))}
      <text x={W / 2} y={H - 4} textAnchor="middle" fill="rgba(150,180,220,0.6)" fontSize="11">
        round {series[series.length - 1].round} / {maxR} · spread {series[series.length - 1].stance_std?.toFixed(2)}
      </text>
    </svg>
  );
}
