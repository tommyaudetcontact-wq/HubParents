$ErrorActionPreference='Stop'
try {$health=Invoke-RestMethod 'http://127.0.0.1:4173/health' -TimeoutSec 2} catch {$health=$null}
if($health.app -eq 'HubParents-local'){Write-Host 'Arrête le serveur avec ARRETER.cmd avant la mise à jour.';exit 1}
$settings=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'settings.json') -Raw | ConvertFrom-Json
$temp=Join-Path $env:TEMP ('brawl-update-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
 Write-Host 'Téléchargement de la dernière version GitHub...'
 $archive=Join-Path $temp 'jeu.zip'
 Invoke-WebRequest -UseBasicParsing 'https://codeload.github.com/tommyaudetcontact-wq/HubParents/zip/refs/heads/main' -OutFile $archive
 Expand-Archive -LiteralPath $archive -DestinationPath $temp
 & $settings.python (Join-Path $temp 'HubParents-main\scripts\package-local-server.py') $PSScriptRoot
 if($LASTEXITCODE -ne 0){throw 'La mise à jour a échoué.'}
 Write-Host 'Mise à jour terminée. La base et les sauvegardes ont été conservées.' -ForegroundColor Green
}catch{Write-Host $_.Exception.Message -ForegroundColor Red;exit 1}
