# Windows Server Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cung cấp gói ZIP cho Windows giúp người dùng cài, vận hành, cập nhật và gỡ Diagram as Code Server bằng một lệnh PowerShell, trong khi Docker Desktop chạy Gateway và Kroki ở nền.

**Architecture:** Gói ZIP chứa một command wrapper mỏng, một PowerShell module có thể kiểm thử, Docker Compose đã khóa image và một manifest phiên bản. Dữ liệu bền vững nằm tại `%LOCALAPPDATA%\DiagramAsCode\server`; installer chỉ quản lý Compose project `diagram-as-code`, bind Gateway vào loopback và kiểm tra readiness trước khi báo thành công.

**Tech Stack:** Windows PowerShell 5.1, PowerShell 7, Pester 5.7.1, Docker Desktop, Docker Compose v2, Node.js test runner cho static contract, GitHub Actions Windows runner.

## Global Constraints

- Chỉ hỗ trợ Windows trong bản `0.2.0`; Docker Desktop là điều kiện tiên quyết.
- Gateway chỉ được bind tại `127.0.0.1:9000`; Kroki và Mermaid không publish port ra host.
- API key gồm 32 byte ngẫu nhiên, sinh tại máy người dùng; chỉ hiện trong kết quả tương tác của `install`/`show-key`, không được đưa vào Docker log, verbose log hay repository.
- Cài lại phải giữ API key hiện có; thay key chỉ qua `rotate-key`.
- Update phải sao lưu cấu hình và tự rollback nếu container mới không sẵn sàng.
- Không dùng `docker system prune`, không xóa volume/image/container ngoài Compose project `diagram-as-code`.
- Codex không commit, push, tạo tag, tạo release hay thay đổi GitHub. Mỗi checkpoint Git/GitHub trong kế hoạch do người dùng tự thực hiện.

## File Structure

- `product/windows-installer/DiagramServer.psm1`: toàn bộ logic platform, Docker, install và lifecycle có thể mock/test.
- `product/windows-installer/diagram-server.ps1`: CLI dispatch mỏng cho người dùng cuối.
- `product/windows-installer/README.md`: hướng dẫn đi kèm ZIP.
- `product/windows-installer/test/DiagramServer.Tests.ps1`: Pester unit/behavior tests trên PowerShell 5.1 và 7.
- `product/windows-installer/test/fixtures/server-manifest.json`: manifest cố định cho tests.
- `product/deploy/docker-compose.release.yml`: runtime stack khóa loopback và image qua env.
- `product/scripts/test-windows-installer-contract.mjs`: static Compose safety contract.
- `product/docs/windows-installer-testing.md`: Docker Desktop smoke-test runbook.
- `.github/workflows/product-ci.yml`: Windows unit-test job; không cần Gateway thật.

---

## Task 1: Tạo lõi cấu hình có thể kiểm thử

**Files:**

- Create: `product/windows-installer/DiagramServer.psm1`
- Create: `product/windows-installer/test/DiagramServer.Tests.ps1`
- Create: `product/windows-installer/test/fixtures/server-manifest.json`

**Interfaces:**

- Consumes: server manifest schema version `1` và state root do caller cung cấp.
- Produces: `Assert-DiagramPlatform() -> void`, `Assert-DiagramPackageChecksums(string) -> void`, `New-DiagramApiKey() -> string`, `Get-DiagramServerPaths(string) -> PSCustomObject`, `Read-DiagramServerManifest(string) -> PSCustomObject`.

- [ ] **Step 1: Tạo module rỗng và fixture manifest**

Fixture phải cố định để test không phụ thuộc release hiện tại:

```json
{
  "schemaVersion": 1,
  "productVersion": "0.2.0",
  "composeProject": "diagram-as-code",
  "gatewayUrl": "http://localhost:9000",
  "readinessTimeoutSeconds": 120,
  "images": {
    "gateway": "ghcr.io/phuongnam2106/diagram-as-code-gateway:product-v0.2.0",
    "kroki": "yuzutech/kroki:0.31.1",
    "mermaid": "yuzutech/kroki-mermaid:0.31.1"
  }
}
```

Module ban đầu chỉ có:

```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
```

- [ ] **Step 2: Viết test RED cho key, paths và manifest**

