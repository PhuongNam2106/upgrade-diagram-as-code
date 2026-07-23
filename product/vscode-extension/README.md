# Diagram as Code

Preview Mermaid, PlantUML, Graphviz/DOT, and D2 sources through your self-hosted
Diagram as Code Gateway, then explicitly export deterministic SVGs.

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

The `Preview` and `Export` actions are available in the status bar, editor title,
editor context menu, and Explorer context menu. An active preview also provides
Refresh and Export actions in its title bar.

## Project configuration

Commit `.diagramrc.yml` with source and output directories. Never commit API keys.
The key can come from the configured environment variable or VS Code SecretStorage.

## Upgrade from the test VSIX

Uninstall `diagram-as-code.diagram-as-code-vscode`, then install
`phuongnam.diagram-as-code-vscode` from the Marketplace. Because VS Code
SecretStorage is scoped to the extension ID, enter the Gateway API key again.

## Data and privacy

Diagram source is sent only to the Gateway URL configured by the workspace.
The extension does not send source to the Visual Studio Marketplace or an
analytics service.
