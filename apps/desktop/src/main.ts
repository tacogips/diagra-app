import { invoke } from "@tauri-apps/api/core";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("Missing #app root element");
}

app.innerHTML = `
  <section class="shell">
    <p class="eyebrow">diagra</p>
    <h1>Tauri App</h1>
    <p class="description">A Tauri desktop app</p>
    <form class="greeting-form">
      <input id="name-input" name="name" placeholder="Enter a name" autocomplete="off" />
      <button type="submit">Greet</button>
    </form>
    <p id="greeting-output" class="output" aria-live="polite"></p>
  </section>
`;

const form = app.querySelector<HTMLFormElement>(".greeting-form");
const input = app.querySelector<HTMLInputElement>("#name-input");
const output = app.querySelector<HTMLParagraphElement>("#greeting-output");

if (!form || !input || !output) {
  throw new Error("Greeting form failed to initialize");
}

form.addEventListener("submit", async (event: SubmitEvent) => {
  event.preventDefault();

  const name = input.value.trim() || "Tauri";
  output.textContent = await invoke<string>("greet", { name });
});
