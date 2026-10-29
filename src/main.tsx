import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ThemeProvider } from "./hooks/useTheme";
import { registerPWA } from "./pwa";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
);

registerPWA();
