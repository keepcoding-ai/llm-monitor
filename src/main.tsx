import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { registerPwa } from "./pwa";

createRoot(document.getElementById("root")!).render(<App />);
registerPwa();
