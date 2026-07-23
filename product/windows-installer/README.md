# Diagram as Code Server for Windows

This package installs the Diagram as Code Gateway, Kroki, and the Mermaid
companion service through Docker Desktop. It does not install Docker itself.

## Prerequisites

- Windows 10 or Windows 11.
- Windows PowerShell 5.1 or PowerShell 7.
- Docker Desktop installed, started, and configured for Linux containers.
- Port `127.0.0.1:9000` available.

## Install

Extract the ZIP, open PowerShell in the extracted directory, and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\diagram-server.ps1 install
```

Successful installation prints the Gateway URL, generated API key, and
`Status: Ready`. Do not share or commit the API key.

## Configure VS Code

1. Set the project Gateway URL to `http://localhost:9000` in `.diagramrc.yml`.
2. Run `Diagram: Set Gateway API Key` in VS Code.
3. Enter the key printed by `install`. Retrieve it later with:

```powershell
.\diagram-server.ps1 show-key
```

The extension stores the key in VS Code SecretStorage.

## Commands

| Command | Purpose |
| --- | --- |
| `install` | Install or repair the pinned local stack without changing the existing key. |
| `status` | Show the running and readiness state. |
| `logs -Tail 200` | Show recent container logs. |
| `restart` | Restart the managed stack and wait for readiness. |
| `update -Version 0.2.1` | Download, verify, apply, and health-check a release. |
| `show-key` | Print the newest configured API key. |
| `rotate-key` | Add a new key while retaining the previous key temporarily. |
| `rotate-key -Finalize` | Remove the previous key after clients have been updated. |
| `uninstall` | Remove managed containers and network while retaining local state. |
| `uninstall -Purge` | Also remove the local state directory. |

State is stored in `%LOCALAPPDATA%\DiagramAsCode\server`.

## Troubleshooting

- **Docker CLI not found:** install Docker Desktop and reopen PowerShell.
- **Docker Desktop is not ready:** start Docker Desktop and wait for its engine.
- **Port 9000 is in use:** stop the process or older Diagram as Code stack using it.
- **Readiness timeout:** run `.\diagram-server.ps1 logs -Tail 300`.
- **Update failure:** the installer restores the previous configuration and image tag.

The Gateway listens only on `127.0.0.1`. A GitHub Action using this local
Gateway must run on a self-hosted runner on the same Windows machine and receive
the API key through the repository secret `DIAGRAM_API_KEY`.
