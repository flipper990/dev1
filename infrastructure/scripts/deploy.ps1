#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

# ─── DEVteam Deploy Script (PowerShell) ──────────────────────────────────────
$RootDir = (Get-Item "$PSScriptRoot\..").FullName

function Info  { param([string]$msg) Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Error { param([string]$msg) Write-Host "[ERROR] $msg" -ForegroundColor Red; exit 1 }

# ── Validate environment ──────────────────────────────────────────────────────
Info "Validating environment..."
if (-not $env:OPENAI_API_KEY)  { Error "OPENAI_API_KEY is not set" }
if (-not $env:JWT_SECRET)      { Error "JWT_SECRET is not set" }
if (-not $env:API_KEY_SALT)    { Error "API_KEY_SALT is not set" }

# ── Build ─────────────────────────────────────────────────────────────────────
Info "Building images..."
Set-Location $RootDir
docker compose build --no-cache

# ── Deploy ────────────────────────────────────────────────────────────────────
Info "Starting services..."
docker compose up -d

# ── Health check ──────────────────────────────────────────────────────────────
Info "Waiting for backend health..."
$attempts = 0
do {
  Start-Sleep -Seconds 2
  $attempts++
  try { $null = Invoke-WebRequest -Uri "http://localhost:3001/health" -UseBasicParsing -ErrorAction SilentlyContinue }
  catch { continue }
  Info "Backend healthy"
  break
} while ($attempts -lt 30)

if ($attempts -ge 30) { Error "Backend did not become healthy in time" }

Info "Deploy complete — frontend: http://localhost:3000"
