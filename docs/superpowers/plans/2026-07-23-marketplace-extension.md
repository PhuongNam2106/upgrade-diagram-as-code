# VS Code Marketplace Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuẩn bị extension `Diagram as Code` để người dùng cài trực tiếp từ VS Code Marketplace dưới publisher `phuongnam`.

**Architecture:** Giữ nguyên runtime extension và Gateway contract của `0.1.0`; chỉ bổ sung Marketplace identity, branding asset, metadata, tài liệu onboarding và release verification. Lần publish đầu tiên dùng VSIX upload thủ công, không lưu Marketplace credential trong repository.

**Tech Stack:** VS Code Extension API, TypeScript, esbuild, `@vscode/vsce`, Node.js test runner, PNG asset.

## Global Constraints

- Publisher ID phải là `phuongnam`; extension ID cuối cùng là `phuongnam.diagram-as-code-vscode`.
- Marketplace release đầu tiên được upload thủ công; không thêm PAT hoặc publish secret vào GitHub Actions.
- Icon phải là PNG 256x256, không dùng SVG.
- Extension vẫn hỗ trợ VS Code `^1.100.0` và `.mmd`, `.puml`, `.dot`, `.d2`.
- Preview không tự export khi save; Export vẫn là thao tác rõ ràng của người dùng.
- Không thực hiện commit, push, tag, PR hoặc thay đổi Marketplace thay người dùng.
- Version `0.2.0` được nâng đồng bộ trong plan tích hợp release, không nâng riêng tại plan này.

## File Structure

- `product/vscode-extension/package.json`: danh tính Marketplace, metadata, allowlist và package scripts.
- `product/vscode-extension/resources/icon.png`: icon Marketplace 256x256 duy nhất.
- `product/vscode-extension/test/contributions.test.ts`: contract manifest và PNG.
- `product/vscode-extension/test/marketplace-docs.test.ts`: contract onboarding/privacy/migration.
- `product/vscode-extension/test/package-contract.test.ts`: contract nội dung VSIX.
- `product/vscode-extension/README.md`: listing và hướng dẫn người dùng Marketplace.
- `product/vscode-extension/CHANGELOG.md`: thay đổi extension theo version.
- `product/docs/marketplace-publishing.md`: runbook upload/verify/rollback thủ công.
- `.github/workflows/product-ci.yml`: package VSIX như một quality gate, không publish Marketplace.

---

### Task 1: Khóa Marketplace identity và branding contract

**Files:**
- Modify: `product/vscode-extension/package.json`
- Modify: `product/vscode-extension/test/contributions.test.ts`
- Create: `product/vscode-extension/resources/icon.png`

**Interfaces:**
- Consumes: publisher ID `phuongnam` đã được người dùng tạo trên Marketplace.
- Produces: manifest có `publisher`, `icon`, `homepage`, `bugs`, `keywords`, `galleryBanner`; PNG asset được VSIX đóng gói.

- [ ] **Step 1: Mở rộng manifest test type và viết test thất bại cho Marketplace metadata**

Thêm vào kiểu manifest trong `contributions.test.ts`:

```ts
publisher: string;
private?: boolean;
icon?: string;
homepage?: string;
bugs?: { url?: string };
keywords?: string[];
galleryBanner?: { color?: string; theme?: string };
files?: string[];
```

Thêm test:

```ts
test("declares publishable Marketplace identity and metadata", () => {
  assert.equal(manifest.publisher, "phuongnam");
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.icon, "resources/icon.png");
  assert.equal(manifest.homepage, "https://github.com/PhuongNam2106/upgrade-diagram-as-code#readme");
  assert.equal(manifest.bugs?.url, "https://github.com/PhuongNam2106/upgrade-diagram-as-code/issues");
  assert.deepEqual(manifest.keywords, ["diagram", "kroki", "mermaid", "plantuml", "graphviz", "d2"]);
  assert.deepEqual(manifest.galleryBanner, { color: "#18181b", theme: "dark" });
  assert.ok(manifest.files?.includes("resources/icon.png"));
});
```

- [ ] **Step 2: Chạy test và xác nhận RED**

Run:

```powershell
cd D:\upgrade-diagram-as-code\product
npm test --workspace=diagram-as-code-vscode
```

Expected: FAIL vì publisher vẫn là `diagram-as-code`, `private` vẫn tồn tại và metadata chưa có.

