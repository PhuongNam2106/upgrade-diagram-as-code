Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-DiagramPlatform {
    [CmdletBinding()]
    param()

    if ($env:OS -ne "Windows_NT") {
        throw "Diagram as Code Server installer supports Windows only"
    }
    if ($PSVersionTable.PSVersion -lt [Version]"5.1") {
        throw "PowerShell 5.1 or newer is required"
    }
}

function New-DiagramApiKey {
    [CmdletBinding()]
    param()

    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }

    return [Convert]::ToBase64String($bytes)
}

function Get-DiagramServerPaths {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$StateRoot)

    $root = [IO.Path]::GetFullPath($StateRoot)
    return [PSCustomObject]@{
        StateRoot = $root
        EnvFile = Join-Path $root ".env"
        ComposeFile = Join-Path $root "docker-compose.yml"
        ManifestFile = Join-Path $root "server-manifest.json"
        BackupsDirectory = Join-Path $root "backups"
    }
}

function Read-DiagramServerManifest {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Server manifest was not found: $Path"
    }

    $manifest = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1) {
        throw "Unsupported server manifest schemaVersion: $($manifest.schemaVersion)"
    }
    if ($manifest.composeProject -ne "diagram-as-code") {
        throw "composeProject must be diagram-as-code"
    }

    $uri = [Uri]$manifest.gatewayUrl
    if ($uri.Scheme -ne "http" -or $uri.Host -notin @("localhost", "127.0.0.1")) {
        throw "gatewayUrl must use localhost or 127.0.0.1"
    }
    if ($manifest.readinessTimeoutSeconds -lt 1) {
        throw "readinessTimeoutSeconds must be greater than zero"
    }

    foreach ($name in @("gateway", "kroki", "mermaid")) {
        if ([string]::IsNullOrWhiteSpace($manifest.images.$name)) {
            throw "Manifest image '$name' is required"
        }
    }

    return $manifest
}

function Assert-DiagramPackageChecksums {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$PackageRoot)

    $root = [IO.Path]::GetFullPath($PackageRoot).TrimEnd([char[]]@("\", "/"))
    $checksumsPath = Join-Path $root "SHA256SUMS"
    if (-not (Test-Path -LiteralPath $checksumsPath -PathType Leaf)) {
        throw "Package SHA256SUMS was not found"
    }

    foreach ($line in Get-Content -LiteralPath $checksumsPath) {
        if ($line -notmatch "^([0-9a-fA-F]{64})\s{2}(.+)$") {
            throw "Invalid package checksum line"
        }
        $expected = $Matches[1].ToLowerInvariant()
        $name = $Matches[2]
        $target = [IO.Path]::GetFullPath((Join-Path $root $name))
        $rootPrefix = "$root$([IO.Path]::DirectorySeparatorChar)"
        if (-not $target.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Package checksum path escapes the package root"
        }
        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
            throw "Package file was not found: $name"
        }
        $actual = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected) {
            throw "Checksum verification failed for $name"
        }
    }
}

function Read-DiagramEnv {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)

    $values = [ordered]@{}
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $values
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith("#")) {
            continue
        }
        $separator = $line.IndexOf("=")
        if ($separator -lt 1) {
            throw "Invalid environment line in $Path"
        }
        $values[$line.Substring(0, $separator)] = $line.Substring($separator + 1)
    }
    return $values
}

function Write-DiagramEnv {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][Collections.IDictionary]$Values
    )

    $temporaryPath = "$Path.$([Guid]::NewGuid().ToString("N")).tmp"
    try {
        $lines = foreach ($entry in $Values.GetEnumerator()) {
            "$($entry.Key)=$($entry.Value)"
        }
        [IO.File]::WriteAllLines(
            $temporaryPath,
            [string[]]$lines,
            (New-Object Text.UTF8Encoding($false))
        )
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        & icacls.exe $Path /inheritance:r /grant:r "${identity}:(F)" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Could not restrict permissions for $Path"
        }
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Get-DiagramComposeArguments {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string[]]$Command,
        [string]$ProjectName = "diagram-as-code"
    )

    return @(
        "compose", "--project-name", $ProjectName,
        "--env-file", ".env", "-f", "docker-compose.yml"
    ) + $Command
}

