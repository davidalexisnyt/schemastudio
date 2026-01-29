import "./styles.css";
import { init } from "./app";

const appEl = document.getElementById("app");
if (appEl) {
  init(appEl);
} else {
  document.body.innerHTML = "<p>App root not found</p>";
}
