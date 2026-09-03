import { useEffect, useState } from "react";
import { api } from "../api.js";
import CompareChart from "../components/CompareChart.jsx";

function normSnap(s) {
  return {
    round: s.round,
    sentiment: s.sentiment,
    stance_std: s.stance_std,
    message_count: s.message_count,
    camps: s.camps || s.data?.camps || null,
  };
}

const signed = (v) => (v >= 0 ? "+" : "") + Number(v).toFixed(2);
const lean = (v) => (v > 0.15 ? "supportive" : v < -0.15 ? "opposed" : "neutral");

async function loadRun(sid) {
  const [s, snaps, analysis, events] = await Promise.all([
    api.getSimulation(sid),
    api.getSnapshots(sid),
    api.getAnalysis(sid).then((r) => r.data).catch(() => null),
    api.getEvents(sid).then((r) => r.data).catch(() => []),
  ]);
  return { sim: s.data, snaps: snaps.data.map(normSnap), analysis, events };
}

function summarize(run) {
  const { snaps, analysis, events } = run;
  if (!snaps.length) {
    return { rounds: 0, first: 0, final: 0, move: 0, spread: 0, messages: 0,
             camps: null, loudest: null, events, conf: "–" };
  }
  const first = snaps[0].sentiment;
  const last = snaps[snaps.length - 1];
  let loudest = null;
  if (analysis?.camps) {
    for (const k of Object.keys(analysis.camps)) {
      for (const m of analysis.camps[k].members || []) {
        if (!loudest || (m.influence || 0) > (loudest.influence || 0)) loudest = { ...m, camp: k };
      }
    }
  }
  return {
    rounds: snaps.length,
    first, final: last.sentiment, move: last.sentiment - first,
    spread: last.stance_std, messages: last.message_count,
    camps: last.camps, loudest, events,
    conf: analysis?.confidence?.score != null
      ? `${analysis.confidence.score} · ${analysis.confidence.label}` : "–",
  };
}

export default function Compare({ a, b, onExit, onOpen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [A, B] = await Promise.all([loadRun(a.sid), loadRun(b.sid)]);
        setData({ A, B });
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [a.sid, b.sid]);

  const sA = data ? summarize(data.A) : null;
  const sB = data ? summarize(data.B) : null;
  const seedA = data?.A.sim.config?.seed;
  const seedB = data?.B.sim.config?.seed;
  const seedsDiffer = seedA !== undefined && seedB !== undefined && seedA !== seedB;

  let verdict = "";
  if (sA && sB && sA.rounds && sB.rounds) {
    verdict =
      `A ended ${lean(sA.final)} (${signed(sA.final)}), ` +
      `B ended ${lean(sB.final)} (${signed(sB.final)}) — gap ${signed(sA.final - sB.final)}. ` +
      `A moved ${signed(sA.move)}, B moved ${signed(sB.move)} from round 1.`;
  }

  const rows = sA && sB ? [
    ["Status", data.A.sim.status, data.B.sim.status],
    ["Rounds", `${sA.rounds}`, `${sB.rounds}`],
    ["Final sentiment", signed(sA.final), signed(sB.final)],
    ["Net movement", signed(sA.move), signed(sB.move)],
    ["Confidence", sA.conf, sB.conf],
    ["Final spread", sA.spread?.toFixed(2) ?? "–", sB.spread?.toFixed(2) ?? "–"],
    ["Public actions", `${sA.messages}`, `${sB.messages}`],
    ["Final camps S/N/O",
      sA.camps ? `${sA.camps.support}/${sA.camps.neutral}/${sA.camps.oppose}` : "–",
      sB.camps ? `${sB.camps.support}/${sB.camps.neutral}/${sB.camps.oppose}` : "–"],
    ["Loudest voice",
      sA.loudest ? `${sA.loudest.name} (${sA.loudest.camp}, ▮ ${Number(sA.loudest.influence).toFixed(2)})` : "–",
      sB.loudest ? `${sB.loudest.name} (${sB.loudest.camp}, ▮ ${Number(sB.loudest.influence).toFixed(2)})` : "–"],
    ["Breaking events",
      sA.events.length ? sA.events.map((e) => `r${e.round}: ${e.content}`).join(" · ") : "none",
      sB.events.length ? sB.events.map((e) => `r${e.round}: ${e.content}`).join(" · ") : "none"],
  ] : [];

  return (
    <div className="world">
      <header className="w-topbar">
        <div>
          <span className="w-title">A/B compare</span>
          <span className="pill">A · {data?.A.sim.name || a.name}</span>
          <span className="pill">B · {data?.B.sim.name || b.name}</span>
          {seedA !== undefined && <span className="pill dim">seed A {seedA}</span>}
          {seedB !== undefined && <span className="pill dim">seed B {seedB}</span>}
        </div>
        <div className="w-actions">
          <button className="ghost" onClick={() => onOpen && onOpen({ sid: a.sid, pid: data?.A.sim.project_id, name: data?.A.sim.name || a.name })}>Open A ↗</button>
          <button className="ghost" onClick={() => onOpen && onOpen({ sid: b.sid, pid: data?.B.sim.project_id, name: data?.B.sim.name || b.name })}>Open B ↗</button>
          <button className="ghost" onClick={onExit}>← back</button>
        </div>
      </header>

      {error && <div className="error bar">{error}</div>}
      {seedsDiffer && (
        <div className="notice">⚠ Different seeds ({seedA} vs {seedB}) — the worlds started from different crowds, so treat this as apples-to-oranges. Clone one run for a clean what-if.</div>
      )}

      <div className="world-grid">
        <section className="card report-card">
          <div className="card-head"><h2><span className="sq" /> Sentiment head-to-head</h2></div>
          {!data ? (
            <div className="chart-empty"><p>loading both runs…</p></div>
          ) : (
            <CompareChart
              seriesA={data.A.snaps} seriesB={data.B.snaps}
              nameA={data.A.sim.name} nameB={data.B.sim.name}
            />
          )}
        </section>

        <section className="card report-card">
          <div className="card-head"><h2><span className="sq" /> Verdict</h2></div>
          {!data ? (
            <div className="chart-empty"><p>loading both runs…</p></div>
          ) : (
            <>
              <p className="verdict">{verdict || "Run both simulations to get a verdict."}</p>
              {rows.length > 0 && (
                <table className="cmp-table">
                  <thead><tr><th></th><th>A · {data.A.sim.name}</th><th>B · {data.B.sim.name}</th></tr></thead>
                  <tbody>
                    {rows.map(([k, va, vb]) => (
                      <tr key={k}><td className="k">{k}</td><td>{va}</td><td>{vb}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
