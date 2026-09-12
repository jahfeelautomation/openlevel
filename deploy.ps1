$ErrorActionPreference = 'Stop'

Write-Host "========================================"
Write-Host "🚀 OpenLevel Deployment Script"
Write-Host "========================================"

$projectDir = "C:\Users\Ghost\.openclaw\workspace\projects\openlevel"
$serverIp = "87.99.129.115"
$deployDir = "/opt/openlevel"

Set-Location $projectDir

Write-Host "`n[1/5] Pushing changes to GitHub..."
git add .
$gitStatus = git status --porcelain
if ($gitStatus) {
    git commit -m "auto-deploy: update from deployment script"
    git push
    Write-Host "✓ GitHub updated successfully."
} else {
    Write-Host "✓ No new changes to push to GitHub."
}

Write-Host "`n[2/5] Building SPA (Vite)..."
npm run build
Write-Host "✓ Build complete."

Write-Host "`n[3/5] Packaging files for transfer..."
tar.exe -czf dist.tar.gz -C dist .
tar.exe -czf app.tar.gz --exclude=node_modules --exclude=dist --exclude=.git --exclude=dist.tar.gz --exclude=app.tar.gz --exclude=deploy.ps1 .
Write-Host "✓ Packaging complete."

Write-Host "`n[4/5] Uploading to Hetzner ($serverIp)..."
scp dist.tar.gz root@${serverIp}:${deployDir}/dist.tar.gz
scp app.tar.gz root@${serverIp}:${deployDir}/app.tar.gz
Write-Host "✓ Upload complete."

Write-Host "`n[5/5] Extracting and restarting API container..."
ssh root@${serverIp} 'cd /opt/openlevel && rm -rf dist/* && tar xzf dist.tar.gz -C dist && rm dist.tar.gz'
ssh root@${serverIp} 'cd /opt/openlevel && tar xzf app.tar.gz -C app && rm app.tar.gz'
ssh root@${serverIp} 'cd /opt/openlevel && docker compose restart api'

Write-Host "`n========================================"
Write-Host "✅ Deployment to Hetzner finished successfully!"
Write-Host "========================================"