function Assert-DiagramPortAvailable {
    [CmdletBinding()]
    param([Parameter(Mandatory)][ValidateRange(1, 65535)][int]$Port)

    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
    try {
        $listener.Start()
    }
    catch {
        throw "Port 127.0.0.1:$Port is already in use"
    }
    finally {
        $listener.Stop()
    }
}

function Copy-DiagramFileAtomic {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Destination
    )

    $temporaryPath = "$Destination.$([Guid]::NewGuid().ToString("N")).tmp"
    try {
        Copy-Item -LiteralPath $Source -Destination $temporaryPath
        Move-Item -LiteralPath $temporaryPath -Destination $Destination -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Wait-DiagramReady {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][ValidateRange(1, 3600)][int]$TimeoutSeconds
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/ready" -TimeoutSec 5
            if ($response.StatusCode -eq 200) {
                return
            }
        }
        catch {
            if ([DateTime]::UtcNow -lt $deadline) {
                Start-Sleep -Seconds 2
            }
        }
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "Diagram as Code Server did not become ready within $TimeoutSeconds seconds"
}

function Assert-DiagramDockerReady {
    [CmdletBinding()]
    param()

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker CLI was not found. Install and start Docker Desktop."
    }

    & docker version --format "{{.Server.Version}}" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Desktop is not ready"
    }
    & docker compose version 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose v2 is required"
    }
}

function Invoke-DiagramDocker {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$WorkingDirectory
    )

    Push-Location $WorkingDirectory
    try {
        $previousErrorActionPreference = $ErrorActionPreference
        $nativePreference = Get-Variable `
            -Name PSNativeCommandUseErrorActionPreference `
            -ErrorAction SilentlyContinue
        $previousNativePreference = if ($null -ne $nativePreference) {
            $nativePreference.Value
        }
        else {
            $null
        }
        $output = @()
        $exitCode = -1
        try {
            $ErrorActionPreference = "Continue"
            if ($null -ne $nativePreference) {
                Set-Variable -Name PSNativeCommandUseErrorActionPreference -Value $false
            }
            $output = @(& docker @Arguments 2>&1)
            $exitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
            if ($null -ne $nativePreference) {
                Set-Variable `
                    -Name PSNativeCommandUseErrorActionPreference `
                    -Value $previousNativePreference
            }
        }

        $outputText = @($output | ForEach-Object { $_.ToString() })
        if ($exitCode -ne 0) {
            throw "Docker command failed: $($outputText -join [Environment]::NewLine)"
        }
        return $outputText
    }
    finally {
        Pop-Location
    }
}