- [ ] **Step 3: Cập nhật manifest tối thiểu để thỏa metadata contract**

Áp dụng phần manifest sau trong `product/vscode-extension/package.json`:

```json
{
  "publisher": "phuongnam",
  "icon": "resources/icon.png",
  "homepage": "https://github.com/PhuongNam2106/upgrade-diagram-as-code#readme",
  "bugs": {
    "url": "https://github.com/PhuongNam2106/upgrade-diagram-as-code/issues"
  },
  "keywords": ["diagram", "kroki", "mermaid", "plantuml", "graphviz", "d2"],
  "galleryBanner": {
    "color": "#18181b",
    "theme": "dark"
  },
  "files": [
    "dist/extension.cjs",
    "resources/icon.png",
    "README.md",
    "CHANGELOG.md",
    "LICENSE"
  ]
}
```

Xóa thuộc tính:

```json
"private": true
```

- [ ] **Step 4: Tạo icon Marketplace đúng định dạng**

Dùng image generation tạo `product/vscode-extension/resources/icon.png` với yêu cầu cố định:

```text
256x256 PNG; nền charcoal #18181b; biểu tượng sơ đồ gồm ba node trắng nối bằng
hai đường teal #2dd4bf; hình đơn giản, tương phản cao, không chữ, không gradient,
không dùng logo Kroki hoặc VS Code.
```

Không tạo SVG trung gian và không đưa API key, URL nội bộ hoặc thông tin tài khoản vào asset.

- [ ] **Step 5: Thêm kiểm tra PNG signature và kích thước**

Thêm imports:

```ts
import { existsSync, readFileSync } from "node:fs";
```

Thêm test:

```ts
test("ships a 256 by 256 PNG Marketplace icon", () => {
  const iconUrl = new URL("../resources/icon.png", import.meta.url);
  assert.equal(existsSync(iconUrl), true);
  const icon = readFileSync(iconUrl);
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(icon.readUInt32BE(16), 256);
  assert.equal(icon.readUInt32BE(20), 256);
});
```

- [ ] **Step 6: Chạy test và xác nhận GREEN**

Run:

```powershell
npm test --workspace=diagram-as-code-vscode
```

Expected: toàn bộ extension tests PASS, bao gồm hai test Marketplace mới.

- [ ] **Step 7: User checkpoint cho commit thủ công**

Agent dừng; người dùng tự review và chạy nếu muốn:

```powershell
git add product/vscode-extension/package.json product/vscode-extension/resources/icon.png product/vscode-extension/test/contributions.test.ts
git commit -m "feat: prepare extension marketplace identity"
```

---

### Task 2: Viết Marketplace onboarding và privacy contract

**Files:**
- Modify: `product/vscode-extension/README.md`
- Modify: `product/vscode-extension/CHANGELOG.md`
- Create: `product/vscode-extension/test/marketplace-docs.test.ts`

**Interfaces:**
- Consumes: Gateway URL `http://localhost:9000`, command IDs đã tồn tại và bốn phần mở rộng được hỗ trợ.
- Produces: Marketplace listing mô tả chính xác prerequisite, setup, workflow và dữ liệu gửi tới Gateway.

- [ ] **Step 1: Viết test thất bại cho các phần README bắt buộc**

Tạo `marketplace-docs.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");

test("Marketplace README documents installation and the complete user flow", () => {
  for (const heading of [
    "## Install",
    "## Connect to the Gateway",
    "## Preview and export",
    "## Project configuration",
    "## Upgrade from the test VSIX",
    "## Data and privacy",
  ]) assert.match(readme, new RegExp(`^${heading}$`, "m"));

  assert.match(readme, /Diagram: Set Gateway API Key/);
  assert.match(readme, /Saving never writes an SVG/);
  assert.match(readme, /http:\/\/localhost:9000/);
  assert.match(readme, /diagram-as-code\.diagram-as-code-vscode/);
  assert.match(readme, /enter the Gateway API key again/i);
  assert.doesNotMatch(readme, /file:\/\//);
  assert.doesNotMatch(readme, /!\[[^\]]*\]\([^)]*\.svg\)/i);
});

test("changelog contains the 0.2.0 Marketplace release", () => {
  assert.match(changelog, /^## 0\.2\.0$/m);
  assert.match(changelog, /Visual Studio Marketplace/);
  assert.match(changelog, /phuongnam\.diagram-as-code-vscode/);
});
```

