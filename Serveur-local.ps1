param([int]$Port=4173,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$webRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'dist'))
$listener=$null
for($attempt=0;$attempt -lt 10;$attempt++){
  $candidate=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,$Port)
  try {$candidate.Start();$listener=$candidate;break} catch {
    try {$existing=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$Port/";if($existing.Content -match 'handwriting-ocr.js') {if(-not $NoBrowser){Start-Process "http://127.0.0.1:$Port/"};exit}} catch {}
    $Port++
  }
}
if(-not $listener){throw 'Aucun port local disponible.'}
if(-not $NoBrowser){Start-Process "http://127.0.0.1:$Port/"}
$types=@{'.html'='text/html; charset=utf-8';'.js'='application/javascript; charset=utf-8';'.css'='text/css; charset=utf-8';'.svg'='image/svg+xml';'.jpg'='image/jpeg';'.png'='image/png';'.wasm'='application/wasm';'.txt'='text/plain; charset=utf-8'}
try {while($true){
  $client=$listener.AcceptTcpClient();$client.ReceiveTimeout=5000
  try {
    $stream=$client.GetStream();$reader=[System.IO.StreamReader]::new($stream)
    $request=$reader.ReadLine();if(-not $request){continue}
    while($reader.ReadLine()){}
    $parts=$request.Split(' ');$relative=[Uri]::UnescapeDataString(($parts[1].Split('?')[0])).TrimStart('/')
    if(-not $relative){$relative='index.html'}
    $file=[System.IO.Path]::GetFullPath((Join-Path $webRoot $relative))
    $code='200 OK';$body=[byte[]]@();$type='text/plain'
    if($parts[0] -notin @('GET','HEAD')){$code='405 Method Not Allowed'}
    elseif(-not $file.StartsWith($webRoot+[System.IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){$code='403 Forbidden'}
    elseif(-not [System.IO.File]::Exists($file)){$code='404 Not Found'}
    else {$body=[System.IO.File]::ReadAllBytes($file);$ext=[System.IO.Path]::GetExtension($file);$type=$types[$ext];if(-not $type){$type='application/octet-stream'}}
    $header=[Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $code`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n")
    $stream.Write($header,0,$header.Length);if($parts[0] -ne 'HEAD'){$stream.Write($body,0,$body.Length)}
  } catch {} finally {$client.Close()}
}} finally {$listener.Stop()}
