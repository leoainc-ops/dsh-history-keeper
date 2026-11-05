#requires -Version 5.1
<#
  recibir.ps1 - E5: montar la boveda del pendrive, en una linea.

  Requiere DSH CERRADO (escribe la boveda viva y las sesiones).

  Uso normal:
    .\recibir.ps1

  Opciones:
    -StickRoot F:\keeper-transfer   (si no se indica, se busca solo)
    -StickKey  <archivo>            (si no se indica, usa el unico de <pendrive>\key\)
    -Simulate                       (corre todo contra las rutas indicadas)
    -Vault / -KeyFile / -SessionsRoot (para -Simulate o una instalacion distinta)
    -ProcessName                    (nombre del proceso a vigilar; por defecto DeepSeek Harness)
    -Force                          (ignora el chequeo de DSH abierto: solo para pruebas)

  Si algo falla, la boveda anterior queda en su lugar y el informe dice donde.
#>
param(
  [string]$StickRoot = '',
  [string]$StickKey = '',
  [string]$Vault = '',
  [string]$KeyFile = '',
  [string]$SessionsRoot = '',
  [string]$Repo = '',
  [string]$ProcessName = 'DeepSeek Harness',
  [switch]$Simulate,
  [switch]$Force
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

function Get-Capabilities([string]$node, [string]$cli) {
  $raw = & $node $cli capabilities --json 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  try { return ($raw | ConvertFrom-Json) } catch { return $null }
}

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
    if (-not (@($caps.commands) -contains 'import')) { continue }
    if ($null -eq $bestVersion -or ([string]$caps.version) -gt ([string]$bestVersion)) {
      $best = $candidate; $bestVersion = $caps.version
    }
  }
  if (-not $best) { Stop-Fail 'el CLI instalado no tiene import; actualiza el plugin (0.1.0-rc.34 o superior)' }
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
  return $null
}

# 1. DSH must be closed: the swap writes the live vault and the session tree.
if (-not $Force) {
  $running = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
  if ($running -and -not $Simulate) {
    Stop-Fail "DSH esta abierto ($ProcessName). Cerralo y volve a ejecutar."
  }
  if ($running -and $Simulate) { Write-Log "aviso: $ProcessName esta abierto (simulacion: sigo)" }
}

$Repo = Resolve-Repo $Repo
$node = Find-Node
$cli = Find-Cli $node

$layoutRaw = & $node $cli paths --json 2>$null
$layout = $null
if ($LASTEXITCODE -eq 0) { try { $layout = $layoutRaw | ConvertFrom-Json } catch { $layout = $null } }
if (-not $Vault) { if ($layout) { $Vault = $layout.vault } }
if (-not $KeyFile) { if ($layout) { $KeyFile = $layout.key } }
if (-not $SessionsRoot) { if ($layout) { $SessionsRoot = $layout.sessions } }
if (-not $Vault) { Stop-Fail 'no se pudo resolver la boveda (probar -Vault)' }
if (-not (Test-Path (Join-Path $Vault 'meta.json'))) { Stop-Fail "no hay boveda en $Vault" }
if (-not (Test-Path $KeyFile)) { Stop-Fail "no encuentro la frase local en $KeyFile" }

$stick = Find-Stick $StickRoot
if (-not $stick) { Stop-Fail 'no encuentro el pendrive: conectalo, o indicá -StickRoot <carpeta>\keeper-transfer' }
$stickVault = Join-Path $stick 'vault'
if (-not (Test-Path (Join-Path $stickVault 'meta.json'))) { Stop-Fail "no hay boveda en $stickVault" }

if (-not $StickKey) {
  $keyDir = Join-Path $stick 'key'
  if (Test-Path $keyDir) {
    $keys = @(Get-ChildItem $keyDir -File | Where-Object { $_.Name -notlike '.*' })
    if ($keys.Count -eq 1) { $StickKey = $keys[0].FullName }
  }
}
if (-not $StickKey) { Stop-Fail 'no sé con qué frase abre la boveda del pendrive: pasá -StickKey <archivo>' }
if (-not (Test-Path $StickKey)) { Stop-Fail "no encuentro la frase del pendrive en $StickKey" }

# 2. The carried vault must open with that phrase before touching anything.
Write-Log 'verificando la boveda del pendrive'
$verifyOut = & $node $cli verify --store $stickVault --key-file $StickKey 2>&1
$verifyCode = $LASTEXITCODE
foreach ($line in $verifyOut) { Write-Log ('  ' + $line) }
if ($verifyCode -ne 0) { Stop-Fail 'la boveda del pendrive no verifica: no se toca la local' }

$dshHome = Split-Path -Parent $SessionsRoot
Write-Log "boveda local: $Vault"
Write-Log "home de DSH: $dshHome"

# 3. Import: verify, merge, swap (keeping the previous vault) and restore.
$out = & $node $cli import --from $stick --stick-key $StickKey --store $Vault --key-file $KeyFile --home $dshHome --swap 2>&1
$code = $LASTEXITCODE
foreach ($line in $out) { Write-Log ('  ' + $line) }
if ($code -ne 0) { Stop-Fail 'el import fallo: la boveda anterior sigue en su lugar' }

Write-Log 'boveda montada y verificada: abri DSH'