- [ ] **Step 2: Chạy test và xác nhận RED**

Run:

```powershell
npm test --workspace=diagram-as-code-vscode
```

Expected: FAIL vì README và changelog chưa có các section `0.2.0`.

- [ ] **Step 3: Viết lại README Marketplace ngắn gọn**

README phải chứa nội dung thực tế sau, bằng tiếng Anh để phù hợp Marketplace quốc tế:

```markdown
# Diagram as Code

Preview Mermaid, PlantUML, Graphviz/DOT, and D2 sources through your
self-hosted Diagram as Code Gateway, then explicitly export deterministic SVGs.

## Install

Install `Diagram as Code` from the Visual Studio Marketplace. A running Gateway
is required; the extension does not install or start Docker.

## Connect to the Gateway

Open a workspace containing `.diagramrc.yml`. For a local Windows server, use
`http://localhost:9000`. Run `Diagram: Set Gateway API Key` once; the key is
stored in VS Code SecretStorage.

## Preview and export

Open a `.mmd`, `.puml`, `.dot`, or `.d2` file and select Preview. Saving updates
the live preview after the configured delay. Saving never writes an SVG. Select
Export only when the canonical artifact should be updated.

## Project configuration

Commit `.diagramrc.yml` with source and output directories. Never commit API keys.

## Upgrade from the test VSIX

Uninstall `diagram-as-code.diagram-as-code-vscode`, then install
`phuongnam.diagram-as-code-vscode` from the Marketplace. Because VS Code
SecretStorage is scoped to the extension ID, enter the Gateway API key again.

## Data and privacy

Diagram source is sent only to the Gateway URL configured by the workspace.
The extension does not send source to the Visual Studio Marketplace or an
analytics service.
```

Giữ danh sách commands và mô tả status bar hiện có dưới các section tương ứng; không lặp lại cùng một hướng dẫn ở hai nơi.

- [ ] **Step 4: Thêm changelog `0.2.0`**

Đặt trước `0.1.0`:

```markdown
## 0.2.0

- Publish as `phuongnam.diagram-as-code-vscode` on the Visual Studio Marketplace.
- Add Marketplace branding and first-run Gateway setup documentation.
- Keep explicit SVG export and local SecretStorage credentials.
```

- [ ] **Step 5: Chạy test và xác nhận GREEN**

Run:

```powershell
npm test --workspace=diagram-as-code-vscode
```

Expected: tất cả tests PASS.

- [ ] **Step 6: User checkpoint cho commit thủ công**

```powershell
git add product/vscode-extension/README.md product/vscode-extension/CHANGELOG.md product/vscode-extension/test/marketplace-docs.test.ts
git commit -m "docs: add marketplace extension onboarding"
```

---

### Task 3: Package và kiểm tra VSIX như artifact Marketplace

**Files:**
- Modify: `product/vscode-extension/package.json`
- Modify: `.github/workflows/product-ci.yml`
- Create: `product/vscode-extension/test/package-contract.test.ts`

**Interfaces:**
- Consumes: build output `product/vscode-extension/dist/extension.cjs` và manifest từ Task 1.
- Produces: `product/vscode-extension/dist/diagram-as-code-vscode.vsix` không chứa source/test/secret.

- [ ] **Step 1: Viết test package allowlist thất bại**

Tạo `package-contract.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  files?: string[];
  scripts?: Record<string, string>;
};

test("Marketplace package uses an explicit production allowlist", () => {
  assert.deepEqual(manifest.files, [
    "dist/extension.cjs",
    "resources/icon.png",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
  ]);
  assert.equal(
    manifest.scripts?.["package:check"],
    "vsce ls --tree && vsce package --no-dependencies --out dist/diagram-as-code-vscode.vsix",
  );
});
```

- [ ] **Step 2: Chạy test và xác nhận RED**

Run:

```powershell
npm test --workspace=diagram-as-code-vscode
```

Expected: FAIL vì `package:check` chưa tồn tại.

- [ ] **Step 3: Thêm package verification script**

Trong `scripts` của extension:

```json
"package:check": "vsce ls --tree && vsce package --no-dependencies --out dist/diagram-as-code-vscode.vsix",
"package": "npm run build && npm run package:check"
```

- [ ] **Step 4: Chạy tests, typecheck và package**

Run:

```powershell
npm test --workspace=diagram-as-code-vscode
npm run typecheck --workspace=diagram-as-code-vscode
npm run package --workspace=diagram-as-code-vscode
```

Expected:

```text
tests: pass
typecheck: exit 0
VSIX contains extension.cjs, icon.png, README.md, CHANGELOG.md, LICENSE
```

- [ ] **Step 5: Cập nhật CI để gọi package contract rõ tên**

Thay step package hiện tại trong `.github/workflows/product-ci.yml` bằng:

```yaml
- name: Package Marketplace VSIX
  run: npm --workspace=diagram-as-code-vscode run package
  working-directory: product
