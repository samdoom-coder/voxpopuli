export default function FeedPanel({ actions }) {
  const list = Array.isArray(actions) ? actions.slice(0, 60) : [];
  if (list.length === 0) {
    return <p className="muted">The feed is quiet… actions from citizens will appear here.</p>;
  }
  const icon = (k) =>
    k === "post" ? "✎" : k === "reply" ? "↳" : k === "reaction" ? "·" : "○";

  return (
    <ul className="feed">
      {list.map((a, i) => (
        <li key={a.id || i} className={`feed-item kind-${a.kind}`}>
          <span className="feed-round">r{a.round}</span>
          <span className="feed-icon">{icon(a.kind)}</span>
          <div className="feed-body">
            <span className="feed-name">
              {a.agent_name}
              <span className="feed-stance" style={{ color: a.sentiment >= 0 ? "#7fb7ff" : "#ffb042" }}>
                {a.sentiment >= 0 ? "+" : ""}{a.sentiment?.toFixed(2)}
              </span>
            </span>
            <span className="feed-text">{a.content || a.reason || ""}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
