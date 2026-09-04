# Runs the whole brain pipeline once: harvest new prompts, rebuild the interest
# map, assemble a briefing, and export it to the public site.
#
# Designed for Windows Task Scheduler. See the root README for registration.
#
#   .\scripts\daily.ps1           # update everything locally
#   .\scripts\daily.ps1 -Push     # ...and push the briefing so Vercel redeploys
#
# -Push is opt-in on purpose: publishing is outward-facing, and a scheduled task
# that silently pushes to a public repository should be a deliberate choice.

param(
    [switch]$Push
)

$ErrorActionPreference = 'Stop'

$app  = Split-Path -Parent $PSScriptRoot          # daily_newsletter/
$repo = Split-Path -Parent $app                   # personal_website/
$log  = Join-Path $app 'data\daily.log'

function Write-Log([string]$Message) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Write-Output $line
    Add-Content -Path $log -Value $line -Encoding utf8
}

New-Item -ItemType Directory -Force (Join-Path $app 'data') | Out-Null
Set-Location $app

try {
    Write-Log 'ingest: reading new prompts'
    npm run --silent ingest
    if ($LASTEXITCODE -ne 0) { throw "ingest failed ($LASTEXITCODE)" }

    Write-Log 'digest: assembling briefing'
    npm run --silent digest
    if ($LASTEXITCODE -ne 0) { throw "digest failed ($LASTEXITCODE)" }

    Write-Log 'publish: exporting to site'
    npm run --silent publish
    if ($LASTEXITCODE -ne 0) { throw "publish failed ($LASTEXITCODE)" }

    if ($Push) {
        Set-Location $repo
        $data = 'site/src/data/briefings.json'
        # Only the exported briefings are ever committed by this script. The
        # database holding your prompts is gitignored and stays put.
        git add -- $data
        $staged = git diff --cached --name-only
        if ($staged) {
            git commit -m ("briefings: {0}" -f (Get-Date -Format 'yyyy-MM-dd')) | Out-Null
            git push
            if ($LASTEXITCODE -ne 0) { throw "push failed ($LASTEXITCODE)" }
            Write-Log 'pushed; Vercel will redeploy'
        }
        else {
            Write-Log 'no briefing changes to push'
        }
    }

    Write-Log 'done'
}
catch {
    Write-Log ("ERROR: {0}" -f $_.Exception.Message)
    exit 1
}