```

Giữ nguyên upload artifact `product/vscode-extension/dist/*.vsix`.

- [ ] **Step 6: Cài VSIX bằng VS Code profile sạch và smoke test thủ công**

Người dùng tự chạy:

```powershell
code --user-data-dir "$env:TEMP\diagram-vscode-profile" `
  --extensions-dir "$env:TEMP\diagram-vscode-extensions" `
  --install-extension "D:\upgrade-diagram-as-code\product\vscode-extension\dist\diagram-as-code-vscode.vsix"
```

Mở project fixture có `.diagramrc.yml`, xác nhận:

```text
Extension ID = phuongnam.diagram-as-code-vscode
Preview works
Save updates preview but not SVG
Export updates one stable SVG
API key is requested once
```

- [ ] **Step 7: User checkpoint cho commit thủ công**

```powershell
git add product/vscode-extension/package.json product/vscode-extension/test/package-contract.test.ts .github/workflows/product-ci.yml
git commit -m "build: verify marketplace vsix contents"
```

---

### Task 4: Marketplace publish runbook và bàn giao thủ công

**Files:**
- Create: `product/docs/marketplace-publishing.md`
- Modify: `product/docs/release-guide.md`

**Interfaces:**
- Consumes: VSIX đã qua Task 3, publisher `phuongnam`, release tag từ plan tích hợp.
- Produces: quy trình upload, verify và rollback không yêu cầu agent thao tác Marketplace.

- [ ] **Step 1: Viết runbook với checklist trước publish**

`marketplace-publishing.md` phải chứa đúng các mục:

```markdown
# Marketplace Publishing

## Prerequisites
- Publisher ID is `phuongnam`.
- Product release tests are green.
- The VSIX was installed and smoke-tested from a clean VS Code profile.

## First publication
1. Open the Visual Studio Marketplace publisher management page.
2. Select publisher `phuongnam`.
3. Choose New extension, then Visual Studio Code.
4. Upload `diagram-as-code-vscode-0.2.0.vsix` from the GitHub Release.
5. Review the listing and make it public.

## Verification
1. Search for `Diagram as Code` in VS Code.
2. Confirm ID `phuongnam.diagram-as-code-vscode` and version `0.2.0`.
3. Install and run Preview/Export against `http://localhost:9000`.

## Rollback
- Unpublish only for a security or data-loss issue.
- For normal defects, publish a higher patch version; never overwrite a released version.
```

- [ ] **Step 2: Liên kết runbook từ release guide**

Trong phần xác nhận sau release, thêm:

```markdown
- Follow [Marketplace Publishing](marketplace-publishing.md) to upload the VSIX manually under publisher `phuongnam` and verify the public listing.
```

- [ ] **Step 3: Kiểm tra tài liệu không chứa secret hoặc placeholder**

Run:

```powershell
rg -n "PAT=|VSCE_PAT|TBD|TODO|NEEDS CLARIFICATION" product/docs/marketplace-publishing.md product/docs/release-guide.md
```

Expected: không có kết quả.

- [ ] **Step 4: Chạy release gate liên quan extension**

Run:

```powershell
cd D:\upgrade-diagram-as-code\product
npm audit
npm run typecheck
npm test
npm --workspace=diagram-as-code-vscode run package
```

Expected: exit `0`, toàn bộ tests PASS và VSIX được tạo.

- [ ] **Step 5: User checkpoint cho commit và Marketplace upload**

Agent dừng. Người dùng tự review/commit và chỉ upload sau khi plan tích hợp release hoàn tất:

```powershell
git add product/docs/marketplace-publishing.md product/docs/release-guide.md
git commit -m "docs: add marketplace publishing runbook"
```
