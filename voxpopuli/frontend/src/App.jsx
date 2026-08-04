import { useState } from "react";
import Home from "./views/Home.jsx";
import World from "./views/World.jsx";

export default function App() {
  const [session, setSession] = useState(null); // { sid, pid, name }

  if (session) {
    return (
      <World
        sid={session.sid}
        pid={session.pid}
        name={session.name}
        onExit={() => setSession(null)}
      />
    );
  }
  return <Home onEnter={(s) => setSession(s)} />;
}
