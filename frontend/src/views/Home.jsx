import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

export default function Home({ onEnter, onCompare }) {
  const [name, setName] = useState("");
  const [requirement, setRequirement] = useState("");
  const [seedText, setSeedText] = useState("");
  const [numAgents, setNumAgents] = useState(40);
  const [rounds, setRounds] = useState(12);
  const [speed, setSpeed] = useState(0);
  const [seed, setSeed] = useState("");
  const [mode, setMode] = useState("auto");
  const [health, setHealth] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  const [fileNames, setFileNames] = useState([]);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ llm_mode: "offline" }));
    api.listProjects().then((d) => setHistory(d.data)).catch(() => {});
    api.listSimulations().then((d) => setSimHistory(d.data)).catch(() => {});
  }, []);

  const [simHistory, setSimHistory] = useState([]);
  const [cmpSel, setCmpSel] = useState([]);

  const toggleCmp = (s) => {
    setCmpSel((prev) =>
      prev.some((x) => x.id === s.id)
        ? prev.filter((x) => x.id !== s.id)
        : [...prev.slice(-1), s]
    );
  };

  async function create() {
    setError("");
    if (!seedText.trim()) {
      setError("Paste some news / background material first (or upload a file).");
      return;
    }
    try {
      setBusy(true);
      setBusyLabel("Creating project…");
      const proj = await api.createProject({
        name: name.trim() || "Untitled scenario",
        requirement: requirement.trim() || "How will public opinion evolve?",
        seed_text: seedText.trim(),
        files: fileRef.current?.files ? Array.from(fileRef.current.files) : [],
      });
      const pid = proj.data.id;
      setBusyLabel("Spinning up the digital world…");
      const sim = await api.createSimulation({
        project_id: pid,
        name: proj.data.name,
        num_agents: numAgents,
        rounds,
        speed_ms: speed,
        mode,
        seed: seed.trim() === "" ? undefined : seed.trim(),
      });
      const sid = sim.data.id;
      setBusyLabel("Breeding the population (LLM personas)…");
      await api.buildWorld(sid);
      onEnter({ sid, pid, name: proj.data.name });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const seeded = seedText.trim().length > 0;
  const llmMode = health?.llm_mode;

  return (
    <div className="home">
      <header className="topnav">
        <span className="wordmark"><i /> VoxPopuli</span>
        {llmMode === "llm" ? (
          <span className="engine-meta ok"><i /> engine: llm · {health.model}</span>
        ) : llmMode === "offline" ? (
          <span className="engine-meta off"><i /> backend offline</span>
        ) : (
          <span className="engine-meta warn"><i /> engine: heuristic</span>
        )}
      </header>

      <div className="home-grid">
        <section className="intro">
          <div className="kicker"><i className="sq" /> System Status</div>
          <h1 className="status-title">{busy ? busyLabel : seeded ? "System Ready" : "Awaiting Input"}</h1>
          <p className="status-sub">
            {busy
              ? "Building your digital population…"
              : seeded
                ? "Seed material loaded. Tune the crowd below and run the simulation."
                : "Paste the news. Build a digital population. Watch how people react — and read the prediction."}
          </p>

          <div className="kicker"><span className="dia">◇</span> Workflow Steps</div>
          <ol className="steps">
            <li><div><b>1. Reality Seed</b><span>Paste news or upload material; topics & entities are extracted automatically.</span></div></li>
            <li><div><b>2. World Build</b><span>A crowd of AI citizens is bred with personas, stances, moods & social ties.</span></div></li>
            <li><div><b>3. Run Simulation</b><span>Citizens post, reply and react each round; passive minds drift with influencers.</span></div></li>
            <li><div><b>4. Breaking Events</b><span>Inject shocks mid-run and watch opinion ripple across the world.</span></div></li>
            <li><div><b>5. Prediction Report</b><span>Where opinion lands, net movement, camps, key influencers & confidence.</span></div></li>
          </ol>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="mono-label">01 / Reality Seeds</span>
            <span className="mono-label">{fileNames.length > 0 ? `${fileNames.length} file(s)` : "TXT · MD · CSV · JSON"}</span>
          </div>
          <div className="panel-body">
            <textarea
              rows={6}
              className="code"
              placeholder={"Paste a news article, policy draft, or any text…\n\ne.g. The government just announced a sweeping new AI regulation bill. Industry leaders are split…"}
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
            />
            <div className="file-row">
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,.csv,.json,.html,.log"
                onChange={(e) => setFileNames(Array.from(e.target.files).map((f) => f.name))}
              />
              {fileNames.length > 0 && <span className="chip">{fileNames.join(", ")}</span>}
            </div>

            <div className="divider"><span>Input Parameters</span></div>

            <label>
              <span>&gt;_ Prediction question</span>
              <textarea
                rows={2}
                className="code"
                placeholder="e.g. Will this policy pass? How will public opinion shift over the next month?"
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
              />
            </label>
            <p className="engine-caption">Engine: VoxPopuli-V1.0 · {llmMode === "llm" ? "LLM" : llmMode === "offline" ? "offline" : "heuristic"} mode</p>

            <label style={{ marginTop: 14 }}>
              <span>Scenario name (optional)</span>
              <input
                placeholder="My AI-regulation scenario"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <div className="grid2">
              <label>
                <span>Population · {numAgents} citizens</span>
                <input type="range" min={10} max={200} step={5} value={numAgents}
                       onChange={(e) => setNumAgents(+e.target.value)} />
              </label>
              <label>
                <span>Rounds · {rounds}</span>
                <input type="range" min={3} max={60} value={rounds}
                       onChange={(e) => setRounds(+e.target.value)} />
              </label>
              <label>
                <span>Round speed · {speed === 0 ? "instant" : `${speed}ms`}</span>
                <input type="range" min={0} max={2000} step={100} value={speed}
                       onChange={(e) => setSpeed(+e.target.value)} />
              </label>
              <label>
                <span>Engine</span>
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="auto">auto (LLM if key present)</option>
                  <option value="llm">LLM only</option>
                  <option value="heuristic">heuristic only</option>
                </select>
              </label>
              <label>
                <span>Seed · {seed.trim() || "random"}</span>
                <input
                  placeholder="e.g. 42 — same seed, same world"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                />
              </label>
            </div>

            <button className="cta" disabled={busy || !seeded} onClick={create}>
              {busy ? busyLabel || "Working…" : "Build Digital World"} <span className="arr">→</span>
            </button>

            {error && <div className="error">{error}</div>}
            {!error && llmMode && llmMode !== "llm" && (
              <div className="notice">⚠ Heuristic engine active — set LLM_API_KEY in .env for smarter citizens.</div>
            )}
          </div>
        </section>
      </div>

      <section className="recent card">
        <h2><span className="sq" /> Recent simulations</h2>
        {cmpSel.length > 0 && (
          <div className="cmp-tray">
            <span className="cmp-pick">⇄ {cmpSel.map((s) => s.name).join("  vs  ")}{cmpSel.length < 2 ? " — pick one more" : ""}</span>
            <span className="grow" />
            <button className="link" onClick={() => setCmpSel([])}>clear</button>
            {cmpSel.length === 2 && (
              <button
                className="primary"
                onClick={() => onCompare && onCompare({
                  a: { sid: cmpSel[0].id, name: cmpSel[0].name },
                  b: { sid: cmpSel[1].id, name: cmpSel[1].name },
                })}
              >
                Compare →
              </button>
            )}
          </div>
        )}
        {simHistory.length === 0 ? (
          <div className="empty-state">Nothing here yet — your first simulation will appear here.</div>
        ) : (
          <ul className="history">
            {simHistory.slice(0, 8).map((s) => (
              <li key={s.id} className={cmpSel.some((x) => x.id === s.id) ? "sel" : ""}>
                <div className="h-name">{s.name}</div>
                <div className="h-meta">
                  {s.project_name} · {s.config?.num_agents} citizens · {s.status}
                </div>
                <div className="h-actions">
                  <button
                    className={`link${cmpSel.some((x) => x.id === s.id) ? " on" : ""}`}
                    title="Select for A/B comparison"
                    onClick={() => toggleCmp(s)}
                  >
                    ⇄
                  </button>
                  <button className="link" onClick={() => onEnter({ sid: s.id, pid: s.project_id, name: s.name })}>
                    open ↗
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
