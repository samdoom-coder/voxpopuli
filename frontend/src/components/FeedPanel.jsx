const hueClass = (name) => {
  let h = 0;
  for (const c of String(name || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ["", "hue-1", "hue-2", "hue-3", "hue-4"][h % 5];
};

export default function FeedPanel({ actions }) {
  const list = Array.isArray(actions) ? actions.slice(0, 60) : [];
  if (list.length === 0) {
    return (
      <div className="empty-state">
        The feed is quiet… posts, replies and reactions from citizens will appear here.
      </div>
    );
  }
  const icon = (a) =>
    a.kind === "post" ? "✎"
    : a.kind === "reply" ? "↳"
    : (a.content || "").includes("disliked") ? "▼" : "▲";

  return (
    <ul className="feed">
      {list.map((a, i) => (
        <li key={a.id || i} className={`feed-item kind-${a.kind}`}>
          <span className={`avatar ${hueClass(a.agent_name)}`}>
            {(a.agent_name || "?").trim().charAt(0)}
          </span>
          <span className="feed-round">r{a.round}</span>
          <span className="feed-icon">{icon(a)}</span>
          <div className="feed-body">
            <span className="feed-name">
              {a.agent_name}
              <span className={`feed-stance${a.sentiment < 0 ? " neg" : ""}`}>
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
