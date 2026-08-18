import "./styles.css";
import { App } from "./components/App";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Application root was not found");
}

const app = new App(root);
app.start().catch((error: unknown) => app.showFatalError(error));