```powershell
BeforeAll {
    $modulePath = Join-Path $PSScriptRoot "..\DiagramServer.psm1"
    Import-Module $modulePath -Force
}

Describe "New-DiagramApiKey" {
    It "returns 32 random bytes encoded as Base64" {
        $first = New-DiagramApiKey
        $second = New-DiagramApiKey

        [Convert]::FromBase64String($first).Length | Should -Be 32
        $first | Should -Not -Be $second
    }
}

Describe "Assert-DiagramPlatform" {
    It "accepts Windows PowerShell 5.1 or newer" -Skip:($env:OS -ne "Windows_NT") {
        { Assert-DiagramPlatform } | Should -Not -Throw
    }
}

Describe "Get-DiagramServerPaths" {
    It "keeps all managed state below the requested root" {
        $paths = Get-DiagramServerPaths -StateRoot $TestDrive

        $paths.EnvFile | Should -Be (Join-Path $TestDrive ".env")
        $paths.ComposeFile | Should -Be (Join-Path $TestDrive "docker-compose.yml")
        $paths.ManifestFile | Should -Be (Join-Path $TestDrive "server-manifest.json")
        $paths.BackupsDirectory | Should -Be (Join-Path $TestDrive "backups")
    }
}

Describe "Read-DiagramServerManifest" {
    It "accepts the supported schema" {
        $path = Join-Path $PSScriptRoot "fixtures\server-manifest.json"
        $manifest = Read-DiagramServerManifest -Path $path

        $manifest.schemaVersion | Should -Be 1
        $manifest.composeProject | Should -Be "diagram-as-code"
    }

    It "rejects a non-loopback gateway URL" {
        $path = Join-Path $TestDrive "invalid.json"
        '{"schemaVersion":1,"productVersion":"0.2.0","composeProject":"diagram-as-code","gatewayUrl":"http://0.0.0.0:9000","readinessTimeoutSeconds":120,"images":{"gateway":"g","kroki":"k","mermaid":"m"}}' | Set-Content $path

        { Read-DiagramServerManifest -Path $path } |
            Should -Throw "*gatewayUrl must use localhost or 127.0.0.1*"
    }
}

Describe "Assert-DiagramPackageChecksums" {
    It "rejects a modified package file" {
        $root = Join-Path $TestDrive "package"
        New-Item -ItemType Directory -Path $root | Out-Null
        "original" | Set-Content (Join-Path $root "docker-compose.yml") -NoNewline
        $hash = (Get-FileHash (Join-Path $root "docker-compose.yml") -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  docker-compose.yml" | Set-Content (Join-Path $root "SHA256SUMS")
        "modified" | Set-Content (Join-Path $root "docker-compose.yml") -NoNewline

        { Assert-DiagramPackageChecksums -PackageRoot $root } |
            Should -Throw "*Checksum verification failed for docker-compose.yml*"
    }
}
```

- [ ] **Step 3: Chạy test để xác nhận RED**

Run:

```powershell
Invoke-Pester .\product\windows-installer\test\DiagramServer.Tests.ps1 -Output Detailed
```

Expected: fail vì `Assert-DiagramPlatform`, `New-DiagramApiKey`, `Get-DiagramServerPaths` và `Read-DiagramServerManifest` chưa tồn tại.

- [ ] **Step 4: Implement ba hàm lõi**

```powershell
function Assert-DiagramPlatform {
    [CmdletBinding()]
    param()

    $isWindowsPlatform = $env:OS -eq "Windows_NT"
    if (-not $isWindowsPlatform) { throw "Diagram as Code Server installer supports Windows only" }
    if ($PSVersionTable.PSVersion -lt [Version]"5.1") { throw "PowerShell 5.1 or newer is required" }
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
        StateRoot       = $root
        EnvFile         = Join-Path $root ".env"
        ComposeFile     = Join-Path $root "docker-compose.yml"
        ManifestFile    = Join-Path $root "server-manifest.json"
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

    $root = [IO.Path]::GetFullPath($PackageRoot).TrimEnd("\", "/")
    $checksumsPath = Join-Path $root "SHA256SUMS"
    if (-not (Test-Path -LiteralPath $checksumsPath -PathType Leaf)) {
        throw "Package SHA256SUMS was not found"
    }

    foreach ($line in Get-Content -LiteralPath $checksumsPath) {
        if ($line -notmatch "^([0-9a-fA-F]{64})\s{2}(.+)$") { throw "Invalid package checksum line" }
        $expected = $Matches[1].ToLowerInvariant()
        $name = $Matches[2]
        $target = [IO.Path]::GetFullPath((Join-Path $root $name))
        if (-not $target.StartsWith("$root$([IO.Path]::DirectorySeparatorChar)", [StringComparison]::OrdinalIgnoreCase)) {
            throw "Package checksum path escapes the package root"
        }
        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Package file was not found: $name" }
        $actual = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected) { throw "Checksum verification failed for $name" }
    }
}

Export-ModuleMember -Function Assert-DiagramPlatform, Assert-DiagramPackageChecksums, New-DiagramApiKey, Get-DiagramServerPaths, Read-DiagramServerManifest
```

- [ ] **Step 5: Chạy test GREEN trên Windows PowerShell và PowerShell 7**

Run:

```powershell
powershell -NoLogo -NoProfile -Command "Invoke-Pester .\product\windows-installer\test\DiagramServer.Tests.ps1 -Output Detailed"
pwsh -NoLogo -NoProfile -Command "Invoke-Pester .\product\windows-installer\test\DiagramServer.Tests.ps1 -Output Detailed"
```

Expected: cả hai tiến trình pass.

- [ ] **Step 6: Checkpoint Git thủ công**

Người dùng tự review và commit các file của Task 1. Codex không chạy lệnh Git ghi dữ liệu.

---

## Task 2: Cài đặt idempotent và kiểm tra readiness

**Files:**

- Modify: `product/windows-installer/DiagramServer.psm1`
- Modify: `product/windows-installer/test/DiagramServer.Tests.ps1`

**Interfaces:**

