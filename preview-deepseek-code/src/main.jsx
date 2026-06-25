import "@douyinfe/semi-ui/react19-adapter";
import React from "react";
import { createRoot } from "react-dom/client";
import DeepSeekCodeIDE from "../../DeepSeekCodeIDE.jsx";
import "./style.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <DeepSeekCodeIDE />
  </React.StrictMode>,
);
