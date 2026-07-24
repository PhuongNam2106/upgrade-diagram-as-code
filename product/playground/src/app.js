const samples = {
  mermaid: `sequenceDiagram
  participant User
  participant Playground
  participant Gateway
  participant Renderer

  User->>Playground: Edit diagram source
  Playground->>Gateway: POST /v1/render
  Gateway->>Renderer: Render SVG
  Renderer-->>Gateway: SVG
  Gateway-->>Playground: SVG response`,
  plantuml: `@startuml
actor User
participant Playground
participant Gateway
participant "Kroki Renderer" as Renderer

User -> Playground: Edit diagram source
Playground -> Gateway: POST /v1/render
Gateway -> Renderer: Render SVG
Renderer --> Gateway: SVG
Gateway --> Playground: SVG response
@enduml`,
  graphviz: `digraph G {
  rankdir=LR;
  User -> Playground;
  Playground -> Gateway;
  Gateway -> Renderer;
  Renderer -> Gateway;
  Gateway -> Playground;
}`,
  d2: `User -> Playground: edit source
Playground -> Gateway: POST /v1/render
Gateway -> Renderer: render SVG
Renderer -> Gateway: SVG
Gateway -> Playground: SVG response`,
};

const keyStorageName = "diagram-as-code.playground.apiKey";
const typeInput = document.querySelector("#diagramType");
const sourceInput = document.querySelector("#diagramSource");
const apiKeyInput = document.querySelector("#apiKey");
const saveKeyButton = document.querySelector("#saveKey");
const renderForm = document.querySelector("#renderForm");
const renderButton = document.querySelector("#renderButton");
const statusText = document.querySelector("#statusText");
const previewImage = document.querySelector("#previewImage");
const errorBox = document.querySelector("#errorBox");
const copyMarkdownButton = document.querySelector("#copyMarkdown");
const copySvgButton = document.querySelector("#copySvg");
const exportSvgButton = document.querySelector("#exportSvg");

let latestSvg = "";
let latestObjectUrl = "";

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

function setActionsEnabled(enabled) {
  copyMarkdownButton.disabled = !enabled;
  copySvgButton.disabled = !enabled;
  exportSvgButton.disabled = !enabled;
}

function showError(message) {
  if (latestObjectUrl) URL.revokeObjectURL(latestObjectUrl);
  latestObjectUrl = "";
  latestSvg = "";
  previewImage.removeAttribute("src");
  previewImage.classList.remove("ready");
  errorBox.hidden = false;
  errorBox.textContent = message;
  setActionsEnabled(false);
}

function showSvg(svg) {
  if (latestObjectUrl) URL.revokeObjectURL(latestObjectUrl);
  latestSvg = svg;
  latestObjectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  previewImage.src = latestObjectUrl;
  previewImage.classList.add("ready");
  errorBox.hidden = true;
  errorBox.textContent = "";
  setActionsEnabled(true);
}

function requestHeaders() {
  const apiKey = apiKeyInput.value.trim();
  return {
    "content-type": "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function renderDiagram() {
  renderButton.disabled = true;
  setStatus("Rendering");
  try {
    const response = await fetch("/v1/render", {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify({
        type: typeInput.value,
        format: "svg",
        source: sourceInput.value,
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      let message = body;
      try {
        const parsed = JSON.parse(body);
        message = parsed.message ?? parsed.code ?? body;
      } catch {
        message = body;
      }
      throw new Error(message || `Render failed with HTTP ${response.status}`);
    }
    showSvg(body);
    setStatus("Rendered");
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    setStatus("Render failed", true);
  } finally {
    renderButton.disabled = false;
  }
}

async function copyText(text, label) {
  await navigator.clipboard.writeText(text);
  setStatus(`${label} copied`);
}

typeInput.addEventListener("change", () => {
  sourceInput.value = samples[typeInput.value];
  showError("");
  errorBox.hidden = true;
  setStatus("Ready");
});

saveKeyButton.addEventListener("click", () => {
  localStorage.setItem(keyStorageName, apiKeyInput.value.trim());
  setStatus("API key saved");
});

renderForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void renderDiagram();
});

copySvgButton.addEventListener("click", () => {
  if (latestSvg) void copyText(latestSvg, "SVG");
});

copyMarkdownButton.addEventListener("click", () => {
  if (latestSvg) void copyText("![diagram](docs/generated/diagram.svg)", "Markdown");
});

exportSvgButton.addEventListener("click", () => {
  if (!latestSvg) return;
  const url = URL.createObjectURL(new Blob([latestSvg], { type: "image/svg+xml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "diagram.svg";
  link.click();
  URL.revokeObjectURL(url);
  setStatus("SVG exported");
});

sourceInput.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    void renderDiagram();
  }
});

apiKeyInput.value = localStorage.getItem(keyStorageName) ?? "";
sourceInput.value = samples[typeInput.value];