function Install-DiagramServer {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$PackageRoot,
        [Parameter(Mandatory)][string]$StateRoot
    )

    Assert-DiagramPlatform
    $resolvedPackageRoot = [IO.Path]::GetFullPath($PackageRoot)
    Assert-DiagramPackageChecksums -PackageRoot $resolvedPackageRoot
    $manifestPath = Join-Path $resolvedPackageRoot "server-manifest.json"
    $manifest = Read-DiagramServerManifest -Path $manifestPath
    $sourceCompose = Join-Path $resolvedPackageRoot "docker-compose.yml"
    if (-not (Test-Path -LiteralPath $sourceCompose -PathType Leaf)) {
        throw "Package docker-compose.yml was not found"
    }

    Assert-DiagramDockerReady
    $paths = Get-DiagramServerPaths -StateRoot $StateRoot
    $hasExistingEnv = Test-Path -LiteralPath $paths.EnvFile -PathType Leaf
    if (-not $hasExistingEnv) {
        Assert-DiagramPortAvailable -Port ([Uri]$manifest.gatewayUrl).Port
    }

    $existingValues = if ($hasExistingEnv) {
        Read-DiagramEnv -Path $paths.EnvFile
    }
    else {
        [ordered]@{}
    }
    if ($hasExistingEnv -and [string]::IsNullOrWhiteSpace($existingValues["DIAGRAM_API_KEYS"])) {
        throw "Existing .env is corrupt: DIAGRAM_API_KEYS is missing"
    }
    $apiKeys = if ($hasExistingEnv) {
        [string]$existingValues["DIAGRAM_API_KEYS"]
    }
    else {
        New-DiagramApiKey
    }

    New-Item -ItemType Directory -Path $paths.StateRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $paths.BackupsDirectory -Force | Out-Null
    Copy-DiagramFileAtomic -Source $sourceCompose -Destination $paths.ComposeFile
    Copy-DiagramFileAtomic -Source $manifestPath -Destination $paths.ManifestFile

    $values = [ordered]@{
        DIAGRAM_API_KEYS = $apiKeys
        GATEWAY_IMAGE = [string]$manifest.images.gateway
        KROKI_IMAGE = [string]$manifest.images.kroki
        MERMAID_IMAGE = [string]$manifest.images.mermaid
        GATEWAY_PORT = "9000"
    }
    Write-DiagramEnv -Path $paths.EnvFile -Values $values
    $arguments = Get-DiagramComposeArguments -Command @("up", "-d", "--pull", "always")
    Invoke-DiagramDocker -Arguments $arguments -WorkingDirectory $paths.StateRoot | Out-Null
    Wait-DiagramReady `
        -BaseUrl ([string]$manifest.gatewayUrl) `
        -TimeoutSeconds ([int]$manifest.readinessTimeoutSeconds)

    return [PSCustomObject]@{
        GatewayUrl = [string]$manifest.gatewayUrl
        ApiKey = $apiKeys.Split(",")[0]
        Status = "Ready"
        ProductVersion = [string]$manifest.productVersion
        StateRoot = $paths.StateRoot
    }
}

function Get-DiagramInstalledState {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$StateRoot)

    $paths = Get-DiagramServerPaths -StateRoot $StateRoot
    foreach ($path in @($paths.EnvFile, $paths.ComposeFile, $paths.ManifestFile)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Diagram as Code Server is not installed: missing $path"
        }
    }
    return [PSCustomObject]@{
        Paths = $paths
        Manifest = Read-DiagramServerManifest -Path $paths.ManifestFile
    }
}

