import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  activationEvents: string[];
  publisher: string;
  private?: boolean;
  icon?: string;
  homepage?: string;
  bugs?: { url?: string };
  keywords?: string[];
  galleryBanner?: { color?: string; theme?: string };
  contributes: {
    commands: Array<{ command: string; icon?: string }>;
    menus: Record<string, Array<{ command: string; group?: string; when?: string }>>;
  };
};

test("declares the public Marketplace identity and metadata", () => {
  assert.equal(manifest.publisher, "phuongnam");
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.icon, "resources/icon.png");
  assert.equal(
    manifest.homepage,
    "https://github.com/PhuongNam2106/upgrade-diagram-as-code#readme",
  );
  assert.equal(
    manifest.bugs?.url,
    "https://github.com/PhuongNam2106/upgrade-diagram-as-code/issues",
  );
  assert.deepEqual(manifest.keywords, [
    "diagram",
    "kroki",
    "mermaid",
    "plantuml",
    "graphviz",
    "d2",
  ]);
  assert.deepEqual(manifest.galleryBanner, { color: "#18181b", theme: "dark" });
});

test("ships a 256 by 256 PNG Marketplace icon", () => {
  const iconUrl = new URL("../resources/icon.png", import.meta.url);
  assert.equal(existsSync(iconUrl), true);
  const icon = readFileSync(iconUrl);
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(icon.readUInt32BE(16), 256);
  assert.equal(icon.readUInt32BE(20), 256);
});

function menuCommands(menu: string): string[] {
  return (manifest.contributes.menus[menu] ?? []).map((item) => item.command);
}

test("exposes prioritized editor and preview title buttons", () => {
  const editorItems = manifest.contributes.menus["editor/title"] ?? [];
  assert.deepEqual(menuCommands("editor/title"), [
    "diagramAsCode.preview",
    "diagramAsCode.exportSvg",
  ]);
  assert.deepEqual(editorItems.map((item) => item.group), ["navigation@1", "navigation@2"]);
  assert.deepEqual(menuCommands("webview/title"), [
    "diagramAsCode.refreshPreview",
    "diagramAsCode.exportPreviewSvg",
  ]);

  const commands = new Map(manifest.contributes.commands.map((item) => [item.command, item]));
  assert.equal(commands.get("diagramAsCode.refreshPreview")?.icon, "$(refresh)");
  assert.equal(commands.get("diagramAsCode.exportPreviewSvg")?.icon, "$(export)");
});

test("exposes diagram commands from editor and Explorer context menus", () => {
  const expected = [
    "diagramAsCode.preview",
    "diagramAsCode.exportSvg",
    "diagramAsCode.setApiKey",
  ];
  assert.deepEqual(menuCommands("editor/context"), expected);
  assert.deepEqual(menuCommands("explorer/context"), expected);
});

test("activates when a supported diagram language is opened", () => {
  assert.deepEqual(
    manifest.activationEvents.filter((event) => event.startsWith("onLanguage:")),
    [
      "onLanguage:diagram-mermaid",
      "onLanguage:diagram-plantuml",
      "onLanguage:diagram-dot",
      "onLanguage:diagram-d2",
    ],
  );
});
