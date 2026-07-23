BeforeAll {
    $modulePath = Join-Path $PSScriptRoot "..\DiagramServer.psm1"
    Import-Module $modulePath -Force -DisableNameChecking
}

Describe "Assert-DiagramPlatform" {
    It "accepts Windows PowerShell 5.1 or newer" {
        { Assert-DiagramPlatform } | Should -Not -Throw
    }
}

Describe "New-DiagramApiKey" {
    It "returns 32 random bytes encoded as Base64" {
        $first = New-DiagramApiKey
        $second = New-DiagramApiKey

        [Convert]::FromBase64String($first).Length | Should -Be 32
        $first | Should -Not -Be $second
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

Describe "Diagram environment files" {
    It "parses values containing equals signs and ignores comments" {
        $path = Join-Path $TestDrive ".env"
        @("# comment", "DIAGRAM_API_KEYS=abc==", "GATEWAY_PORT=9000") | Set-Content $path

        $values = Read-DiagramEnv -Path $path

        $values["DIAGRAM_API_KEYS"] | Should -Be "abc=="
        $values["GATEWAY_PORT"] | Should -Be "9000"
        $values.Count | Should -Be 2
    }

    It "rejects malformed lines" {
        $path = Join-Path $TestDrive "invalid.env"
        "INVALID" | Set-Content $path

        { Read-DiagramEnv -Path $path } | Should -Throw "*Invalid environment line*"
    }

    It "writes UTF-8 without a BOM and returns no secret values" {
        $path = Join-Path $TestDrive "written.env"
        $values = [ordered]@{ DIAGRAM_API_KEYS = "secret=="; GATEWAY_PORT = "9000" }

        $output = @(Write-DiagramEnv -Path $path -Values $values)
        $bytes = [IO.File]::ReadAllBytes($path)

        $output.Count | Should -Be 0
        $bytes[0..2] | Should -Not -Be @(0xEF, 0xBB, 0xBF)
        (Get-Content $path -Raw) | Should -Match "DIAGRAM_API_KEYS=secret=="
    }
}

Describe "Get-DiagramComposeArguments" {
    It "always scopes Docker Compose to the managed project and files" {
        $arguments = Get-DiagramComposeArguments -Command @("up", "-d")

        $arguments | Should -Be @(
            "compose", "--project-name", "diagram-as-code",
            "--env-file", ".env", "-f", "docker-compose.yml",
            "up", "-d"
        )
    }
}

Describe "Assert-DiagramPortAvailable" {
    It "rejects a port already bound on loopback" {
        $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
        $listener.Start()
        try {
            $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
            { Assert-DiagramPortAvailable -Port $port } |
                Should -Throw "*Port 127.0.0.1:$port is already in use*"
        }
        finally {
            $listener.Stop()
        }
    }
}

Describe "Copy-DiagramFileAtomic" {
    It "replaces the destination without leaving a temporary file" {
        $source = Join-Path $TestDrive "source.txt"
        $destination = Join-Path $TestDrive "destination.txt"
        "new" | Set-Content $source -NoNewline
        "old" | Set-Content $destination -NoNewline

        Copy-DiagramFileAtomic -Source $source -Destination $destination

        Get-Content $destination -Raw | Should -Be "new"
        @(Get-ChildItem $TestDrive -Filter "destination.txt.*.tmp").Count | Should -Be 0
    }
}

Describe "Wait-DiagramReady" {
    It "returns after a successful readiness response" {
        Mock -ModuleName DiagramServer Invoke-WebRequest {
            [PSCustomObject]@{ StatusCode = 200 }
        }

        { Wait-DiagramReady -BaseUrl "http://localhost:9000" -TimeoutSeconds 1 } |
            Should -Not -Throw
        Should -Invoke -ModuleName DiagramServer Invoke-WebRequest -Times 1
    }
}

Describe "Assert-DiagramDockerReady" {
    It "explains when the Docker CLI is missing" {
        Mock -ModuleName DiagramServer Get-Command { $null } -ParameterFilter { $Name -eq "docker" }

        { Assert-DiagramDockerReady } |
            Should -Throw "*Docker CLI was not found. Install and start Docker Desktop.*"
    }
}

Describe "Invoke-DiagramDocker" {
    It "runs Docker from the requested working directory" {
        $output = Invoke-DiagramDocker `
            -Arguments @("version", "--format", "{{.Client.Version}}") `
            -WorkingDirectory $TestDrive

        [string]::Join("", $output) | Should -Match "^\d+\.\d+\.\d+"
    }
}

Describe "Install-DiagramServer" {
    BeforeEach {
        $caseId = [Guid]::NewGuid().ToString("N")
        $script:packageRoot = Join-Path $TestDrive "package-$caseId"
        $script:stateRoot = Join-Path $TestDrive "state-$caseId"
        New-Item -ItemType Directory -Path $script:packageRoot | Out-Null
        Copy-Item `
            (Join-Path $PSScriptRoot "fixtures\server-manifest.json") `
            (Join-Path $script:packageRoot "server-manifest.json")
        "services: {}" | Set-Content (Join-Path $script:packageRoot "docker-compose.yml")

        Mock -ModuleName DiagramServer Assert-DiagramPlatform {}
        Mock -ModuleName DiagramServer Assert-DiagramPackageChecksums {}
        Mock -ModuleName DiagramServer Assert-DiagramDockerReady {}
        Mock -ModuleName DiagramServer Assert-DiagramPortAvailable {}
        Mock -ModuleName DiagramServer Invoke-DiagramDocker {}
        Mock -ModuleName DiagramServer Wait-DiagramReady {}
    }

    It "creates managed files and starts the fixed compose project" {
        $result = Install-DiagramServer -PackageRoot $script:packageRoot -StateRoot $script:stateRoot

        Test-Path (Join-Path $script:stateRoot ".env") | Should -BeTrue
        Test-Path (Join-Path $script:stateRoot "docker-compose.yml") | Should -BeTrue
        Test-Path (Join-Path $script:stateRoot "server-manifest.json") | Should -BeTrue
        $result.GatewayUrl | Should -Be "http://localhost:9000"
        $result.Status | Should -Be "Ready"
        [Convert]::FromBase64String($result.ApiKey).Length | Should -Be 32
        Should -Invoke -ModuleName DiagramServer Invoke-DiagramDocker -ParameterFilter {
            $Arguments -join " " -eq "compose --project-name diagram-as-code --env-file .env -f docker-compose.yml up -d --pull always"
        }
    }

    It "preserves the API key when install is run again" {
        $firstResult = Install-DiagramServer -PackageRoot $script:packageRoot -StateRoot $script:stateRoot
        $secondResult = Install-DiagramServer -PackageRoot $script:packageRoot -StateRoot $script:stateRoot

        $secondResult.ApiKey | Should -Be $firstResult.ApiKey
        Should -Invoke -ModuleName DiagramServer Assert-DiagramPortAvailable -Times 1
    }

    It "does not overwrite a corrupt existing env file" {
        New-Item -ItemType Directory -Path $script:stateRoot | Out-Null
        "GATEWAY_PORT=9000" | Set-Content (Join-Path $script:stateRoot ".env")

        { Install-DiagramServer -PackageRoot $script:packageRoot -StateRoot $script:stateRoot } |
            Should -Throw "*DIAGRAM_API_KEYS is missing*"
        Get-Content (Join-Path $script:stateRoot ".env") -Raw | Should -Not -Match "DIAGRAM_API_KEYS="
    }

    It "fails before writing state when Docker Desktop is unavailable" {
        Mock -ModuleName DiagramServer Assert-DiagramDockerReady {
            throw "Docker Desktop is not ready"
        }

        { Install-DiagramServer -PackageRoot $script:packageRoot -StateRoot $script:stateRoot } |
            Should -Throw "Docker Desktop is not ready"
        Test-Path $script:stateRoot | Should -BeFalse
    }
}

Describe "Diagram server status, logs, and restart" {
    BeforeEach {
        $caseId = [Guid]::NewGuid().ToString("N")
        $script:lifecycleRoot = Join-Path $TestDrive "lifecycle-$caseId"
        New-Item -ItemType Directory -Path $script:lifecycleRoot | Out-Null
        Copy-Item `
            (Join-Path $PSScriptRoot "fixtures\server-manifest.json") `
            (Join-Path $script:lifecycleRoot "server-manifest.json")
        "services: {}" | Set-Content (Join-Path $script:lifecycleRoot "docker-compose.yml")
        "DIAGRAM_API_KEYS=test-key" | Set-Content (Join-Path $script:lifecycleRoot ".env")
    }

    It "reports running and ready without exposing the API key" {
        Mock -ModuleName DiagramServer Invoke-DiagramDocker {
            '{"Service":"gateway","State":"running"}'
        }
        Mock -ModuleName DiagramServer Invoke-WebRequest {
            [PSCustomObject]@{ StatusCode = 200 }
        }

        $status = Get-DiagramServerStatus -StateRoot $script:lifecycleRoot

        $status.Running | Should -BeTrue
        $status.Ready | Should -BeTrue
        $status.GatewayUrl | Should -Be "http://localhost:9000"
        $status.ProductVersion | Should -Be "0.2.0"
        ($status | ConvertTo-Json -Compress) | Should -Not -Match "test-key"
    }

    It "requests a bounded number of log lines" {
        Mock -ModuleName DiagramServer Invoke-DiagramDocker { "gateway log" }

        $logs = Get-DiagramServerLogs -StateRoot $script:lifecycleRoot -Tail 25

        $logs | Should -Be "gateway log"
        Should -Invoke -ModuleName DiagramServer Invoke-DiagramDocker -ParameterFilter {
            $Arguments -join " " -eq "compose --project-name diagram-as-code --env-file .env -f docker-compose.yml logs --no-color --tail 25"
        }
    }

    It "restarts the managed project and waits for readiness" {
        Mock -ModuleName DiagramServer Invoke-DiagramDocker {}
        Mock -ModuleName DiagramServer Wait-DiagramReady {}

        Restart-DiagramServer -StateRoot $script:lifecycleRoot

        Should -Invoke -ModuleName DiagramServer Invoke-DiagramDocker -ParameterFilter {
            $Arguments -join " " -eq "compose --project-name diagram-as-code --env-file .env -f docker-compose.yml restart"
        }
        Should -Invoke -ModuleName DiagramServer Wait-DiagramReady -Times 1
    }
}

Describe "Rotate-DiagramServerKey" {
    BeforeEach {
        $caseId = [Guid]::NewGuid().ToString("N")
        $script:rotationRoot = Join-Path $TestDrive "rotation-$caseId"
        New-Item -ItemType Directory -Path $script:rotationRoot | Out-Null
        Copy-Item `
            (Join-Path $PSScriptRoot "fixtures\server-manifest.json") `
            (Join-Path $script:rotationRoot "server-manifest.json")
        "services: {}" | Set-Content (Join-Path $script:rotationRoot "docker-compose.yml")
        "DIAGRAM_API_KEYS=old-key" | Set-Content (Join-Path $script:rotationRoot ".env")
        Mock -ModuleName DiagramServer Restart-DiagramServer {}
    }

    It "prepends a new key while retaining the old key" {
        $result = Rotate-DiagramServerKey -StateRoot $script:rotationRoot
        $values = Read-DiagramEnv -Path (Join-Path $script:rotationRoot ".env")
        $keys = @($values["DIAGRAM_API_KEYS"].Split(","))

        $keys.Count | Should -Be 2
        $keys[0] | Should -Not -Be "old-key"
        $keys[1] | Should -Be "old-key"
        $result.Rotated | Should -BeTrue
        $result.Finalized | Should -BeFalse
    }

    It "finalizes rotation by retaining only the newest key" {
        Rotate-DiagramServerKey -StateRoot $script:rotationRoot | Out-Null
        Rotate-DiagramServerKey -StateRoot $script:rotationRoot -Finalize | Out-Null
        $values = Read-DiagramEnv -Path (Join-Path $script:rotationRoot ".env")

        $values["DIAGRAM_API_KEYS"] | Should -Not -Match ","
        $values["DIAGRAM_API_KEYS"] | Should -Not -Be "old-key"
        Should -Invoke -ModuleName DiagramServer Restart-DiagramServer -Times 2
    }
}

Describe "Uninstall-DiagramServer" {
    BeforeEach {
        $caseId = [Guid]::NewGuid().ToString("N")
        $script:uninstallRoot = Join-Path $TestDrive "uninstall-$caseId"
        New-Item -ItemType Directory -Path $script:uninstallRoot | Out-Null
        "services: {}" | Set-Content (Join-Path $script:uninstallRoot "docker-compose.yml")
        "DIAGRAM_API_KEYS=test-key" | Set-Content (Join-Path $script:uninstallRoot ".env")
        Mock -ModuleName DiagramServer Invoke-DiagramDocker {}
    }

    It "stops only the managed compose project and keeps state by default" {
        Uninstall-DiagramServer -StateRoot $script:uninstallRoot

        Test-Path $script:uninstallRoot | Should -BeTrue
        Should -Invoke -ModuleName DiagramServer Invoke-DiagramDocker -ParameterFilter {
            $Arguments -join " " -eq "compose --project-name diagram-as-code --env-file .env -f docker-compose.yml down --remove-orphans"
        }
    }

    It "purges an explicitly requested state directory under LocalAppData" {
        $safeRoot = Join-Path $env:LOCALAPPDATA "DiagramAsCode\server-test-$([Guid]::NewGuid().ToString("N"))"
        New-Item -ItemType Directory -Path $safeRoot -Force | Out-Null
        "services: {}" | Set-Content (Join-Path $safeRoot "docker-compose.yml")
        "DIAGRAM_API_KEYS=test-key" | Set-Content (Join-Path $safeRoot ".env")
        try {
            Uninstall-DiagramServer -StateRoot $safeRoot -Purge
            Test-Path $safeRoot | Should -BeFalse
        }
        finally {
            if (Test-Path -LiteralPath $safeRoot) {
                Remove-Item -LiteralPath $safeRoot -Recurse -Force
            }
        }
    }
}

Describe "Get-DiagramReleasePackage" {
    BeforeEach {
        $caseId = [Guid]::NewGuid().ToString("N")
        $script:downloadRoot = Join-Path $TestDrive "download-$caseId"
        $sourceRoot = Join-Path $TestDrive "zip-source-$caseId"
        New-Item -ItemType Directory -Path $sourceRoot | Out-Null
        "package" | Set-Content (Join-Path $sourceRoot "marker.txt")
        $script:fixtureZip = Join-Path $TestDrive "fixture-$caseId.zip"
        Compress-Archive -Path (Join-Path $sourceRoot "*") -DestinationPath $script:fixtureZip
        $script:fixtureHash = (Get-FileHash $script:fixtureZip -Algorithm SHA256).Hash.ToLowerInvariant()
    }

    It "downloads a versioned ZIP, verifies it, and returns the extracted root" {
        Mock -ModuleName DiagramServer Invoke-WebRequest {
            if ([string]$Uri -like "*/SHA256SUMS") {
                "$script:fixtureHash  diagram-as-code-server-0.2.1.zip" | Set-Content $OutFile
            }
            else {
                Copy-Item $script:fixtureZip $OutFile
            }
        }

        $packageRoot = Get-DiagramReleasePackage `
            -Version "0.2.1" `
            -DestinationRoot $script:downloadRoot

        Test-Path (Join-Path $packageRoot "marker.txt") | Should -BeTrue
        Should -Invoke -ModuleName DiagramServer Invoke-WebRequest -Times 2
    }

    It "rejects a downloaded ZIP whose checksum does not match" {
        Mock -ModuleName DiagramServer Invoke-WebRequest {
            if ([string]$Uri -like "*/SHA256SUMS") {
                "0000000000000000000000000000000000000000000000000000000000000000  diagram-as-code-server-0.2.1.zip" | Set-Content $OutFile
            }
            else {
                Copy-Item $script:fixtureZip $OutFile
            }
        }

        { Get-DiagramReleasePackage -Version "0.2.1" -DestinationRoot $script:downloadRoot } |
            Should -Throw "*Checksum verification failed*"
    }
}

Describe "Assert-DiagramReleaseHealthy" {
    It "checks health, readiness, and all four renderers" {
        Mock -ModuleName DiagramServer Invoke-WebRequest {
            if ($Method -eq "Post") {
                [PSCustomObject]@{ StatusCode = 200; Content = "<svg></svg>" }
            }
            else {
                [PSCustomObject]@{ StatusCode = 200; Content = "{}" }
            }
        }

        Assert-DiagramReleaseHealthy -BaseUrl "http://localhost:9000" -ApiKey "test-key"

        Should -Invoke -ModuleName DiagramServer Invoke-WebRequest -Times 6
        foreach ($type in @("mermaid", "plantuml", "graphviz", "d2")) {
            Should -Invoke -ModuleName DiagramServer Invoke-WebRequest -Times 1 -ParameterFilter {
                $Method -eq "Post" -and $Body -match ('"type":"' + $type + '"')
            }
        }
    }
}

Describe "Update-DiagramServerPackage" {
    BeforeEach {
        $caseId = [Guid]::NewGuid().ToString("N")
        $script:updateStateRoot = Join-Path $TestDrive "update-state-$caseId"
        $script:updatePackageRoot = Join-Path $TestDrive "update-package-$caseId"
        New-Item -ItemType Directory -Path $script:updateStateRoot | Out-Null
        New-Item -ItemType Directory -Path $script:updatePackageRoot | Out-Null

        Copy-Item `
            (Join-Path $PSScriptRoot "fixtures\server-manifest.json") `
            (Join-Path $script:updateStateRoot "server-manifest.json")
        "old compose" | Set-Content (Join-Path $script:updateStateRoot "docker-compose.yml")
        "DIAGRAM_API_KEYS=stable-key" | Set-Content (Join-Path $script:updateStateRoot ".env")

        $newManifest = Get-Content (Join-Path $PSScriptRoot "fixtures\server-manifest.json") -Raw | ConvertFrom-Json
        $newManifest.productVersion = "0.2.1"
        $newManifest.images.gateway = "ghcr.io/phuongnam2106/diagram-as-code-gateway:product-v0.2.1"
        $newManifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $script:updatePackageRoot "server-manifest.json")
        "new compose" | Set-Content (Join-Path $script:updatePackageRoot "docker-compose.yml")
        "placeholder" | Set-Content (Join-Path $script:updatePackageRoot "SHA256SUMS")

        Mock -ModuleName DiagramServer Assert-DiagramPackageChecksums {}
        Mock -ModuleName DiagramServer Invoke-DiagramDocker {}
        Mock -ModuleName DiagramServer Wait-DiagramReady {}
        Mock -ModuleName DiagramServer Assert-DiagramReleaseHealthy {}
    }

    It "applies a healthy package while preserving the API key" {
        $result = Update-DiagramServerPackage `
            -PackageRoot $script:updatePackageRoot `
            -StateRoot $script:updateStateRoot

        $result.ProductVersion | Should -Be "0.2.1"
        (Read-DiagramEnv (Join-Path $script:updateStateRoot ".env"))["DIAGRAM_API_KEYS"] |
            Should -Be "stable-key"
        (Get-Content (Join-Path $script:updateStateRoot "docker-compose.yml") -Raw) |
            Should -Match "new compose"
        Should -Invoke -ModuleName DiagramServer Assert-DiagramReleaseHealthy -Times 1 -ParameterFilter {
            $ApiKey -eq "stable-key"
        }
    }

    It "restores the previous package when readiness fails" {
        $script:readyCalls = 0
        Mock -ModuleName DiagramServer Wait-DiagramReady {
            $script:readyCalls += 1
            if ($script:readyCalls -eq 1) { throw "not ready" }
        }

        { Update-DiagramServerPackage -PackageRoot $script:updatePackageRoot -StateRoot $script:updateStateRoot } |
            Should -Throw "*rolled back*"
        $restored = Read-DiagramServerManifest -Path (Join-Path $script:updateStateRoot "server-manifest.json")
        $restored.productVersion | Should -Be "0.2.0"
        (Get-Content (Join-Path $script:updateStateRoot "docker-compose.yml") -Raw) |
            Should -Match "old compose"
        Should -Invoke -ModuleName DiagramServer Invoke-DiagramDocker -Times 2
    }
}

Describe "Update-DiagramServer" {
    It "downloads the requested version and removes its temporary directory" {
        $script:publicPackageRoot = Join-Path $TestDrive "public-update-package"
        New-Item -ItemType Directory -Path $script:publicPackageRoot -Force | Out-Null
        Mock -ModuleName DiagramServer Get-DiagramReleasePackage {
            $script:capturedDownloadRoot = $DestinationRoot
            $script:publicPackageRoot
        }
        Mock -ModuleName DiagramServer Update-DiagramServerPackage {
            [PSCustomObject]@{ ProductVersion = "0.2.1" }
        }

        $result = Update-DiagramServer -Version "0.2.1" -StateRoot $TestDrive

        $result.ProductVersion | Should -Be "0.2.1"
        Should -Invoke -ModuleName DiagramServer Get-DiagramReleasePackage -Times 1 -ParameterFilter {
            $Version -eq "0.2.1"
        }
        Test-Path $script:capturedDownloadRoot | Should -BeFalse
    }
}

Describe "diagram-server command wrapper" {
    BeforeAll {
        $script:commandPath = Join-Path $PSScriptRoot "..\diagram-server.ps1"
    }

    It "shows only the newest configured API key" {
        $root = Join-Path $TestDrive "wrapper-show-key"
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        "DIAGRAM_API_KEYS=new-key,old-key" | Set-Content (Join-Path $root ".env")

        $output = & $script:commandPath show-key -StateRoot $root

        $output | Should -Be "new-key"
    }

    It "requires a semantic version for update" {
        { & $script:commandPath update -StateRoot $TestDrive } |
            Should -Throw "*update requires a semantic version*"
    }
}
