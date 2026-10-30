import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SpeakerWindow } from "./SpeakerWindow";
const speakerSession = new URLSearchParams(location.search).get("speaker");
import "./style.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {speakerSession && /^[a-f0-9-]{36}$/i.test(speakerSession) ? (
      <SpeakerWindow session={speakerSession} />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
