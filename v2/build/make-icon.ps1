# Builds the app icon: a PNG-payload .ico (supported since Vista) plus a plain
# PNG for the tray. Drawn rather than shipped as a binary blob so it stays
# editable and reviewable.
Add-Type -AssemblyName System.Drawing

$out = "C:\Users\Cappy\Documents\PROGRAMING PROJECTS\hytenexusspotify\v2\build"
New-Item -ItemType Directory -Force -Path $out | Out-Null

function New-Art([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear([System.Drawing.Color]::Transparent)

  $pad = [int]($size * 0.06)
  $r = [int]($size * 0.22)
  $rect = New-Object System.Drawing.Rectangle($pad, $pad, ($size - 2*$pad), ($size - 2*$pad))

  # Rounded-rect path.
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
  $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
  $path.CloseFigure()

  # Near-black body, matching the dashboard's own background.
  $body = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 10, 8, 14))
  $g.FillPath($body, $path)

  # Purple border — the Main Purple accent.
  $penW = [Math]::Max(2, [int]($size * 0.045))
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 168, 92, 214)), $penW
  $g.DrawPath($pen, $path)

  # A tall portrait panel with a dock bar under it: the thing itself.
  $pw = [int]($size * 0.26)
  $ph = [int]($size * 0.46)
  $px = [int](($size - $pw) / 2)
  $py = [int]($size * 0.20)
  $screenBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 168, 92, 214))
  $g.FillRectangle($screenBrush, $px, $py, $pw, $ph)

  $dockH = [int]($size * 0.11)
  $dockY = $py + $ph + [int]($size * 0.06)
  $dim = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(150, 168, 92, 214))
  $g.FillRectangle($dim, $px, $dockY, $pw, $dockH)

  $g.Dispose()
  return $bmp
}

# --- PNG for the tray -------------------------------------------------------
$png32 = New-Art 32
$png32.Save("$out\tray.png", [System.Drawing.Imaging.ImageFormat]::Png)
$png32.Dispose()

# --- .ico containing several PNG-compressed sizes ---------------------------
$sizes = @(16, 32, 48, 64, 128, 256)
$blobs = @()
foreach ($s in $sizes) {
  $bmp = New-Art $s
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $blobs += ,@($s, $ms.ToArray())
  $ms.Dispose(); $bmp.Dispose()
}

$fs = New-Object System.IO.FileStream("$out\icon.ico", [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)                 # reserved
$bw.Write([UInt16]1)                 # type: icon
$bw.Write([UInt16]$blobs.Count)

# Directory entries come first, then every image; offsets account for both.
$offset = 6 + (16 * $blobs.Count)
foreach ($b in $blobs) {
  $s = $b[0]; $bytes = $b[1]
  $dim8 = $(if ($s -ge 256) { 0 } else { $s })   # 0 means 256 in an ICO entry
  $bw.Write([Byte]$dim8)
  $bw.Write([Byte]$dim8)
  $bw.Write([Byte]0)                 # palette size
  $bw.Write([Byte]0)                 # reserved
  $bw.Write([UInt16]1)               # colour planes
  $bw.Write([UInt16]32)              # bits per pixel
  $bw.Write([UInt32]$bytes.Length)
  $bw.Write([UInt32]$offset)
  $offset += $bytes.Length
}
foreach ($b in $blobs) { $bw.Write($b[1]) }
$bw.Flush(); $bw.Close(); $fs.Close()

"icon.ico  : {0} bytes ({1} sizes)" -f (Get-Item "$out\icon.ico").Length, $blobs.Count
"tray.png  : {0} bytes" -f (Get-Item "$out\tray.png").Length
