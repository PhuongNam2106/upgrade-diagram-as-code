# Marketplace Publishing

## Prerequisites

- Publisher ID is `phuongnam`.
- Product release tests are green.
- The VSIX was installed and smoke-tested from a clean VS Code profile.
- The VSIX checksum matches the GitHub Release `SHA256SUMS` entry.

## First publication

1. Open the Visual Studio Marketplace publisher management page.
2. Select publisher `phuongnam`.
3. Choose **New extension**, then **Visual Studio Code**.
4. Upload `diagram-as-code-vscode-0.3.0.vsix` from the GitHub Release.
5. Review the listing and make it public.

The first release is deliberately manual. Do not add a Marketplace personal
access token to this repository or its workflow files.

## Verification

1. Search for `Diagram as Code` in VS Code.
2. Confirm ID `phuongnam.diagram-as-code-vscode` and version `0.3.0`.
3. Install it in a clean VS Code profile.
4. Configure `http://localhost:9000` and set the API key through
   `Diagram: Set Gateway API Key`.
5. Verify Preview, save-triggered preview refresh, and explicit SVG Export.

## Rollback

- Unpublish only for a security or data-loss issue.
- For normal defects, publish a higher patch version; never overwrite a released version.
- A user can temporarily reinstall a previously downloaded VSIX with
  `code --install-extension "D:\Downloads\diagram-as-code-vscode-0.1.0.vsix" --force`.
