$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $project

$version = '24.22.1'
$archiveName = "node-v$version-win-x64.zip"
$baseUrl = "https://nodejs.org/dist/v$version"
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'NOC-Hub\runtime'
$runtime = Join-Path $runtimeRoot "node-v$version-win-x64"
$node = Join-Path $runtime 'node.exe'
$npm = Join-Path $runtime 'npm.cmd'

try {
    if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $npm)) {
        if (Test-Path -LiteralPath $runtime) {
            throw "Node.js portable tai $runtime khong day du. Hay doi ten hoac xoa thu muc do va thu lai."
        }
        Write-Host 'Dang tai Node.js portable tu nodejs.org...'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
        $temporary = Join-Path $runtimeRoot ([Guid]::NewGuid().ToString())
        New-Item -ItemType Directory -Path $temporary | Out-Null
        try {
            $archive = Join-Path $temporary $archiveName
            $sums = Join-Path $temporary 'SHASUMS256.txt'
            Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$archiveName" -OutFile $archive
            Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHASUMS256.txt" -OutFile $sums
            $line = Get-Content -LiteralPath $sums | Where-Object { $_ -match "^[a-fA-F0-9]{64}\s+\*?$([regex]::Escape($archiveName))$" } | Select-Object -First 1
            if (-not $line) { throw 'Khong tim thay checksum Node.js chinh thuc.' }
            $expected = ($line -split '\s+')[0]
            $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash
            if ($actual -ne $expected) { throw 'Checksum Node.js khong khop. Da dung cai dat.' }
            Expand-Archive -LiteralPath $archive -DestinationPath $temporary
            $extracted = Join-Path $temporary "node-v$version-win-x64"
            if (-not (Test-Path -LiteralPath (Join-Path $extracted 'node.exe')) -or -not (Test-Path -LiteralPath (Join-Path $extracted 'npm.cmd'))) {
                throw 'Tep Node.js tai ve khong day du.'
            }
            Move-Item -LiteralPath $extracted -Destination $runtime
        }
        finally {
            if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
        }
    }

    $env:PATH = "$runtime;$env:PATH"
    Write-Host 'Dang cai thu vien theo package-lock.json...'
    & $npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Cai thu vien that bai. Hay kiem tra ket noi npm registry.' }
    Write-Host 'Dang build ung dung...'
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Build that bai.' }
    $env:HOST = '127.0.0.1'
    if (-not $env:PORT) { $env:PORT = '3001' }
    Write-Host "Mo trinh duyet tai http://localhost:$env:PORT"
    Write-Host 'Giu cua so nay mo. Nhan Ctrl+C de dung ung dung.'
    & $node 'server/index.js'
    if ($LASTEXITCODE -ne 0) { throw "Khong the chay ung dung. Hay kiem tra cong $env:PORT." }
}
catch {
    Write-Error $_
    exit 1
}
