import { useState } from "react";
import Home from "./views/Home.jsx";
import World from "./views/World.jsx";
import Compare from "./views/Compare.jsx";

export default function App() {
  const [session, setSession] = useState(null); // { sid, pid, name }
  const [compare, setCompare] = useState(null); // { a: {sid,name}, b: {sid,name} }

  if (compare) {
    return (
      <Compare
        a={compare.a}
        b={compare.b}
        onExit={() => setCompare(null)}
        onOpen={(s) => { setCompare(null); setSession(s); }}
      />
    );
  }
  if (session) {
    return (
      <World
        sid={session.sid}
        pid={session.pid}
        name={session.name}
        onExit={() => setSession(null)}
        onEnter={(s) => setSession(s)}
      />
    );
  }
  return <Home onEnter={(s) => setSession(s)} onCompare={(c) => setCompare(c)} />;
}
