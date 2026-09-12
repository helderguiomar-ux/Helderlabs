# HelderLabs ERP — instalacao do atalho no Ambiente de Trabalho
#
# Corre uma vez. Cria o icone que abre o ERP.
#   Clique direito neste ficheiro -> "Executar com o PowerShell"

$ErrorActionPreference = 'Stop'

$here      = Split-Path -Parent $MyInvocation.MyCommand.Path
$launchVbs = Join-Path $here 'launch.vbs'
$iconPath  = Join-Path $here 'helderlabs-erp.ico'
$publicDir = Join-Path (Split-Path -Parent $here) 'backend\public\login.html'

Write-Host ''
Write-Host '  HelderLabs ERP - instalacao do cliente local' -ForegroundColor Cyan
Write-Host '  --------------------------------------------'
Write-Host ''

# --- Verificacoes ------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '  [ERRO] Node.js nao encontrado no PATH.' -ForegroundColor Red
  Write-Host '         Instala a partir de https://nodejs.org e volta a correr.'
  Write-Host ''
  Read-Host '  Enter para fechar'
  exit 1
}
Write-Host "  [OK] Node.js $(node --version)" -ForegroundColor Green

if (-not (Test-Path $launchVbs)) {
  Write-Host "  [ERRO] Nao encontrado: $launchVbs" -ForegroundColor Red
  Read-Host '  Enter para fechar'; exit 1
}
Write-Host '  [OK] launch.vbs' -ForegroundColor Green

if (-not (Test-Path $publicDir)) {
  Write-Host "  [ERRO] Nao encontrei as paginas do ERP em:" -ForegroundColor Red
  Write-Host "         $publicDir"
  Write-Host '         A pasta local-client tem de estar na raiz do repositorio.'
  Read-Host '  Enter para fechar'; exit 1
}
Write-Host '  [OK] Ficheiros do ERP' -ForegroundColor Green

# --- Atalho ------------------------------------------------------------------
$desktopPaths = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path $env:USERPROFILE 'OneDrive\Área de Trabalho'),
  (Join-Path $env:USERPROFILE 'OneDrive\Desktop'),
  (Join-Path $env:USERPROFILE 'Desktop')
) | Select-Object -Unique | Where-Object { Test-Path $_ }

$shell = New-Object -ComObject WScript.Shell

foreach ($dt in $desktopPaths) {
  $shortcutFile = Join-Path $dt 'HelderLabs ERP Desktop.lnk'
  $lnk = $shell.CreateShortcut($shortcutFile)
  $lnk.TargetPath       = 'wscript.exe'
  $lnk.Arguments        = """$launchVbs"""
  $lnk.WorkingDirectory = $here
  $lnk.Description      = 'HelderLabs ERP — Cliente Desktop (API & BD de Produção)'
  if (Test-Path $iconPath) { $lnk.IconLocation = $iconPath }
  $lnk.Save()
  Write-Host "  [OK] Atalho criado em: $shortcutFile" -ForegroundColor Green
}

Write-Host ''
Write-Host '  Duplo clique no ícone HelderLabs ERP Desktop para abrir.' -ForegroundColor Cyan
Write-Host '  Os dados são os de PRODUÇÃO (https://helderlabs.eu).' -ForegroundColor Yellow
Write-Host ''
Read-Host '  Enter para fechar'
