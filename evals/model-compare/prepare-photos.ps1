# 비교 테스트 1단계: evals/photos 의 사진을 게임과 똑같이 긴 변 1024px · JPEG(품질 86)로 다시 저장한다.
# (게임은 브라우저에서 이렇게 줄여서 보낸다 → lib/battle-client.ts "사진 받기")
# jpg · png · webp · bmp 를 읽는다 (Windows 기본 이미지 디코더 사용). 아이폰 HEIC는 JPG로 바꿔서 넣을 것.
# 결과: evals/model-compare/prepared/p01.jpg … (원본은 그대로 둠). 어떤 원본이 몇 번인지는 prepared/map.txt
# 실행: powershell -ExecutionPolicy Bypass -File evals\model-compare\prepare-photos.ps1
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$src = Join-Path $root "evals\photos"
$dst = Join-Path $PSScriptRoot "prepared"
if (Test-Path $dst) { Remove-Item (Join-Path $dst "*") -Force }
New-Item -ItemType Directory -Force $dst | Out-Null

$files = Get-ChildItem $src -File | Where-Object { $_.Extension -match '^\.(jpe?g|png|webp|bmp)$' } | Sort-Object Name
if (-not $files) { Write-Host "evals/photos 에 사진이 없습니다."; exit 1 }

$map = @()
$i = 0
foreach ($f in $files) {
  $stream = $null
  try {
    $stream = [IO.File]::OpenRead($f.FullName)
    $dec = [System.Windows.Media.Imaging.BitmapDecoder]::Create($stream, [System.Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat, [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
    [System.Windows.Media.Imaging.BitmapSource]$bmp = $dec.Frames[0]

    # 휴대폰 사진 회전 정보(EXIF Orientation) 반영
    $angle = 0
    try {
      $o = $dec.Frames[0].Metadata.GetQuery("System.Photo.Orientation")
      switch ([int]$o) { 3 { $angle = 180 } 6 { $angle = 90 } 8 { $angle = 270 } }
    } catch { }
    if ($angle -ne 0) { $bmp = New-Object System.Windows.Media.Imaging.TransformedBitmap($bmp, (New-Object System.Windows.Media.RotateTransform($angle))) }

    $k = [Math]::Min(1.0, 1024.0 / [Math]::Max($bmp.PixelWidth, $bmp.PixelHeight))
    if ($k -lt 1.0) { $bmp = New-Object System.Windows.Media.Imaging.TransformedBitmap($bmp, (New-Object System.Windows.Media.ScaleTransform($k, $k))) }
    # 투명 배경(png·webp)은 JPEG 에서 검게 나오지 않도록 BGR24 로 바꿈
    $bmp = New-Object System.Windows.Media.Imaging.FormatConvertedBitmap($bmp, [System.Windows.Media.PixelFormats]::Bgr24, $null, 0)

    $enc = New-Object System.Windows.Media.Imaging.JpegBitmapEncoder
    $enc.QualityLevel = 86
    $enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bmp))
    $name = "p{0:D2}.jpg" -f ($i + 1)
    $out = [IO.File]::Create((Join-Path $dst $name))
    $enc.Save($out); $out.Close()
    $i++
    $map += "$name`t$($f.Name)"
    Write-Host ("{0} -> {1} ({2}x{3})" -f $f.Name, $name, $bmp.PixelWidth, $bmp.PixelHeight)
  } catch {
    Write-Host ("건너뜀: {0} ({1})" -f $f.Name, $_.Exception.Message)
  } finally {
    if ($stream) { $stream.Close() }
  }
}
$map | Set-Content -Encoding UTF8 (Join-Path $dst "map.txt")
Write-Host "$i 장 준비됨 → evals/model-compare/prepared"
