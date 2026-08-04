import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default function Home({ onEnter }) {
  const [name, setName] = useState("");
  const [requirement, setRequirement] = useState("");
  const [seedText, setSeedText] = useState("");
  const [numAgents, setNumAgents] = useState(40);
  const [rounds, setRounds] = useState(12);
  const [speed, setSpeed] = useState(0);
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

  return (
    <div className="home">
      <header className="hero">
        <div className="logo">VoxPopuli</div>
        <p className="tagline">
          Paste the news. Build a digital population. Watch how people react — and read the
          prediction.
        </p>
        <div className="mode-badge">
          {health?.llm_mode === "llm"
            ? `LLM engine · ${health.model}`
            : health?.llm_mode === "offline"
              ? "backend offline"
              : "heuristic engine (add LLM_API_KEY for smarter citizens)"}
        </div>
      </header>

      <div className="home-grid">
        <section className="card form-card">
          <h2>1 · Scenario</h2>
          <label>
            <span>What is the story / material?</span>
            <textarea
              rows={6}
              placeholder={"Paste a news article, policy draft, or any text…\n\ne.g. The government just announced a sweeping new AI regulation bill. Industry leaders are split…"}
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
            />
          </label>
          <div className="row">
            <label className="grow">
              <span>…or upload a file</span>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,.csv,.json,.html,.log"
                onChange={(e) => setFileNames(Array.from(e.target.files).map((f) => f.name))}
              />
            </label>
            {fileNames.length > 0 && (
              <span className="chip">files: {fileNames.join(", ")}</span>
            )}
          </div>
          <label>
            <span>Prediction question</span>
            <input
              placeholder="e.g. Will this policy pass? How will public opinion shift over the next month?"
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
            />
          </label>
          <label>
            <span>Name (optional)</span>
            <input
              placeholder="My AI-regulation scenario"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <h2>2 · World</h2>
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
          </div>

          <button className="primary big" disabled={busy || !seeded} onClick={create}>
            {busy ? busyLabel : "Build digital world →"}
          </button>
          {error && <div className="error">{error}</div>}
        </section>

        <section className="card">
          <h2>Recent simulations</h2>
          {simHistory.length === 0 && <p className="muted">Nothing here yet.</p>}
          <ul className="history">
            {simHistory.slice(0, 8).map((s) => (
              <li key={s.id}>
                <div className="h-name">{s.name}</div>
                <div className="h-meta">
                  {s.project_name} · {s.config?.num_agents} citizens · {s.status}
                </div>
                <button className="link" onClick={() => onEnter({ sid: s.id, pid: s.project_id, name: s.name })}>
                  open
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
