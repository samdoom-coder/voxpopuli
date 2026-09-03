import { useCallback, useEffect, useRef, useState } from "react";
import { api, wsUrl } from "../api.js";
import LiveCanvas from "../components/LiveCanvas.jsx";
import FeedPanel from "../components/FeedPanel.jsx";
import SentimentChart from "../components/SentimentChart.jsx";
import { renderMarkdown } from "../utils.js";

const STATUS_LABEL = {
  created: "created",
  ready: "ready",
  running: "simulating…",
  stopped: "stopped",
  completed: "completed",
  failed: "failed",
};

export default function World({ sid, pid, name, onExit }) {
  const [sim, setSim] = useState(null);
  const [agents, setAgents] = useState([]);
  const [feed, setFeed] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [events, setEvents] = useState([]);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [activeEvent, setActiveEvent] = useState(null);
  const [evtText, setEvtText] = useState("");
  const [evtImpact, setEvtImpact] = useState(0.6);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState("heuristic");
  const wsRef = useRef(null);
  const feedIdRef = useRef(0);
  const simRef = useRef(null);

  const applySim = useCallback((s) => {
    simRef.current = s;
    setSim(s);
  }, []);

  const fetchReport = useCallback(async () => {
    try {
      const r = await api.getReport(sid);
      setReport(r.data);
    } catch {
      /* not ready */
    }
  }, [sid]);

  // bootstrap
  useEffect(() => {
    (async () => {
      const [s, a, snaps, evs, msg] = await Promise.all([
        api.getSimulation(sid),
        api.getAgents(sid),
        api.getSnapshots(sid),
        api.getEvents(sid),
        api.getMessages(sid, 120),
      ]);
      applySim(s.data);
      setMode(s.data.world?.mode || s.data.config?.mode || "heuristic");
      setAgents(a.data);
      setSnapshots(snaps.data);
      setEvents(evs.data);
      const items = msg.data.map((m) => ({ ...m, key: feedIdRef.current++ }));
      setFeed(items);
      if (s.data.status === "completed") fetchReport();
    })();
  }, [sid, applySim, fetchReport]);

  // websocket
  useEffect(() => {
    const ws = new WebSocket(wsUrl(sid));
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "round") {
        setAgents(msg.agents || []);
        setSnapshots((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.round === msg.round) return prev;
          return [...prev, { round: msg.round, sentiment: msg.sentiment, stance_std: msg.stance_std, message_count: msg.message_count }];
        });
        setActiveEvent(msg.event);
        setSim((prev) => ({ ...(prev || {}), current_round: msg.round }));
      } else if (msg.type === "actions") {
        const items = (msg.actions || []).map((a) => ({ ...a, key: feedIdRef.current++ }));
        setFeed((prev) => [...items.reverse(), ...prev].slice(0, 200));
      } else if (msg.type === "status") {
        setSim((prev) => ({ ...(prev || {}), status: msg.status, error: msg.error }));
        if (msg.status === "completed") fetchReport();
      } else if (msg.type === "report_ready") {
        fetchReport();
      }
    };
    ws.onclose = () => {
      // light polling fallback
    };
    return () => ws.close();
  }, [sid, fetchReport]);

  // poll status when running (WS fallback)
  useEffect(() => {
    if (!sim || sim.status !== "running") return;
    const t = setInterval(async () => {
      try {
        const s = await api.getSimulation(sid);
        applySim(s.data);
        if (s.data.status !== "running") {
          clearInterval(t);
          if (s.data.status === "completed") fetchReport();
        }
      } catch {}
    }, 2000);
    return () => clearInterval(t);
  }, [sim, sid, applySim, fetchReport]);

  const run = async () => {
    setError("");
    try {
      await api.runSimulation(sid);
      setSim((p) => ({ ...p, status: "running" }));
    } catch (e) {
      setError(e.message);
    }
  };
  const stop = async () => {
    try {
      await api.stopSimulation(sid);
    } catch (e) {
      setError(e.message);
    }
  };
  const inject = async () => {
    if (!evtText.trim()) return;
    setError("");
    try {
      const r = await api.injectEvent(sid, { content: evtText.trim(), impact: evtImpact });
      setEvents((prev) => [...prev, { round: r.data.round, content: evtText.trim(), impact: evtImpact }]);
      setEvtText("");
    } catch (e) {
      setError(e.message);
    }
  };
  const regen = async () => {
    setReportLoading(true);
    setError("");
    try {
      const r = await api.regenReport(sid);
      setReport({ content: r.data.content });
    } catch (e) {
      setError(e.message);
    } finally {
      setReportLoading(false);
    }
  };
  const selectAgent = async (a) => {
    setSelected(a);
    try {
      const m = await api.getMessages(sid, 500);
      a.posts = m.data.filter((x) => x.agent_id === a.id).slice(0, 12);
    } catch {}
    setSelected({ ...a });
  };

  const status = sim?.status || "created";
  const running = status === "running";
  const done = status === "completed" || status === "stopped" || status === "failed";
  const camps = useCamps(agents);

  return (
    <div className="world">
      <header className="w-topbar">
        <div>
          <span className="w-title">{name}</span>
          <span className={`pill pill-${status}`}>{STATUS_LABEL[status] || status}</span>
          <span className="pill">{mode === "llm" ? "LLM engine" : "heuristic engine"}</span>
          <span className="pill dim">round {sim?.current_round || 0}/{sim?.total_rounds || sim?.config?.rounds || "–"}</span>
          <span className="pill dim">{agents.length} citizens</span>
        </div>
        <div className="w-actions">
          {!running && !done && (
            <button className="primary" onClick={run}>▶ Run simulation</button>
          )}
          {running && (
            <button className="ghost" onClick={stop}>■ Stop</button>
          )}
          <button className="ghost" onClick={onExit}>← back</button>
        </div>
      </header>

      {error && <div className="error bar">{error}</div>}

      <div className="world-grid">
        <section className="card canvas-card">
          <div className="card-head">
            <h2><span className="sq" /> Digital world</h2>
            {activeEvent && running && (
              <span className="breaking">BREAKING · {activeEvent.content}</span>
            )}
          </div>
          <div className="canvas-frame">
            <LiveCanvas
              agents={agents}
              actions={feed.slice(0, 40)}
              event={activeEvent}
              running={running}
              selectedId={selected?.id}
              onSelect={selectAgent}
            />
            <span className="canvas-tag">LIVE NETWORK · POSITION = STANCE · LINES = SOCIAL TIES</span>
          </div>
          <div className="legend">
            <span className="l-item"><i className="dot blue" /> opposed</span>
            <span className="l-item"><i className="dot gray" /> neutral</span>
            <span className="l-item"><i className="dot amber" /> supportive</span>
            <span className="l-item"><i className="tie" /> social tie</span>
            <span className="l-item"><i className="halo" /> influencer</span>
            <span className="l-item dim">hover to trace · click a citizen for their profile</span>
          </div>
        </section>

        <section className="card">
          <h2><span className="sq" /> Sentiment pulse</h2>
          <SentimentChart series={snapshots} />
          <div className="camp-row">
            {["support", "neutral", "oppose"].map((c) => (
              <div key={c} className={`camp camp-${c}`}>
                <b>{camps[c] ?? 0}</b>
                <span>{c}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2><span className="sq" /> Inject breaking news</h2>
          <p className="muted">Shock the world mid-simulation and watch opinion ripple. (God-mode.)</p>
          <textarea
            rows={2}
            placeholder="e.g. A leaked memo reveals the plan will be cancelled."
            value={evtText}
            onChange={(e) => setEvtText(e.target.value)}
          />
          <label className="row">
            <span>Impact</span>
            <input type="range" min={0.1} max={1} step={0.05} value={evtImpact}
                   onChange={(e) => setEvtImpact(+e.target.value)} />
            <span>{evtImpact.toFixed(2)}</span>
          </label>
          <button className="secondary" disabled={!running} onClick={inject}>
            ⚡ Inject event
          </button>
          {!running && <p className="muted small">Start the simulation to inject events.</p>}
          {events.length > 0 && (
            <ul className="evt-list">
              {events.map((e, i) => (
                <li key={i}><b>r{e.round}</b> {e.content}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2><span className="sq" /> Live feed</h2>
          <div className="feed-scroll">
            <FeedPanel actions={feed} />
          </div>
        </section>

        {selected && (
          <section className="card agent-card">
            <div className="card-head">
              <h2>{selected.name}</h2>
              <button className="link" onClick={() => setSelected(null)}>✕</button>
            </div>
            <p className="muted">{selected.persona?.age}, {selected.persona?.occupation} · {selected.persona?.region}</p>
            <p><em>“{selected.persona?.bio}”</em></p>
            <p className="small">Personality: {selected.persona?.personality} · style: {selected.persona?.style}</p>
            <div className="kv">
              <span>stance <b>{(selected.stance >= 0 ? "+" : "") + selected.stance.toFixed(2)}</b></span>
              <span>mood <b>{selected.mood?.toFixed(2)}</b></span>
              <span>influence <b>{selected.influence?.toFixed(2)}</b></span>
              <span>activity <b>{selected.activity?.toFixed(2)}</b></span>
            </div>
            {selected.posts?.length > 0 && (
              <ul className="feed">
                {selected.posts.map((p, i) => (
                  <li key={i} className="feed-item">
                    <span className="feed-round">r{p.round}</span>
                    <span className="feed-text">{p.content}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {done && (
          <section className="card report-card">
            <div className="card-head">
              <h2><span className="sq" /> Prediction report</h2>
              <button className="ghost" onClick={regen} disabled={reportLoading}>
                {reportLoading ? "writing…" : "↻ regenerate"}
              </button>
            </div>
            {report ? (
              <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(report.content) }} />
            ) : (
              <p className="muted">Report is being written…</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function useCamps(agents) {
  const out = { support: 0, neutral: 0, oppose: 0 };
  for (const a of agents) {
    if (a.stance > 0.25) out.support++;
    else if (a.stance < -0.25) out.oppose++;
    else out.neutral++;
  }
  return out;
}
