# =====================================================================
#  Build a signed Android APK with the raw SDK toolchain (no Gradle).
#
#  Pipeline:
#    aapt2 compile  ->  aapt2 link (+assets)  ->  javac  ->  d8
#    ->  inject classes.dex  ->  zipalign  ->  apksigner
#
#  ASCII only: this file is executed by Windows PowerShell 5.1.
# =====================================================================
$ErrorActionPreference = 'Continue'

$ROOT   = 'H:\DSHworkspace\Deepseek-Android'
$TC     = Join-Path $ROOT '.toolchain'
$JDK    = Join-Path $TC 'jdk'
$BT     = Join-Path $TC 'android-sdk\build-tools\34.0.0'
$PLAT   = Join-Path $TC 'android-sdk\platforms\android-35'
$JAR    = Join-Path $PLAT 'android.jar'

$APP    = Join-Path $ROOT 'app'
$RES    = Join-Path $APP 'android\res'
$MANI   = Join-Path $APP 'android\AndroidManifest.xml'
$JAVA   = Join-Path $APP 'android\java'
$WEB    = Join-Path $APP 'web'

$BUILD  = Join-Path $ROOT 'build'
$DIST   = Join-Path $ROOT 'dist'

$JAVA_EXE   = Join-Path $JDK 'bin\java.exe'
$JAVAC_EXE  = Join-Path $JDK 'bin\javac.exe'
$KEYTOOL    = Join-Path $JDK 'bin\keytool.exe'

$AAPT2      = Join-Path $BT 'aapt2.exe'
$ZIPALIGN   = Join-Path $BT 'zipalign.exe'
$D8_JAR     = Join-Path $BT 'lib\d8.jar'
$APKSIGNER  = Join-Path $BT 'lib\apksigner.jar'

$VERSION_CODE = '13'
$VERSION_NAME = '1.5.0'
$MIN_SDK      = '24'
$TARGET_SDK   = '34'

$KEYSTORE   = Join-Path $ROOT 'keystore\deepseek-orca.jks'
$KS_ALIAS   = 'deepseek'
# NOTE: keep this file ASCII-only. PowerShell 5.1 reads BOM-less files using the
# system ANSI codepage, so non-ASCII comments here corrupt parsing.
# Override the passphrase with an env var if you use your own keystore.
$KS_PASS    = if ($env:DSH_KS_PASS) { $env:DSH_KS_PASS } else { 'deepseek123' }