- Consumes: ba hàm lõi của Task 1, package root có `docker-compose.yml` và `server-manifest.json`.
- Produces: `Read-DiagramEnv`, `Write-DiagramEnv`, `Assert-DiagramDockerReady`, `Assert-DiagramPortAvailable`, `Invoke-DiagramDocker`, `Wait-DiagramReady`, `Get-DiagramComposeArguments`, `Copy-DiagramFileAtomic`, `Install-DiagramServer`.

- [ ] **Step 1: Viết test RED cho Docker prerequisite, env và install**

Thêm các case sau; mọi call Docker và HTTP đều được mock:

```powershell
Describe "Install-DiagramServer" {
    BeforeEach {
        $packageRoot = Join-Path $TestDrive "package"
        $stateRoot = Join-Path $TestDrive "state"
        New-Item -ItemType Directory -Path $packageRoot | Out-Null
        Copy-Item (Join-Path $PSScriptRoot "fixtures\server-manifest.json") (Join-Path $packageRoot "server-manifest.json")
        "services: {}" | Set-Content (Join-Path $packageRoot "docker-compose.yml")

        Mock Assert-DiagramDockerReady {}
        Mock Assert-DiagramPackageChecksums {}
        Mock Assert-DiagramPortAvailable {}
        Mock Invoke-DiagramDocker { "ok" }
        Mock Wait-DiagramReady {}
    }

    It "creates managed files and starts the fixed compose project" {
        $result = Install-DiagramServer -PackageRoot $packageRoot -StateRoot $stateRoot

        Test-Path (Join-Path $stateRoot ".env") | Should -BeTrue
        Test-Path (Join-Path $stateRoot "docker-compose.yml") | Should -BeTrue
        Test-Path (Join-Path $stateRoot "server-manifest.json") | Should -BeTrue
        $result.GatewayUrl | Should -Be "http://localhost:9000"
        [Convert]::FromBase64String($result.ApiKey).Length | Should -Be 32
        Should -Invoke Invoke-DiagramDocker -ParameterFilter {
            $Arguments -join " " -eq "compose --project-name diagram-as-code --env-file .env -f docker-compose.yml up -d --pull always"
        }
    }

    It "preserves the API key when install is run again" {
        Install-DiagramServer -PackageRoot $packageRoot -StateRoot $stateRoot | Out-Null
        $first = (Get-Content (Join-Path $stateRoot ".env") | Where-Object { $_ -like "DIAGRAM_API_KEYS=*" })

        Install-DiagramServer -PackageRoot $packageRoot -StateRoot $stateRoot | Out-Null
        $second = (Get-Content (Join-Path $stateRoot ".env") | Where-Object { $_ -like "DIAGRAM_API_KEYS=*" })

        $second | Should -Be $first
    }

    It "fails before writing state when Docker Desktop is unavailable" {
        Mock Assert-DiagramDockerReady { throw "Docker Desktop is not ready" }

        { Install-DiagramServer -PackageRoot $packageRoot -StateRoot $stateRoot } |
            Should -Throw "Docker Desktop is not ready"
        Test-Path $stateRoot | Should -BeFalse
    }

    It "does not overwrite a corrupt existing env file" {
        New-Item -ItemType Directory -Path $stateRoot | Out-Null
        "GATEWAY_PORT=9000" | Set-Content (Join-Path $stateRoot ".env")

        { Install-DiagramServer -PackageRoot $packageRoot -StateRoot $stateRoot } |
            Should -Throw "*DIAGRAM_API_KEYS is missing*"
        Get-Content (Join-Path $stateRoot ".env") -Raw | Should -Not -Match "DIAGRAM_API_KEYS="
    }
}
```

Thêm test trực tiếp cho `Read-DiagramEnv` và `Write-DiagramEnv`: chỉ chấp nhận `NAME=value`, giữ dấu `=` bên trong value, ghi UTF-8 không BOM và không đưa key ra output.

- [ ] **Step 2: Chạy test RED**

Run:

```powershell
pwsh -NoLogo -NoProfile -Command "Invoke-Pester .\product\windows-installer\test\DiagramServer.Tests.ps1 -Output Detailed"
```

Expected: fail vì nhóm hàm install chưa tồn tại.

- [ ] **Step 3: Implement prerequisite và env helpers**

Thêm đúng các interface:

```powershell
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

function Read-DiagramEnv {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)

    $values = [ordered]@{}
    if (-not (Test-Path -LiteralPath $Path)) { return $values }
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith("#")) { continue }
        $separator = $line.IndexOf("=")
        if ($separator -lt 1) { throw "Invalid environment line in $Path" }
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

    $temporaryPath = "$Path.tmp"
    $lines = foreach ($entry in $Values.GetEnumerator()) { "$($entry.Key)=$($entry.Value)" }
    [IO.File]::WriteAllLines($temporaryPath, $lines, (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $Path /inheritance:r /grant:r "${identity}:(R,W)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not restrict permissions for $Path" }
}
```

`Write-DiagramEnv` không được dùng `Write-Host` hoặc trả về `$Values`.

- [ ] **Step 4: Implement port, Docker và readiness helpers**

