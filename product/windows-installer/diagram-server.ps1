[CmdletBinding()]
param(
    [Parameter(Position = 0, Mandatory)]
    [ValidateSet("install", "status", "logs", "restart", "update", "show-key", "rotate-key", "uninstall")]
    [string]$Command,
    [string]$Version,
    [ValidateRange(1, 10000)][int]$Tail = 200,
    [switch]$Finalize,
    [switch]$Purge,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "DiagramAsCode\server")
)

$ErrorActionPreference = "Stop"
Import-Module `
    (Join-Path $PSScriptRoot "DiagramServer.psm1") `
    -Force `
    -DisableNameChecking

switch ($Command) {
    "install" {
        $result = Install-DiagramServer -PackageRoot $PSScriptRoot -StateRoot $StateRoot
        Write-Output "Gateway URL: $($result.GatewayUrl)"
        Write-Output "API key: $($result.ApiKey)"
        Write-Output "Status: $($result.Status)"
    }
    "status" {
        Get-DiagramServerStatus -StateRoot $StateRoot
    }
    "logs" {
        Get-DiagramServerLogs -StateRoot $StateRoot -Tail $Tail
    }
    "restart" {
        Restart-DiagramServer -StateRoot $StateRoot
    }
    "update" {
        if ([string]::IsNullOrWhiteSpace($Version)) {
            throw "update requires a semantic version, for example -Version 0.2.1"
        }
        Update-DiagramServer -Version $Version -StateRoot $StateRoot
    }
    "show-key" {
        $envPath = Join-Path $StateRoot ".env"
        $values = Read-DiagramEnv -Path $envPath
        $configured = [string]$values["DIAGRAM_API_KEYS"]
        if ([string]::IsNullOrWhiteSpace($configured)) {
            throw "No API key is configured in $envPath"
        }
        Write-Output $configured.Split(",")[0]
    }
    "rotate-key" {
        $result = Rotate-DiagramServerKey -StateRoot $StateRoot -Finalize:$Finalize
        if ($Finalize) {
            Write-Output "API key rotation finalized. The previous key is no longer accepted."
        }
        else {
            $values = Read-DiagramEnv -Path (Join-Path $StateRoot ".env")
            Write-Output "New API key: $($values["DIAGRAM_API_KEYS"].Split(",")[0])"
            Write-Output "Update clients, then run rotate-key -Finalize."
        }
        $result
    }
    "uninstall" {
        Uninstall-DiagramServer -StateRoot $StateRoot -Purge:$Purge
    }
}
