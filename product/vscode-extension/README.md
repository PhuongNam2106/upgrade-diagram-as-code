# Diagram as Code for VS Code

The extension previews `.mmd`, `.puml`, `.dot`, and `.d2` files through a configured Diagram as Code Gateway and exports one canonical SVG per source.

## Commands

- `Diagram: Open Preview` opens a live preview beside the editor.
- `Diagram: Export SVG` writes the stable output path from `.diagramrc.yml`.
- `Diagram: Set Gateway API Key` stores the key in VS Code SecretStorage.

Preview waits for the configured debounce interval, cancels superseded requests, and reuses a matching render when exporting. Saving does not download or create an SVG; export remains an explicit command.

## Project configuration

Add `.diagramrc.yml` at the workspace root. See `product/.diagramrc.example.yml` in the repository. The API key can come from the configured environment variable or VS Code SecretStorage.
