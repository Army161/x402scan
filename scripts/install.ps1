# x402scan installer — Windows (PowerShell 5.1+ / PowerShell 7+).
#   irm https://raw.githubusercontent.com/YOUR_USER/x402scan/main/scripts/install.ps1 | iex

$ErrorActionPreference = 'Stop'

function Say  { param($m) Write-Host $m }
function Ok   { param($m) Write-Host "OK  " -ForegroundColor Green -NoNewline; Write-Host $m }
function Warn { param($m) Write-Host "!   " -ForegroundColor Yellow -NoNewline; Write-Host $m }
function Die  { param($m) Write-Host "X   " -ForegroundColor Red -NoNewline; Write-Host $m; exit 1 }

Say ''
Write-Host 'x402scan installer' -ForegroundColor White
Write-Host 'measure the machine-payment economy from chain data' -ForegroundColor DarkGray
Say ''

# --- Node ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Die @'
Node.js not found. Install Node 18+ first:
    winget install OpenJS.NodeJS.LTS
    choco install nodejs-lts
    https://nodejs.org
Then reopen this terminal.
'@
}

$major = [int](node -p 'process.versions.node.split(".")[0]')
if ($major -lt 18) {
  Die "Node $(node -v) found, but 18+ is required (built-in fetch). Upgrade: https://nodejs.org"
}
Ok "Node $(node -v)"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Die 'npm not found. It normally ships with Node.'
}

# --- Install ---
Write-Host 'installing...' -ForegroundColor DarkGray
try {
  npm install -g x402scan 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'npm exited non-zero' }
  Ok 'installed globally'
} catch {
  Warn 'global install failed'
  Say ''
  Say '  Try an elevated terminal (Run as Administrator), or skip installing:'
  Write-Host '    npx x402scan scan base' -ForegroundColor DarkGray
  Say ''
  exit 1
}

# --- Verify ---
if (-not (Get-Command x402scan -ErrorAction SilentlyContinue)) {
  Warn "installed, but 'x402scan' is not on your PATH"
  Say '  npm global bin directory:'
  Write-Host "    $(npm prefix -g)" -ForegroundColor DarkGray
  Say '  Add it to PATH, or reopen your terminal and try again.'
  exit 1
}
Ok 'x402scan ready'

Say ''
Write-Host 'Try it' -ForegroundColor White
Write-Host '  x402scan scan base' -ForegroundColor DarkGray -NoNewline; Say '          measure Base'
Write-Host '  x402scan scan' -ForegroundColor DarkGray -NoNewline;      Say '               compare all chains'
Say ''
Write-Host 'Connect to Claude Code' -ForegroundColor White
Write-Host '  claude mcp add --scope user x402scan -- npx -y x402scan mcp' -ForegroundColor DarkGray
Say ''