function Step($msg) { Write-Host ''; Write-Host "=== $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "FAILED: $msg" -ForegroundColor Red; exit 1 }

function Run($exe, $arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { Fail "$exe exited with $LASTEXITCODE" }
}

# ---------------------------------------------------------------------
Step 'prepare directories'
# ---------------------------------------------------------------------
foreach ($d in @($BUILD, $DIST)) {
  if (Test-Path $d) { Remove-Item -Recurse -Force $d }
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}
$assets = Join-Path $BUILD 'assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null
Copy-Item -Path (Join-Path $WEB '*') -Destination $assets -Recurse -Force
Write-Host "assets: $((Get-ChildItem $assets -Recurse -File).Count) files"

$compiledRes = Join-Path $BUILD 'res.zip'
$baseApk     = Join-Path $BUILD 'base.apk'
$classesDir  = Join-Path $BUILD 'classes'
$dexDir      = Join-Path $BUILD 'dex'
New-Item -ItemType Directory -Force -Path $classesDir, $dexDir | Out-Null

# ---------------------------------------------------------------------
Step 'aapt2 compile (resources)'
# ---------------------------------------------------------------------
Run $AAPT2 @('compile', '--dir', $RES, '-o', $compiledRes)
Write-Host "compiled resources: $((Get-Item $compiledRes).Length) bytes"

# ---------------------------------------------------------------------
Step 'aapt2 link (manifest + resources + assets)'
# ---------------------------------------------------------------------
Run $AAPT2 @(
  'link',
  '-o', $baseApk,
  '-I', $JAR,
  '--manifest', $MANI,
  '-R', $compiledRes,
  '-A', $assets,
  '--min-sdk-version', $MIN_SDK,
  '--target-sdk-version', $TARGET_SDK,
  '--version-code', $VERSION_CODE,
  '--version-name', $VERSION_NAME,
  '--auto-add-overlay'
)
Write-Host "linked apk: $((Get-Item $baseApk).Length) bytes"

# ---------------------------------------------------------------------
Step 'javac (java sources)'
# ---------------------------------------------------------------------
$sources = Get-ChildItem -Path $JAVA -Recurse -Filter '*.java' | ForEach-Object { $_.FullName }
Write-Host "sources: $($sources.Count)"
$argFile = Join-Path $BUILD 'sources.txt'
Set-Content -Path $argFile -Value ($sources | ForEach-Object { '"' + ($_ -replace '\\', '\\') + '"' }) -Encoding ASCII

# NOTE: build the argument list step by step. Writing '@' + $argFile directly
# inside an @( ... ) literal is parsed as a here-string opener by PowerShell.
$javacArgs = @(
  '-encoding', 'UTF-8',
  '-source', '11', '-target', '11',
  '-nowarn',
  '-cp', $JAR,
  '-d', $classesDir
)
$javacArgs += ('@' + $argFile)
Run $JAVAC_EXE $javacArgs
$classCount = (Get-ChildItem -Path $classesDir -Recurse -Filter '*.class').Count
Write-Host "compiled classes: $classCount"
if ($classCount -eq 0) { Fail 'no class files produced' }

# ---------------------------------------------------------------------
Step 'd8 (dex)'
# ---------------------------------------------------------------------
$classFiles = Get-ChildItem -Path $classesDir -Recurse -Filter '*.class' | ForEach-Object { $_.FullName }
$d8Args = @('-cp', $D8_JAR, 'com.android.tools.r8.D8',
            '--min-api', $MIN_SDK, '--lib', $JAR, '--output', $dexDir) + $classFiles
Run $JAVA_EXE $d8Args
$dexFile = Join-Path $dexDir 'classes.dex'
if (-not (Test-Path $dexFile)) { Fail 'd8 did not produce classes.dex' }
Write-Host "classes.dex: $((Get-Item $dexFile).Length) bytes"

# ---------------------------------------------------------------------
Step 'package apk (inject classes.dex, store+align resources.arsc)'
# ---------------------------------------------------------------------
$unsigned = Join-Path $BUILD 'unsigned.apk'
Run 'node' @((Join-Path $ROOT 'tools\pack-apk.mjs'), $baseApk, $dexFile, $unsigned)
Write-Host "packed: $((Get-Item $unsigned).Length) bytes"

# ---------------------------------------------------------------------
Step 'zipalign'
# ---------------------------------------------------------------------
$aligned = Join-Path $BUILD 'aligned.apk'
Run $ZIPALIGN @('-f', '-p', '4', $unsigned, $aligned)

# ---------------------------------------------------------------------
Step 'keystore'
# ---------------------------------------------------------------------
if (-not (Test-Path $KEYSTORE)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $KEYSTORE) | Out-Null
  Write-Host 'generating a new signing key (valid 30 years)'
  Run $KEYTOOL @(
    '-genkeypair',
    '-keystore', $KEYSTORE,
    '-alias', $KS_ALIAS,
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10950',
    '-storepass', $KS_PASS, '-keypass', $KS_PASS,
    '-dname', 'CN=DeepSeek Orca, OU=Personal, O=Personal, L=Local, ST=Local, C=CN'
  )
} else {
  Write-Host "keystore exists: $KEYSTORE"
}

# ---------------------------------------------------------------------
Step 'apksigner sign'
# ---------------------------------------------------------------------
$final = Join-Path $DIST "DeepSleep-$VERSION_NAME.apk"
Run $JAVA_EXE @(
  '-jar', $APKSIGNER,
  'sign',
  '--ks', $KEYSTORE,
  '--ks-key-alias', $KS_ALIAS,
  '--ks-pass', "pass:$KS_PASS",
  '--key-pass', "pass:$KS_PASS",
  '--v1-signing-enabled', 'true',
  '--v2-signing-enabled', 'true',
  '--v3-signing-enabled', 'true',
  '--out', $final,
  $aligned
)

# ---------------------------------------------------------------------
Step 'verify'
# ---------------------------------------------------------------------
Run $JAVA_EXE @('-jar', $APKSIGNER, 'verify', '--verbose', '--print-certs', $final)
Write-Host ''
Run $AAPT2 @('dump', 'badging', $final)

# ---------------------------------------------------------------------
Step 'verify apk structure'
# ---------------------------------------------------------------------
Run 'node' @((Join-Path $ROOT 'tools\verify-apk.mjs'), $final)

Write-Host ''
Write-Host "APK: $final  ($([math]::Round((Get-Item $final).Length / 1MB, 2)) MB)" -ForegroundColor Green
