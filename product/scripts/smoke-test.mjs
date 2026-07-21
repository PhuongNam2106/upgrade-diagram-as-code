import process from "node:process";

const baseUrl = (process.env.DIAGRAM_GATEWAY_URL ?? "http://localhost:9000").replace(/\/$/, "");
const apiKey = process.env.DIAGRAM_API_KEY;

if (!apiKey) {
  throw new Error("Set DIAGRAM_API_KEY to the key configured for the Gateway");
}

const examples = [
  ["mermaid", "flowchart LR\n  A --> B"],
  ["plantuml", "@startuml\nAlice -> Bob: hello\n@enduml"],
  ["graphviz", "digraph G { A -> B }"],
  ["d2", "A -> B"],
];

async function waitUntilReady() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/ready`);
      if (response.ok) return;
    } catch {
      // The stack may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Gateway did not become ready at ${baseUrl}`);
}

await waitUntilReady();

for (const [type, source] of examples) {
  const response = await fetch(`${baseUrl}/v1/render`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ type, format: "svg", source }),
  });
  const body = await response.text();
  if (!response.ok || !body.includes("<svg")) {
    throw new Error(`${type} smoke render failed (${response.status}): ${body}`);
  }
  process.stdout.write(`ok ${type} (${response.headers.get("x-cache")})\n`);
}
