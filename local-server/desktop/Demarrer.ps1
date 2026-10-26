param([switch]$SansNavigateur)
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$node=Join-Path $root 'outils\node.exe'
$settings=Get-Content -LiteralPath (Join-Path $root 'settings.json') -Raw | ConvertFrom-Json
$server=$null;$tunnel=$null;$published=$false
try {
 try {$health=Invoke-RestMethod 'http://127.0.0.1:4173/health' -TimeoutSec 2;if($health.app -eq 'HubParents-local'){Write-Host 'Le serveur est déjà démarré.';if(-not $SansNavigateur){Start-Process $settings.gameUrl};exit 0}} catch {}
 Write-Host 'Démarrage du serveur et de la base locale...'
 $env:BRAWL_ROOT=$root
 $server=Start-Process -FilePath $node -ArgumentList ('"'+(Join-Path $root 'serveur\server.mjs')+'"') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'journaux\serveur.log') -RedirectStandardError (Join-Path $root 'journaux\serveur-erreurs.log')
 $ready=$false
 for($i=0;$i -lt 40;$i++){Start-Sleep -Milliseconds 250;$server.Refresh();if($server.HasExited){throw 'Le serveur a quitté. Voir journaux\serveur-erreurs.log.'};try{if((Invoke-RestMethod 'http://127.0.0.1:4173/health' -TimeoutSec 1).app -eq 'HubParents-local'){$ready=$true;break}}catch{}}
 if(-not $ready){throw 'Le port 4173 ne répond pas.'}
 Write-Host 'Connexion du lien habituel à cet ordinateur...'
 $tunnel=Start-Process -FilePath (Join-Path $root 'outils\cloudflared.exe') -ArgumentList 'tunnel','--no-autoupdate','--url','http://127.0.0.1:4173','--protocol','http2' -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'journaux\tunnel.log') -RedirectStandardError (Join-Path $root 'journaux\tunnel-erreurs.log')
 $origin=$null
 for($i=0;$i -lt 180;$i++){Start-Sleep -Milliseconds 500;$tunnel.Refresh();if($tunnel.HasExited){throw 'Le relais Internet a quitté. Voir journaux\tunnel-erreurs.log.'};$log=Get-Content -LiteralPath (Join-Path $root 'journaux\tunnel-erreurs.log') -Raw -ErrorAction SilentlyContinue;$tunnelAddress=[regex]::Match(($log -join "`n"),'https://[a-z0-9-]+\.trycloudflare\.com');if($tunnelAddress.Success){$origin=$tunnelAddress.Value;break}}
 if(-not $origin){throw 'Le relais Internet ne répond pas.'}
 $ready=$false
 for($i=0;$i -lt 20;$i++){try{if((Invoke-RestMethod ($origin+'/health') -TimeoutSec 4).app -eq 'HubParents-local'){$ready=$true;break}}catch{};Start-Sleep -Seconds 1}
 if(-not $ready){throw 'Le serveur local fonctionne, mais le relais Internet est indisponible.'}
 & $node (Join-Path $root 'serveur\publish.mjs') online $origin
 if($LASTEXITCODE -ne 0){throw "La mise à jour du lien a échoué."};$published=$true
 @{server=$server.Id;tunnel=$tunnel.Id;serverStarted=$server.StartTime.ToUniversalTime().ToString('o');tunnelStarted=$tunnel.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'data\processus.json') -Encoding UTF8
 Write-Host '';Write-Host 'SERVEUR EN MARCHE' -ForegroundColor Green
 Write-Host ('Lien du jeu : '+$settings.gameUrl)
 Write-Host 'Les comptes et les sauvegardes sont sur ce PC.'
 Write-Host 'Garde cette fenêtre ouverte. Pour arrêter, utilise ARRETER.cmd.'
 if(-not $SansNavigateur){Start-Process $settings.gameUrl}
 while($true){Start-Sleep -Seconds 2;$server.Refresh();$tunnel.Refresh();if($server.HasExited -or $tunnel.HasExited){break}}
} catch {Write-Host $_.Exception.Message -ForegroundColor Red;exit 1}
finally {
 if($tunnel){$tunnel.Refresh();if(-not $tunnel.HasExited){Stop-Process -Id $tunnel.Id -ErrorAction SilentlyContinue}}
 if($server){$server.Refresh();if(-not $server.HasExited){Stop-Process -Id $server.Id -ErrorAction SilentlyContinue}}
 if($published){& $node (Join-Path $root 'serveur\publish.mjs') offline}
 if($server){Remove-Item -LiteralPath (Join-Path $root 'data\processus.json') -ErrorAction SilentlyContinue}
}
