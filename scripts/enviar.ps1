#requires -Version 5.1
<#
  enviar.ps1 - E5: acarrear la boveda al pendrive, en una linea.

  Uso normal:
    .\enviar.ps1

  Opciones:
    -StickRoot F:\keeper-transfer   (si no se indica, se busca solo)
    -Simulate                       (corre todo contra las rutas indicadas, sin tocar el pendrive real)
    -Vault / -KeyFile               (para -Simulate o para una boveda distinta)
    -ConFrase                       (copia la frase al pendrive: es un secreto, borrarla despues)

  Solo lee la boveda: se puede correr con DSH abierto.
#>
param(
  [string]$StickRoot = '',
  [string]$Vault = '',
  [string]$KeyFile = '',
  [string]$Repo = '',
  [int]$Retries = 3,
  [switch]$Simulate,
  [switch]$ConFrase
)

$ErrorActionPreference = 'Continue'
$logFile = Join-Path $env:USERPROFILE 'keeper\transporte.log'

function Write-Log([string]$message) {
  $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $message
  New-Item -ItemType Directory (Split-Path $logFile) -Force | Out-Null
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  Write-Host $message
}

function Stop-Fail([string]$message) {
  Write-Log ('ERROR: ' + $message)
  exit 1
}

function Find-Node {
  if ($env:DSH_NODE -and (Test-Path $env:DSH_NODE)) { return $env:DSH_NODE }
  $runtime = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes'
  if (Test-Path $runtime) {
    $found = @(Get-ChildItem $runtime -Recurse -File -Filter 'node.exe' -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match 'node\\bin\\node\.exe$' })
    if ($found.Count -gt 0) { return $found[0].FullName }
  }
  $onPath = Get-Command node -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  Stop-Fail 'no encuentro node.exe'
}

# Runs `keeper capabilities --json` and returns the object, or $null when the CLI cannot answer.
function Get-Capabilities([string]$node, [string]$cli) {
  $raw = & $node $cli capabilities --json 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  try { return ($raw | ConvertFrom-Json) } catch { return $null }
}

# Pick the newest CLI that can export: KEEPER_CLI, the repo, then the installed profile.
function Find-Cli([string]$node) {
  $candidates = @()
  if ($env:KEEPER_CLI) { $candidates += $env:KEEPER_CLI }
  $candidates += (Join-Path $Repo 'bin\keeper.js')
  $candidates += (Join-Path $env:USERPROFILE '.dsh\profiles\desktop\node_modules\dsh-history-keeper\bin\keeper.js')

  $best = $null; $bestVersion = $null
  foreach ($candidate in $candidates) {
    if (-not (Test-Path $candidate)) { continue }
    $caps = Get-Capabilities $node $candidate
    if (-not $caps) { continue }
    if (-not (@($caps.commands) -contains 'export')) { continue }
    if ($null -eq $bestVersion -or ([string]$caps.version) -gt ([string]$bestVersion)) {
      $best = $candidate; $bestVersion = $caps.version
    }
  }
  if (-not $best) { Stop-Fail 'el CLI instalado no tiene export; actualiza el plugin (0.1.0-rc.36 o superior)' }
  Write-Log "CLI: $best ($bestVersion)"
  return $best
}

function Find-Stick([string]$explicit) {
  if ($explicit) { return $explicit }
  $candidates = @()
  foreach ($drive in (Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
    if ($drive.Root -match '^[A-Za-z]:\\$') { $candidates += (Join-Path $drive.Root 'keeper-transfer') }
  }
  foreach ($candidate in $candidates) {
    if (Test-Path (Join-Path $candidate 'vault\meta.json')) { return $candidate }
  }
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

$Repo = Resolve-Repo $Repo
$node = Find-Node
$cli = Find-Cli $node

$layoutRaw = & $node $cli paths --json 2>$null
$layout = $null
if ($LASTEXITCODE -eq 0) { try { $layout = $layoutRaw | ConvertFrom-Json } catch { $layout = $null } }
if (-not $Vault) { if ($layout) { $Vault = $layout.vault } }
if (-not $KeyFile) { if ($layout) { $KeyFile = $layout.key } }
if (-not $Vault) { Stop-Fail 'no se pudo resolver la boveda (probar -Vault)' }
if (-not (Test-Path (Join-Path $Vault 'meta.json'))) { Stop-Fail "no hay boveda en $Vault" }

$stick = Find-Stick $StickRoot
if (-not $stick) {
  Stop-Fail 'no encuentro el pendrive: conectalo, o indicá -StickRoot <carpeta>\keeper-transfer'
}
Write-Log "boveda: $Vault"
Write-Log "pendrive: $stick"
if ($Simulate) { Write-Log 'modo simulacion' }

$ok = $false
for ($attempt = 1; $attempt -le $Retries; $attempt += 1) {
  Write-Log "export intento $attempt"
  $out = & $node $cli export --to $stick --store $Vault --key-file $KeyFile 2>&1
  $code = $LASTEXITCODE
  foreach ($line in $out) { Write-Log ('  ' + $line) }
  if ($code -eq 0) { $ok = $true; break }
  if ($attempt -lt $Retries) { Start-Sleep -Seconds 10 }
}
if (-not $ok) { Stop-Fail 'el export fallo; el pendrive no se modifico' }

if ($ConFrase) {
  $keyDir = Join-Path $stick 'key'
  New-Item -ItemType Directory $keyDir -Force | Out-Null
  Copy-Item $KeyFile (Join-Path $keyDir 'pc-a.txt') -Force
  Write-Log 'ATENCION: la frase viajo al pendrive; borrala cuando la otra PC la tenga'
}

$receipt = @(Get-ChildItem $stick -Filter 'carry-*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
if ($receipt.Count -gt 0) {
  $r = Get-Content $receipt[0].FullName -Raw | ConvertFrom-Json
  Write-Log ("listo: {0} sesiones, {1} frames, {2} verificadas: {3}" -f $r.totals.sessions, $r.totals.frames, [math]::Round($r.totals.bytes / 1MB, 1), $r.verified.ok)
  Write-Log ("recibo: " + $receipt[0].Name)
}
Write-Log 'listo para llevar el pendrive a la otra PC'