function Get-DiagramServerStatus {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$StateRoot)

    $state = Get-DiagramInstalledState -StateRoot $StateRoot
    $arguments = Get-DiagramComposeArguments -Command @("ps", "--format", "json")
    $dockerOutput = @(Invoke-DiagramDocker -Arguments $arguments -WorkingDirectory $state.Paths.StateRoot)
    $text = ($dockerOutput -join [Environment]::NewLine).Trim()
    $services = @()
    if ($text) {
        if ($text.StartsWith("[")) {
            $services = @(ConvertFrom-Json $text)
        }
        else {
            $services = @($dockerOutput | Where-Object { $_ } | ForEach-Object { ConvertFrom-Json $_ })
        }
    }
    $running = @($services | Where-Object {
        $_.Service -eq "gateway" -and $_.State -eq "running"
    }).Count -gt 0

    $ready = $false
    if ($running) {
        try {
            $response = Invoke-WebRequest `
                -UseBasicParsing `
                -Uri "$($state.Manifest.gatewayUrl)/ready" `
                -TimeoutSec 5
            $ready = $response.StatusCode -eq 200
        }
        catch {
            $ready = $false
        }
    }

    return [PSCustomObject]@{
        Running = $running
        Ready = $ready
        GatewayUrl = [string]$state.Manifest.gatewayUrl
        ProductVersion = [string]$state.Manifest.productVersion
    }
}

function Get-DiagramServerLogs {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$StateRoot,
        [ValidateRange(1, 10000)][int]$Tail = 200
    )

    $state = Get-DiagramInstalledState -StateRoot $StateRoot
    $arguments = Get-DiagramComposeArguments -Command @(
        "logs", "--no-color", "--tail", [string]$Tail
    )
    return Invoke-DiagramDocker -Arguments $arguments -WorkingDirectory $state.Paths.StateRoot
}

function Restart-DiagramServer {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$StateRoot)

    $state = Get-DiagramInstalledState -StateRoot $StateRoot
    $arguments = Get-DiagramComposeArguments -Command @("restart")
    Invoke-DiagramDocker -Arguments $arguments -WorkingDirectory $state.Paths.StateRoot | Out-Null
    Wait-DiagramReady `
        -BaseUrl ([string]$state.Manifest.gatewayUrl) `
        -TimeoutSeconds ([int]$state.Manifest.readinessTimeoutSeconds)
    return [PSCustomObject]@{
        GatewayUrl = [string]$state.Manifest.gatewayUrl
        Status = "Ready"
    }
}

function Rotate-DiagramServerKey {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$StateRoot,
        [switch]$Finalize
    )

    $state = Get-DiagramInstalledState -StateRoot $StateRoot
    $values = Read-DiagramEnv -Path $state.Paths.EnvFile
    $configuredKeys = [string]$values["DIAGRAM_API_KEYS"]
    $keys = @($configuredKeys.Split(",") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($keys.Count -eq 0) {
        throw "No API key is configured"
    }

    if ($Finalize) {
        $values["DIAGRAM_API_KEYS"] = $keys[0]
    }
    else {
        $values["DIAGRAM_API_KEYS"] = "$(New-DiagramApiKey),$($keys[0])"
    }

    Write-DiagramEnv -Path $state.Paths.EnvFile -Values $values
    Restart-DiagramServer -StateRoot $state.Paths.StateRoot | Out-Null
    return [PSCustomObject]@{
        Rotated = $true
        Finalized = [bool]$Finalize
    }
}

function Uninstall-DiagramServer {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$StateRoot,
        [switch]$Purge
    )

    $paths = Get-DiagramServerPaths -StateRoot $StateRoot
    if (
        (Test-Path -LiteralPath $paths.EnvFile -PathType Leaf) -and
        (Test-Path -LiteralPath $paths.ComposeFile -PathType Leaf)
    ) {
        $arguments = Get-DiagramComposeArguments -Command @("down", "--remove-orphans")
        Invoke-DiagramDocker -Arguments $arguments -WorkingDirectory $paths.StateRoot | Out-Null
    }

    if ($Purge) {
        $allowedRoot = [IO.Path]::GetFullPath(
            (Join-Path $env:LOCALAPPDATA "DiagramAsCode")
        ).TrimEnd([char[]]@("\", "/"))
        $allowedPrefix = "$allowedRoot$([IO.Path]::DirectorySeparatorChar)"
        if (-not $paths.StateRoot.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to purge state outside $allowedRoot"
        }
        if (Test-Path -LiteralPath $paths.StateRoot) {
            Remove-Item -LiteralPath $paths.StateRoot -Recurse -Force
        }
    }

    return [PSCustomObject]@{
        Removed = $true
        Purged = [bool]$Purge
        StateRoot = $paths.StateRoot
    }
}

function Get-DiagramReleasePackage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidatePattern("^\d+\.\d+\.\d+$")]
        [string]$Version,
        [Parameter(Mandatory)][string]$DestinationRoot,
        [string]$Repository = "PhuongNam2106/upgrade-diagram-as-code"
    )

    $tag = "product-v$Version"
    $fileName = "diagram-as-code-server-$Version.zip"
    $baseUrl = "https://github.com/$Repository/releases/download/$tag"
    $zipPath = Join-Path $DestinationRoot $fileName
    $checksumsPath = Join-Path $DestinationRoot "SHA256SUMS"
    $packageRoot = Join-Path $DestinationRoot "package"
    New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$fileName" -OutFile $zipPath
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHA256SUMS" -OutFile $checksumsPath

    $escapedName = [Regex]::Escape($fileName)
    $checksumLine = Get-Content -LiteralPath $checksumsPath |
        Where-Object { $_ -match "\s+$escapedName$" } |
        Select-Object -First 1
    if (-not $checksumLine) {
        throw "SHA256SUMS does not contain $fileName"
    }
    $expected = ($checksumLine -split "\s+")[0].ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        throw "Checksum verification failed for $fileName"
    }

    Expand-Archive -LiteralPath $zipPath -DestinationPath $packageRoot -Force
    return $packageRoot
}

function Assert-DiagramReleaseHealthy {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][string]$ApiKey
    )

    foreach ($path in @("/health", "/ready")) {
        $response = Invoke-WebRequest `
            -UseBasicParsing `
            -Uri "$BaseUrl$path" `
            -TimeoutSec 10
        if ($response.StatusCode -ne 200) {
            throw "Gateway probe failed: $path"
        }
    }

    $sources = [ordered]@{
        mermaid = "graph TD; A-->B"
        plantuml = "@startuml`nA -> B`n@enduml"
        graphviz = "digraph G { A -> B }"
        d2 = "A -> B"
    }
    $headers = @{ Authorization = "Bearer $ApiKey" }
    foreach ($entry in $sources.GetEnumerator()) {
        $body = [ordered]@{
            type = $entry.Key
            format = "svg"
            source = $entry.Value
        } | ConvertTo-Json -Compress
        $response = Invoke-WebRequest `
            -UseBasicParsing `
            -Method Post `
            -Uri "$BaseUrl/v1/render" `
            -Headers $headers `
            -ContentType "application/json" `
            -Body $body `
            -TimeoutSec 20
        if ($response.StatusCode -ne 200 -or $response.Content -notmatch "<svg") {
            throw "Renderer smoke test failed: $($entry.Key)"
        }
    }
}

function Update-DiagramServerPackage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$PackageRoot,
        [Parameter(Mandatory)][string]$StateRoot
    )

    $resolvedPackageRoot = [IO.Path]::GetFullPath($PackageRoot)
    Assert-DiagramPackageChecksums -PackageRoot $resolvedPackageRoot
    $state = Get-DiagramInstalledState -StateRoot $StateRoot
    $newManifestPath = Join-Path $resolvedPackageRoot "server-manifest.json"
    $newComposePath = Join-Path $resolvedPackageRoot "docker-compose.yml"
    $newManifest = Read-DiagramServerManifest -Path $newManifestPath
    if (-not (Test-Path -LiteralPath $newComposePath -PathType Leaf)) {
        throw "Update package docker-compose.yml was not found"
    }

    $values = Read-DiagramEnv -Path $state.Paths.EnvFile
    $apiKeys = [string]$values["DIAGRAM_API_KEYS"]
    if ([string]::IsNullOrWhiteSpace($apiKeys)) {
        throw "Existing .env is corrupt: DIAGRAM_API_KEYS is missing"
    }

    $backupName = [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssfffZ")
    $backupRoot = Join-Path $state.Paths.BackupsDirectory $backupName
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    Copy-Item -LiteralPath $state.Paths.EnvFile -Destination (Join-Path $backupRoot ".env")
    Copy-Item -LiteralPath $state.Paths.ComposeFile -Destination (Join-Path $backupRoot "docker-compose.yml")
    Copy-Item -LiteralPath $state.Paths.ManifestFile -Destination (Join-Path $backupRoot "server-manifest.json")

    try {
        Copy-DiagramFileAtomic -Source $newComposePath -Destination $state.Paths.ComposeFile
        Copy-DiagramFileAtomic -Source $newManifestPath -Destination $state.Paths.ManifestFile
        $newValues = [ordered]@{
            DIAGRAM_API_KEYS = $apiKeys
            GATEWAY_IMAGE = [string]$newManifest.images.gateway
            KROKI_IMAGE = [string]$newManifest.images.kroki
            MERMAID_IMAGE = [string]$newManifest.images.mermaid
            GATEWAY_PORT = "9000"
        }
        Write-DiagramEnv -Path $state.Paths.EnvFile -Values $newValues

        $arguments = Get-DiagramComposeArguments -Command @("up", "-d", "--pull", "always")
        Invoke-DiagramDocker -Arguments $arguments -WorkingDirectory $state.Paths.StateRoot | Out-Null
        Wait-DiagramReady `
            -BaseUrl ([string]$newManifest.gatewayUrl) `
            -TimeoutSeconds ([int]$newManifest.readinessTimeoutSeconds)
        Assert-DiagramReleaseHealthy `
            -BaseUrl ([string]$newManifest.gatewayUrl) `
            -ApiKey $apiKeys.Split(",")[0]

        return [PSCustomObject]@{
            ProductVersion = [string]$newManifest.productVersion
            GatewayUrl = [string]$newManifest.gatewayUrl
            Status = "Ready"
            BackupRoot = $backupRoot
        }
    }
    catch {
        $updateError = $_.Exception.Message
        try {
            Copy-DiagramFileAtomic -Source (Join-Path $backupRoot ".env") -Destination $state.Paths.EnvFile
            Copy-DiagramFileAtomic -Source (Join-Path $backupRoot "docker-compose.yml") -Destination $state.Paths.ComposeFile
            Copy-DiagramFileAtomic -Source (Join-Path $backupRoot "server-manifest.json") -Destination $state.Paths.ManifestFile
            $rollbackArguments = Get-DiagramComposeArguments -Command @("up", "-d")
            Invoke-DiagramDocker `
                -Arguments $rollbackArguments `
                -WorkingDirectory $state.Paths.StateRoot | Out-Null
            Wait-DiagramReady `
                -BaseUrl ([string]$state.Manifest.gatewayUrl) `
                -TimeoutSeconds ([int]$state.Manifest.readinessTimeoutSeconds)
        }
        catch {
            throw "Update failed and rollback also failed. Update error: $updateError. Rollback error: $($_.Exception.Message)"
        }
        throw "Update failed and the previous Diagram as Code Server version was rolled back: $updateError"
    }
}

function Update-DiagramServer {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidatePattern("^\d+\.\d+\.\d+$")]
        [string]$Version,
        [Parameter(Mandatory)][string]$StateRoot
    )

    $downloadRoot = Join-Path `
        ([IO.Path]::GetTempPath()) `
        ("diagram-update-" + [Guid]::NewGuid().ToString("N"))
    try {
        $packageRoot = Get-DiagramReleasePackage `
            -Version $Version `
            -DestinationRoot $downloadRoot
        return Update-DiagramServerPackage `
            -PackageRoot $packageRoot `
            -StateRoot $StateRoot
    }
    finally {
        if (Test-Path -LiteralPath $downloadRoot) {
            Remove-Item -LiteralPath $downloadRoot -Recurse -Force
        }
    }
}

Export-ModuleMember -Function @(
    "Assert-DiagramPackageChecksums",
    "Assert-DiagramDockerReady",
    "Assert-DiagramPlatform",
    "Assert-DiagramPortAvailable",
    "Assert-DiagramReleaseHealthy",
    "Copy-DiagramFileAtomic",
    "Get-DiagramComposeArguments",
    "Get-DiagramReleasePackage",
    "Get-DiagramServerLogs",
    "Get-DiagramServerPaths",
    "Get-DiagramServerStatus",
    "Invoke-DiagramDocker",
    "Install-DiagramServer",
    "New-DiagramApiKey",
    "Read-DiagramEnv",
    "Read-DiagramServerManifest",
    "Restart-DiagramServer",
    "Rotate-DiagramServerKey",
    "Uninstall-DiagramServer",
    "Update-DiagramServer",
    "Update-DiagramServerPackage",
    "Wait-DiagramReady",
    "Write-DiagramEnv"
)
