$ErrorActionPreference='Stop'
$record=Join-Path $PSScriptRoot 'data\processus.json'
if(-not (Test-Path -LiteralPath $record)){Write-Host 'Aucun serveur enregistré.';exit}
$state=Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
foreach($item in @(@{Id=$state.tunnel;Started=$state.tunnelStarted;Exe='cloudflared.exe'},@{Id=$state.server;Started=$state.serverStarted;Exe='node.exe'})){
 $process=Get-Process -Id $item.Id -ErrorAction SilentlyContinue
 $expected=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('outils\'+$item.Exe)))
 if($process -and $process.Path -eq $expected -and $process.StartTime.ToUniversalTime().ToString('o') -eq $item.Started){Stop-Process -Id $process.Id}
}
Write-Host 'Serveur arrêté. Les sauvegardes restent dans data.'
