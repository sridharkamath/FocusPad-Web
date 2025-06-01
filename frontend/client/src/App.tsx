import { useEffect, useState } from "react";

export default function App() {
  const [msg, setMsg] = useState("loading...");

  useEffect(() => {
    fetch("http://localhost:8000/ping")
      .then((r) => r.json())
      .then((d) => setMsg(d.msg))
      .catch(() => setMsg("error"));
  }, []);

  return (
    <div style={{ fontFamily: "sans-serif", textAlign: "center", marginTop: 40 }}>
      <h1>Hello – {msg}</h1>
    </div>
  );
}
