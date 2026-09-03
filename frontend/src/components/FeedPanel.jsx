import { useState } from "react";

const hueClass = (name) => {
  let h = 0;
  for (const c of String(name || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ["", "hue-1", "hue-2", "hue-3", "hue-4"][h % 5];
};

const KINDS = [
  ["all", "All"],
  ["post", "Posts"],
  ["reply", "Replies"],
  ["reaction", "Reactions"],
];
const CAMPS = [
  ["all", "All camps"],
  ["oppose", "Oppose"],
  ["neutral", "Neutral"],
  ["support", "Support"],
];

function campOf(stance) {
  const s = Number(stance) || 0;
  return s > 0.25 ? "support" : s < -0.25 ? "oppose" : "neutral";
}

export default function FeedPanel({ actions }) {
  const [kind, setKind] = useState("all");
  const [camp, setCamp] = useState("all");

  const all = Array.isArray(actions) ? actions : [];
  const list = all
    .filter((a) => (kind === "all" || a.kind === kind) && (camp === "all" || campOf(a.stance) === camp))
    .slice(0, 60);

  if (all.length === 0) {
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

  const chip = (value, label, current, set) => (
    <button
      key={value}
      className={`chip-btn${current === value ? " on" : ""}`}
      onClick={() => set(value)}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="chips">
        {KINDS.map(([v, l]) => chip(v, l, kind, setKind))}
        <span className="chips-sep" />
        {CAMPS.map(([v, l]) => chip(v, l, camp, setCamp))}
      </div>
      {list.length === 0 ? (
        <div className="empty-state">Nothing matching these filters yet.</div>
      ) : (
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
      )}
    </div>
  );
}
