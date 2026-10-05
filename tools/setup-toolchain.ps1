$ErrorActionPreference = 'Continue'
$root = 'H:\DSHworkspace\Deepseek-Android'
$dl   = Join-Path $root '.toolchain\dl'
$tc   = Join-Path $root '.toolchain'
$sdk  = Join-Path $tc 'android-sdk'

function Unzip($zip, $dest) {
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest -ErrorAction SilentlyContinue }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  # bsdtar is much faster than Expand-Archive and handles zip natively
  & "$env:SystemRoot\System32\tar.exe" -xf $zip -C $dest
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  tar failed ($LASTEXITCODE), falling back to Expand-Archive"
    Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force
  }
}

function Install($zipName, $tmpName, $finalPath, $label) {
  if (Test-Path (Join-Path $finalPath 'placeholder-never')) { return }
  if (Test-Path $finalPath) { Write-Host "[=] $label already present"; return }
  Write-Host "[x] extracting $label ..."
  $tmp = Join-Path $tc $tmpName
  Unzip (Join-Path $dl $zipName) $tmp
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  New-Item -ItemType Directory -Force -Path (Split-Path $finalPath) | Out-Null
  Move-Item $inner.FullName $finalPath
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  Write-Host "[ok] $label -> $finalPath"
}

Install 'jdk17.zip'                  'jdk-tmp' (Join-Path $tc  'jdk')                        'JDK 17'
Install 'build-tools_r34-windows.zip' 'bt-tmp'  (Join-Path $sdk 'build-tools\34.0.0')        'build-tools 34.0.0'
Install 'platform-35_r01.zip'         'pf-tmp'  (Join-Path $sdk 'platforms\android-35')       'platform android-35'

$jdkRoot = Join-Path $tc 'jdk'
if (-not (Test-Path (Join-Path $jdkRoot 'bin\java.exe'))) {
  $cand = Get-ChildItem $tc -Directory | Where-Object { $_.Name -like 'jdk*' -and $_.Name -ne 'jdk' } | Select-Object -First 1
  if ($cand) { $jdkRoot = $cand.FullName }
}

$bt    = Join-Path $sdk 'build-tools\34.0.0'
$pf    = Join-Path $sdk 'platforms\android-35'
$java  = Join-Path $jdkRoot 'bin\java.exe'
$javac = Join-Path $jdkRoot 'bin\javac.exe'

Write-Host ''
Write-Host '=========== TOOLCHAIN VERIFICATION ==========='
Write-Host "JAVA_HOME   = $jdkRoot"
Write-Host "BUILD_TOOLS = $bt"
Write-Host "PLATFORM    = $pf"
Write-Host ''
Write-Host "-- java -version --"
& $java -version
Write-Host "-- javac -version --"
& $javac -version
Write-Host ''
Write-Host "-- build-tools binaries --"
Get-ChildItem $bt -Include '*.exe','*.bat' -Recurse -Depth 0 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty Name | Sort-Object | ForEach-Object { Write-Host "   $_" }

$jar = Join-Path $pf 'android.jar'
if (Test-Path $jar) {
  Write-Host ("-- android.jar OK  {0:N1} MB" -f ((Get-Item $jar).Length / 1MB))
} else {
  Write-Host "-- android.jar MISSING at $jar"
}

Write-Host ''
Write-Host "-- aapt2 --"
& (Join-Path $bt 'aapt2.exe') version
Write-Host "-- d8 (java -cp lib\d8.jar) --"
& $java -cp (Join-Path $bt 'lib\d8.jar') com.android.tools.r8.D8 --version
Write-Host "-- apksigner (java -jar lib\apksigner.jar) --"
& $java -jar (Join-Path $bt 'lib\apksigner.jar') --version
Write-Host "-- zipalign --"
& (Join-Path $bt 'zipalign.exe') 2>&1 | Select-Object -First 3
Write-Host "-- keytool --"
& (Join-Path $jdkRoot 'bin\keytool.exe') -help 2>&1 | Select-Object -First 1
Write-Host '=========== VERIFICATION DONE ==========='
