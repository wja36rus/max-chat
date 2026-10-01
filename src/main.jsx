// Точка монтирования React в DOM. StrictMode включён намеренно —
// в dev двойной маунт вылавливает неидемпотентные фоновые задачи
// (рестор, поллинг): все они спроектированы под повторный запуск.

import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import App from "./app/index.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