```powershell
function Assert-DiagramPortAvailable {
    [CmdletBinding()]
    param([Parameter(Mandatory)][int]$Port)

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

function Invoke-DiagramDocker {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$WorkingDirectory
    )

    Push-Location $WorkingDirectory
    try {
        $output = & docker @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Docker command failed: $($output -join [Environment]::NewLine)"
        }
        return $output
    }
    finally {
        Pop-Location
    }
}

function Wait-DiagramReady {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][int]$TimeoutSeconds
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/ready" -TimeoutSec 5
            if ($response.StatusCode -eq 200) { return }
        }
        catch {
            Start-Sleep -Seconds 2
        }
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "Diagram as Code Server did not become ready within $TimeoutSeconds seconds"
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
```

- [ ] **Step 5: Implement idempotent install**

`Install-DiagramServer` phải thực hiện theo đúng thứ tự:

1. Gọi `Assert-DiagramPlatform`, `Assert-DiagramPackageChecksums`, resolve package/state paths và đọc package manifest.
2. Gọi `Assert-DiagramDockerReady` trước khi tạo state.
3. Nếu `.env` chưa tồn tại, kiểm tra port `9000`; nếu đã tồn tại thì bỏ port probe để không chặn chính server đang chạy.
4. Tạo state/backups directory.
5. Copy Compose và manifest bằng temp file rồi replace.
6. Đọc key cũ; nếu `.env` chưa tồn tại thì sinh key mới. Nếu `.env` đã tồn tại nhưng thiếu/không parse được `DIAGRAM_API_KEYS`, dừng và không ghi đè.
7. Ghi `.env` từ đúng hashtable sau:

```powershell
$values = [ordered]@{
    DIAGRAM_API_KEYS = $apiKey
    GATEWAY_IMAGE = [string]$manifest.images.gateway
    KROKI_IMAGE = [string]$manifest.images.kroki
    MERMAID_IMAGE = [string]$manifest.images.mermaid
    GATEWAY_PORT = "9000"
}
Write-DiagramEnv -Path $paths.EnvFile -Values $values
```

8. Chạy:

```text
docker compose --project-name diagram-as-code --env-file .env -f docker-compose.yml up -d --pull always
```

9. Gọi `Wait-DiagramReady`.
10. Trả object gồm `GatewayUrl`, `ApiKey`, `Status = "Ready"`, `ProductVersion`, `StateRoot` để người cài cấu hình client; không ghi key vào verbose/Docker log.

Implementation tối thiểu:

```powershell
function Copy-DiagramFileAtomic {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Destination
    )

    $temporaryPath = "$Destination.$([Guid]::NewGuid().ToString("N")).tmp"
    Copy-Item -LiteralPath $Source -Destination $temporaryPath
    Move-Item -LiteralPath $temporaryPath -Destination $Destination -Force
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
    $manifest = Read-DiagramServerManifest -Path (Join-Path $resolvedPackageRoot "server-manifest.json")
    $sourceCompose = Join-Path $resolvedPackageRoot "docker-compose.yml"
    if (-not (Test-Path -LiteralPath $sourceCompose -PathType Leaf)) {
        throw "Package docker-compose.yml was not found"
    }

    Assert-DiagramDockerReady
    $paths = Get-DiagramServerPaths -StateRoot $StateRoot
    $hasExistingEnv = Test-Path -LiteralPath $paths.EnvFile -PathType Leaf
    if (-not $hasExistingEnv) { Assert-DiagramPortAvailable -Port ([Uri]$manifest.gatewayUrl).Port }

    $existingValues = if ($hasExistingEnv) { Read-DiagramEnv -Path $paths.EnvFile } else { [ordered]@{} }
    if ($hasExistingEnv -and [string]::IsNullOrWhiteSpace($existingValues["DIAGRAM_API_KEYS"])) {
        throw "Existing .env is corrupt: DIAGRAM_API_KEYS is missing"
    }
    $apiKey = if ($hasExistingEnv) { [string]$existingValues["DIAGRAM_API_KEYS"] } else { New-DiagramApiKey }

    New-Item -ItemType Directory -Path $paths.StateRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $paths.BackupsDirectory -Force | Out-Null
    Copy-DiagramFileAtomic -Source $sourceCompose -Destination $paths.ComposeFile
    Copy-DiagramFileAtomic -Source (Join-Path $resolvedPackageRoot "server-manifest.json") -Destination $paths.ManifestFile

    $values = [ordered]@{
        DIAGRAM_API_KEYS = $apiKey
        GATEWAY_IMAGE = [string]$manifest.images.gateway
        KROKI_IMAGE = [string]$manifest.images.kroki
        MERMAID_IMAGE = [string]$manifest.images.mermaid
        GATEWAY_PORT = "9000"
    }
    Write-DiagramEnv -Path $paths.EnvFile -Values $values
    $arguments = Get-DiagramComposeArguments -Command @("up", "-d", "--pull", "always")
    Invoke-DiagramDocker -Arguments $arguments -WorkingDirectory $paths.StateRoot | Out-Null
    Wait-DiagramReady -BaseUrl $manifest.gatewayUrl -TimeoutSeconds $manifest.readinessTimeoutSeconds

    return [PSCustomObject]@{
        GatewayUrl = [string]$manifest.gatewayUrl
        ApiKey = $apiKey.Split(",")[0]
        Status = "Ready"
        ProductVersion = [string]$manifest.productVersion
        StateRoot = $paths.StateRoot
    }
}
```

- [ ] **Step 6: Chạy test GREEN**

Run:

