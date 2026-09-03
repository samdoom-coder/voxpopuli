const ORDER = ["support", "neutral", "oppose"];
const CAMP_COLOR = { support: "#b45309", neutral: "#9a9a90", oppose: "#2b4bee" };

function deriveFromAgents(agents) {
  const camps = { support: [], neutral: [], oppose: [] };
  for (const a of agents || []) {
    const key = a.stance > 0.25 ? "support" : a.stance < -0.25 ? "oppose" : "neutral";
    camps[key].push({ id: a.id, name: a.name, stance: a.stance, influence: a.influence });
  }
  const out = {};
  for (const k of ORDER) {
    const members = camps[k].sort((x, y) => (y.influence || 0) - (x.influence || 0)).slice(0, 3);
    out[k] = { count: camps[k].length, members };
  }
  return out;
}

export default function Influencers({ agents, analysis, onPick }) {
  const camps = analysis?.camps || deriveFromAgents(agents);
  const total = ORDER.reduce((n, k) => n + (camps[k]?.count || 0), 0);
  if (!total) return <div className="empty-state">No citizens yet.</div>;

  return (
    <div className="inf-grid">
      {ORDER.map((k) => (
        <div key={k} className="inf-col">
          <div className="inf-head" style={{ color: CAMP_COLOR[k] }}>
            <span className="inf-count">{camps[k]?.count ?? 0}</span>
            <span className="inf-name">{k}</span>
          </div>
          <ul className="inf-list">
            {(camps[k]?.members || []).slice(0, 3).map((m) => (
              <li key={m.id}>
                <button className="inf-who" onClick={() => onPick && onPick(m.id)} title="Open citizen profile">
                  {m.name}
                </button>
                <div className="inf-bar">
                  <i style={{ width: `${Math.round((m.influence || 0) * 100)}%`, background: CAMP_COLOR[k] }} />
                </div>
                <span className="inf-meta">
                  {(m.stance >= 0 ? "+" : "") + Number(m.stance).toFixed(2)} · ▮ {Number(m.influence || 0).toFixed(2)}
                </span>
              </li>
            ))}
            {(!camps[k]?.members || camps[k].members.length === 0) && (
              <li className="inf-empty">—</li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}
