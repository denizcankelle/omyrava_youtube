# Masaustune "Omyrava Studio" kisayolu olusturur (OneDrive masaustu dahil).
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$lnk = Join-Path $desktop "Omyrava Studio.lnk"
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = Join-Path $env:WINDIR "System32\wscript.exe"
$s.Arguments = '"' + (Join-Path $root "ACILIS.vbs") + '"'
$s.WorkingDirectory = $root
$s.IconLocation = (Join-Path $root "assets\omyrava.ico") + ",0"
$s.Description = "Omyrava Studio panelini acar"
$s.Save()
Write-Output ("Kisayol olusturuldu: " + $lnk)