```powershell
powershell -NoLogo -NoProfile -Command "Invoke-Pester .\product\windows-installer\test\DiagramServer.Tests.ps1 -Output Detailed"
pwsh -NoLogo -NoProfile -Command "Invoke-Pester .\product\windows-installer\test\DiagramServer.Tests.ps1 -Output Detailed"
```

Expected: pass trên cả hai PowerShell.

- [ ] **Step 7: Checkpoint Git thủ công**

Người dùng tự review và commit Task 2.

---

## Task 3: Thêm status, logs, restart, update, rotate-key và uninstall

**Files:**

- Modify: `product/windows-installer/DiagramServer.psm1`
- Modify: `product/windows-installer/test/DiagramServer.Tests.ps1`

**Interfaces:**

- Consumes: state layout và Docker/readiness helpers của Task 2.
- Produces: `Get-DiagramServerStatus`, `Get-DiagramServerLogs`, `Restart-DiagramServer`, `Get-DiagramReleasePackage`, `Assert-DiagramReleaseHealthy`, `Update-DiagramServerPackage`, `Update-DiagramServer`, `Rotate-DiagramServerKey`, `Uninstall-DiagramServer`.

- [ ] **Step 1: Viết test RED cho các command vận hành**

Các test bắt buộc:

- `Get-DiagramServerStatus` gọi `docker compose --project-name diagram-as-code --env-file .env -f docker-compose.yml ps --format json`, probe `/ready`, trả `Running`, `Ready`, `GatewayUrl`, `ProductVersion`.
- `Restart-DiagramServer` gọi `restart` rồi chờ readiness.
- `Get-DiagramServerLogs -Tail 200` gọi `logs --tail 200` và stream output.
- `Get-DiagramReleasePackage -Version 0.2.1` tải ZIP và `SHA256SUMS` từ GitHub Release `product-v0.2.1`, xác minh checksum rồi giải nén vào thư mục tạm.
- Downloader từ chối version không đúng `x.y.z`, checksum thiếu và checksum sai; không gọi update package trong ba trường hợp này.
- `Update-DiagramServer -Version 0.2.1` tạo backup timestamp gồm `.env`, Compose, manifest; ghi package mới; chạy `up -d --pull always`.
- Update chỉ thành công khi `/health`, `/ready` và render smoke cho Mermaid, PlantUML, Graphviz/DOT, D2 đều pass.
- Nếu readiness của update lỗi, restore cả ba file backup, gọi lại `up -d` với cấu hình cũ và ném lỗi có chữ `rolled back`.
- `Rotate-DiagramServerKey` biến `old` thành `new,old`, restart và không in key.
- `Rotate-DiagramServerKey -Finalize` giữ phần tử đầu tiên `new` rồi restart.
- `Uninstall-DiagramServer` mặc định gọi `down` nhưng giữ state.
- `Uninstall-DiagramServer -Purge` chỉ xóa `StateRoot` sau khi `down` thành công.

Ví dụ assertion cho rollback:

```powershell
It "restores the previous state when an update package is not ready" {
    Mock Wait-DiagramReady { throw "not ready" }

    { Update-DiagramServerPackage -PackageRoot $newPackage -StateRoot $stateRoot } |
        Should -Throw "*rolled back*"
    (Get-Content (Join-Path $stateRoot "server-manifest.json") -Raw) |
        Should -Match '"productVersion": "0.2.0"'
    Should -Invoke Invoke-DiagramDocker -Times 2
}
```

- [ ] **Step 2: Chạy test RED**

Run:

```powershell
pwsh -NoLogo -NoProfile -Command "Invoke-Pester .\product\windows-installer\test\DiagramServer.Tests.ps1 -Output Detailed"
```

Expected: các command lifecycle chưa được định nghĩa.

- [ ] **Step 3: Implement status, logs và restart**

Mọi lifecycle command phải dùng `Get-DiagramComposeArguments` từ Task 2 để không vô tình tác động Compose project khác.

Các interface công khai:

```powershell
Get-DiagramServerStatus -StateRoot "$env:LOCALAPPDATA\DiagramAsCode\server"
Get-DiagramServerLogs -StateRoot "$env:LOCALAPPDATA\DiagramAsCode\server" -Tail 200
Restart-DiagramServer -StateRoot "$env:LOCALAPPDATA\DiagramAsCode\server"
```

Quy tắc:

- Kiểm tra đủ `.env`, Compose và manifest trước khi chạy.
- `Tail` chỉ nhận `1..10000`.
- Status không throw khi readiness probe thất bại; trả `Ready = $false`.
- Restart throw nếu readiness không đạt timeout trong manifest.

- [ ] **Step 4: Implement update có rollback**

Thêm downloader đã kiểm checksum:

```powershell
function Get-DiagramReleasePackage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidatePattern("^\d+\.\d+\.\d+$")][string]$Version,
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

    $checksumLine = Get-Content $checksumsPath | Where-Object { $_ -match "\s+$([Regex]::Escape($fileName))$" } | Select-Object -First 1
    if (-not $checksumLine) { throw "SHA256SUMS does not contain $fileName" }
    $expected = ($checksumLine -split "\s+")[0].ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "Checksum verification failed for $fileName" }

    Expand-Archive -LiteralPath $zipPath -DestinationPath $packageRoot -Force
    return $packageRoot
}
```

