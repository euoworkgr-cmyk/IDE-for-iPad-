import "./styles.css";
import { registerSW } from "virtual:pwa-register";
import { App } from "./components/App";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Application root was not found");
}

const app = new App(root);
app.start().catch((error: unknown) => app.showFatalError(error));

/**
 * Registered here rather than inside App because it is not part of the editor:
 * the app runs fine without a Service Worker, and a registration that fails
 * must not take the editor down with it.
 *
 * `onNeedRefresh` is what "prompt" buys over "autoUpdate" (R5): the new worker
 * has installed and is waiting rather than having already swapped the assets
 * under a running page, so the reload happens when the user says so.
 */
const updateSW = registerSW({
  // Referencing updateSW from inside its own options is safe: this callback
  // only ever runs long after registerSW has returned.
  onNeedRefresh: () => app.announceUpdateReady(() => void updateSW(true)),
  onRegisterError: (error: unknown) => {
    console.error("Service Worker registration failed; the app will not work offline", error);
  }
});