Thêm acceptance probe không in key:

```powershell
function Assert-DiagramReleaseHealthy {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][string]$ApiKey
    )

    foreach ($path in @("/health", "/ready")) {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl$path" -TimeoutSec 10
        if ($response.StatusCode -ne 200) { throw "Gateway probe failed: $path" }
    }

    $sources = [ordered]@{
        mermaid = "graph TD; A-->B"
        plantuml = "@startuml`nA -> B`n@enduml"
        graphviz = "digraph G { A -> B }"
        d2 = "A -> B"
    }
    $headers = @{ Authorization = "Bearer $ApiKey" }
    foreach ($entry in $sources.GetEnumerator()) {
        $body = @{ type = $entry.Key; format = "svg"; source = $entry.Value } | ConvertTo-Json -Compress
        $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$BaseUrl/v1/render" -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 20
        if ($response.StatusCode -ne 200 -or $response.Content -notmatch "<svg") {
            throw "Renderer smoke test failed: $($entry.Key)"
        }
    }
}
```

`Update-DiagramServerPackage -PackageRoot -StateRoot` gọi `Assert-DiagramPackageChecksums` trước khi chạm vào state, rồi dùng thư mục backup tên UTC `yyyyMMddTHHmmssfffZ`. Trong `try`, copy package mới, chạy pull/up, gọi `Wait-DiagramReady`, rồi gọi `Assert-DiagramReleaseHealthy` với key hiện tại để probe `/health` và render bốn loại sơ đồ. Trong `catch`, restore file cũ, chạy `up -d`, chờ readiness theo manifest cũ, sau đó throw:

```powershell
throw "Update failed and the previous Diagram as Code Server version was rolled back: $($_.Exception.Message)"
```

Không backup API key ra ngoài `%LOCALAPPDATA%\DiagramAsCode\server\backups`.

Public wrapper tải package rồi luôn dọn temp:

```powershell
function Update-DiagramServer {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidatePattern("^\d+\.\d+\.\d+$")][string]$Version,
        [Parameter(Mandatory)][string]$StateRoot
    )

    $downloadRoot = Join-Path ([IO.Path]::GetTempPath()) ("diagram-update-" + [Guid]::NewGuid().ToString("N"))
    try {
        $packageRoot = Get-DiagramReleasePackage -Version $Version -DestinationRoot $downloadRoot
        return Update-DiagramServerPackage -PackageRoot $packageRoot -StateRoot $StateRoot
    }
    finally {
        if (Test-Path -LiteralPath $downloadRoot) {
            Remove-Item -LiteralPath $downloadRoot -Recurse -Force
        }
    }
}
```

- [ ] **Step 5: Implement rotate-key hai giai đoạn**

```powershell
function Rotate-DiagramServerKey {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$StateRoot,
        [switch]$Finalize
    )

    $paths = Get-DiagramServerPaths -StateRoot $StateRoot
    $values = Read-DiagramEnv -Path $paths.EnvFile
    $keys = @($values["DIAGRAM_API_KEYS"].Split(",") | Where-Object { $_ })
    if ($keys.Count -eq 0) { throw "No API key is configured" }

    if ($Finalize) {
        $values["DIAGRAM_API_KEYS"] = $keys[0]
    }
    else {
        $values["DIAGRAM_API_KEYS"] = "$(New-DiagramApiKey),$($keys[0])"
    }

    Write-DiagramEnv -Path $paths.EnvFile -Values $values
    Restart-DiagramServer -StateRoot $StateRoot | Out-Null
    return [PSCustomObject]@{ Rotated = $true; Finalized = [bool]$Finalize }
}
```

Sau giai đoạn đầu, người dùng cập nhật key mới trong VS Code/GitHub secret. Sau khi xác nhận client hoạt động, chạy `rotate-key -Finalize` để bỏ key cũ. Command không trả key; người dùng lấy key mới bằng command riêng ở Task 4 có clipboard warning.

- [ ] **Step 6: Implement uninstall có phạm vi hẹp**

`Uninstall-DiagramServer -StateRoot [-Purge]`:

1. Nếu Compose/env còn tồn tại, gọi `docker compose --project-name diagram-as-code --env-file .env -f docker-compose.yml down --remove-orphans`.
2. Không thêm `--rmi`, `--volumes` hoặc lệnh Docker global.
3. Mặc định giữ nguyên state.
4. Chỉ `Remove-Item -LiteralPath $resolvedStateRoot -Recurse -Force` khi `-Purge`, sau khi xác nhận resolved path kết thúc bằng `DiagramAsCode\server` hoặc nằm dưới `$env:LOCALAPPDATA\DiagramAsCode`.

- [ ] **Step 7: Chạy test GREEN và tìm rò rỉ key trong output**

Run:

```powershell
pwsh -NoLogo -NoProfile -Command "Invoke-Pester .\product\windows-installer\test -Output Detailed"
rg -n "Write-(Host|Output|Verbose).*DIAGRAM_API_KEYS|return .*ApiKey" product/windows-installer
```

Expected: Pester pass; `rg` không có kết quả.

- [ ] **Step 8: Checkpoint Git thủ công**

Người dùng tự review và commit Task 3.

---

## Task 4: Tạo command wrapper, Compose an toàn và hướng dẫn người dùng

**Files:**

- Create: `product/windows-installer/diagram-server.ps1`
- Create: `product/windows-installer/README.md`
- Modify: `product/deploy/docker-compose.release.yml`
- Create: `product/scripts/test-windows-installer-contract.mjs`
- Modify: `product/package.json`

**Interfaces:**

- Consumes: public lifecycle functions của Task 3 và release Compose hiện có.
- Produces: CLI `diagram-server.ps1 <command>`, Compose loopback contract, npm script `test:installer-contract`, README đi kèm ZIP.

- [ ] **Step 1: Viết static contract test RED**

`product/scripts/test-windows-installer-contract.mjs` phải parse YAML bằng package `yaml` hiện có và assert:

```javascript
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";

const productRoot = process.cwd();
const composePath = path.join(productRoot, "deploy", "docker-compose.release.yml");
const compose = YAML.parse(await readFile(composePath, "utf8"));

assert.deepEqual(compose.services.gateway.ports, ["127.0.0.1:${GATEWAY_PORT:-9000}:9000"]);
assert.equal(compose.services.gateway.restart, "unless-stopped");
assert.equal(compose.services.kroki.restart, "unless-stopped");
assert.equal(compose.services.mermaid.restart, "unless-stopped");
assert.equal(compose.services.kroki.ports, undefined);
assert.equal(compose.services.mermaid.ports, undefined);

console.log("Windows installer Compose contract is valid.");
```

- [ ] **Step 2: Chạy contract test RED**

Run from `product`:

```powershell
node .\scripts\test-windows-installer-contract.mjs
```

Expected: fail vì Gateway hiện bind `${GATEWAY_PORT:-9000}:9000` trên mọi interface.

- [ ] **Step 3: Siết Compose release về loopback**

Đổi duy nhất port Gateway thành:

```yaml
ports:
  - "127.0.0.1:${GATEWAY_PORT:-9000}:9000"
```

Giữ renderer trong cùng Compose network nhưng không publish host port, đồng thời giữ `restart: unless-stopped` cho cả ba service.

- [ ] **Step 4: Chạy contract test GREEN và thêm npm script**

Trong `product/package.json`, thêm:

```json
"test:installer-contract": "node ./scripts/test-windows-installer-contract.mjs"
```

Run:

```powershell
npm run test:installer-contract
```

Expected: `Windows installer Compose contract is valid.`

- [ ] **Step 5: Tạo command wrapper**

`diagram-server.ps1` có public CLI ổn định:

```powershell
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
Import-Module (Join-Path $PSScriptRoot "DiagramServer.psm1") -Force

switch ($Command) {
    "install" {
        $result = Install-DiagramServer -PackageRoot $PSScriptRoot -StateRoot $StateRoot
        Write-Output "Gateway URL: $($result.GatewayUrl)"
        Write-Output "API key: $($result.ApiKey)"
        Write-Output "Status: $($result.Status)"
    }
    "status" { Get-DiagramServerStatus -StateRoot $StateRoot }
    "logs" { Get-DiagramServerLogs -StateRoot $StateRoot -Tail $Tail }
    "restart" { Restart-DiagramServer -StateRoot $StateRoot }
    "update" {
        if ([string]::IsNullOrWhiteSpace($Version)) { throw "update requires a semantic version, for example -Version 0.2.1" }
        Update-DiagramServer -Version $Version -StateRoot $StateRoot
    }
    "show-key" {
        $values = Read-DiagramEnv -Path (Join-Path $StateRoot ".env")
        $values["DIAGRAM_API_KEYS"].Split(",")[0]
    }
    "rotate-key" { Rotate-DiagramServerKey -StateRoot $StateRoot -Finalize:$Finalize }
    "uninstall" { Uninstall-DiagramServer -StateRoot $StateRoot -Purge:$Purge }
}
```

`show-key` là command duy nhất được xuất key, chỉ khi người dùng chủ động gọi. Không tự copy clipboard.

- [ ] **Step 6: Export đầy đủ public functions và test wrapper dispatch**

`Export-ModuleMember` phải có tất cả functions wrapper dùng. Thêm Pester tests chạy wrapper với module function mocks và xác nhận mỗi command dispatch đúng tham số, đặc biệt `uninstall` không purge mặc định.

- [ ] **Step 7: Viết README cho người dùng cuối**

README tiếng Anh vì đây là artifact phát hành, gồm đúng các mục:

- Prerequisites: Windows 10/11, Docker Desktop đang chạy, PowerShell.
- Install: giải nén rồi `powershell -ExecutionPolicy Bypass -File .\diagram-server.ps1 install`.
- Install output phải chỉ rõ `Gateway URL: http://localhost:9000`, một dòng `API key:` theo sau bởi Base64 256-bit vừa sinh, và `Status: Ready`; cảnh báo người dùng không chia sẻ key.
- Configure VS Code: URL `http://localhost:9000`, lấy key bằng `show-key`, lưu vào SecretStorage qua extension command.
- Commands table: `status`, `logs`, `restart`, `update -Version 0.2.1`, `show-key`, `rotate-key`, `rotate-key -Finalize`, `uninstall`, `uninstall -Purge`.
- Stored data: `%LOCALAPPDATA%\DiagramAsCode\server`.
- Troubleshooting: Docker chưa chạy, port 9000 bận, readiness timeout, xem logs.
- Security: loopback only; không chia sẻ key; GitHub Actions trên cùng máy dùng repository secret và self-hosted runner.

- [ ] **Step 8: Chạy toàn bộ test cục bộ**

Run:

```powershell
Set-Location D:\upgrade-diagram-as-code\product
npm run test:installer-contract
powershell -NoLogo -NoProfile -Command "Invoke-Pester .\windows-installer\test -Output Detailed"
pwsh -NoLogo -NoProfile -Command "Invoke-Pester .\windows-installer\test -Output Detailed"
```

Expected: tất cả pass.

- [ ] **Step 9: Checkpoint Git thủ công**

Người dùng tự review và commit Task 4.

---

## Task 5: Thêm Windows CI và smoke test Docker Desktop thủ công

**Files:**

- Modify: `.github/workflows/product-ci.yml`
- Create: `product/docs/windows-installer-testing.md`

**Interfaces:**

- Consumes: installer CLI, Pester suite và npm static contract từ Task 4.
- Produces: CI job `windows-installer` và runbook smoke test thật trên Docker Desktop.

- [ ] **Step 1: Thêm job Windows chỉ kiểm thử installer**

Job mới `windows-installer`:

```yaml
windows-installer:
  name: Windows installer
  runs-on: windows-latest
  defaults:
    run:
      working-directory: product
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: npm
        cache-dependency-path: product/package-lock.json
    - name: Install Node dependencies
      run: npm ci
    - name: Install Pester
      shell: powershell
      run: Install-Module Pester -RequiredVersion 5.7.1 -Scope CurrentUser -Force -SkipPublisherCheck
    - name: Test static installer contract
      run: npm run test:installer-contract
    - name: Test with Windows PowerShell 5.1
      shell: powershell
      run: Invoke-Pester .\windows-installer\test -CI -Output Detailed
    - name: Test with PowerShell 7
      shell: pwsh
      run: Invoke-Pester .\windows-installer\test -CI -Output Detailed
```

Không thêm self-hosted label cho unit test; `windows-latest` không cần truy cập Gateway thật.

- [ ] **Step 2: Validate workflow locally as data**

Run:

```powershell
Set-Location D:\upgrade-diagram-as-code\product
npm run test:installer-contract
npx prettier --check ..\.github\workflows\product-ci.yml
```

Expected: pass. Codex không kích hoạt workflow GitHub.

- [ ] **Step 3: Viết Docker Desktop smoke-test runbook**

`product/docs/windows-installer-testing.md` phải có checklist trên máy Windows hiện tại:

1. Đảm bảo Docker Desktop đang chạy và port 9000 trống.
2. Giải nén artifact vào thư mục tạm.
3. Chạy `install`.
4. Chạy `status`; kỳ vọng `Running=True`, `Ready=True`.
5. Lấy key bằng `show-key` và gọi một POST render thật.
6. Restart Docker Desktop; xác nhận service trở lại nhờ `restart: unless-stopped`.
7. Cài lại; xác nhận key không đổi.
8. Rotate hai giai đoạn; xác nhận key cũ hoạt động trước `-Finalize` và bị từ chối sau đó.
9. Thử update lỗi bằng manifest image không tồn tại; xác nhận rollback.
10. `uninstall` giữ state; `install` dùng lại key; cuối cùng `uninstall -Purge` xóa state.

Kèm lệnh render smoke test:

```powershell
$key = powershell -ExecutionPolicy Bypass -File .\diagram-server.ps1 show-key
$headers = @{ Authorization = "Bearer $key" }
$body = @{ type = "mermaid"; format = "svg"; source = "graph TD; A-->B" } | ConvertTo-Json -Compress
Invoke-WebRequest -Method Post -Uri "http://localhost:9000/v1/render" -Headers $headers -ContentType "application/json" -Body $body
```

Expected: HTTP 200 và response SVG.

- [ ] **Step 4: Người dùng chạy smoke test trên máy Windows hiện tại**

Codex có thể chuẩn bị lệnh và đọc output cục bộ, nhưng không thao tác GitHub. Ghi lại kết quả pass/fail trong release checklist của Plan 3.

- [ ] **Step 5: Checkpoint Git/GitHub thủ công**

Người dùng tự commit, push và quan sát job `Product CI / Windows installer`. Nếu workflow fail, đưa log cho Codex sửa cục bộ.

---

## Completion Criteria

- Installer chạy được trên Windows PowerShell 5.1 và PowerShell 7.
- `install` idempotent, không làm lộ hoặc thay key ngoài ý muốn.
- Gateway chỉ nghe trên `127.0.0.1:9000`.
- Mọi Docker command bị giới hạn trong Compose project `diagram-as-code`.
- Update lỗi rollback được; rotate key hỗ trợ chuyển tiếp hai giai đoạn.
- Uninstall mặc định giữ state và chỉ purge khi người dùng yêu cầu rõ ràng.
- Pester, static Compose contract và Docker Desktop smoke test đều pass.
- Không có thao tác Git/GitHub tự động từ Codex.
