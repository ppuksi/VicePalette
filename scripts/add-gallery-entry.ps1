param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath
)

$ErrorActionPreference = "Stop"

# scripts\ -> project root is one level up from this file
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

if (-not (Test-Path -LiteralPath $FilePath)) {
    Write-Host "File not found: $FilePath" -ForegroundColor Red
    exit 1
}

$File = Get-Item -LiteralPath $FilePath
$Ext  = $File.Extension.ToLower()

$ImageExts = @('.jpg', '.jpeg', '.png', '.webp', '.gif')
$VideoExts = @('.mp4', '.webm', '.mov')

if ($ImageExts -contains $Ext) {
    $MediaType = 'image'
} elseif ($VideoExts -contains $Ext) {
    $MediaType = 'video'
} else {
    Write-Host "Unrecognized extension '$Ext' - expected an image or video file." -ForegroundColor Red
    exit 1
}

function ConvertTo-Slug([string]$Text) {
    $slug = $Text.ToLower()
    $slug = $slug -replace '[^a-z0-9]+', '-'
    $slug = $slug.Trim('-')
    if ([string]::IsNullOrWhiteSpace($slug)) { $slug = 'untitled' }
    return $slug
}

function Escape-Yaml([string]$Text) {
    return $Text -replace '"', '\"'
}

Write-Host ""
Write-Host "Adding: $($File.Name)" -ForegroundColor Cyan

$DefaultTitle = ($File.BaseName -replace '[_\-]+', ' ').Trim()
$Title = Read-Host "Title [$DefaultTitle]"
if ([string]::IsNullOrWhiteSpace($Title)) { $Title = $DefaultTitle }

$Pipeline = ""
while ([string]::IsNullOrWhiteSpace($Pipeline)) {
    $Pipeline = Read-Host "Pipeline (e.g. ltx-2.3, krea2, wan-2.2, illustrious)"
}

# Resolve a unique slug/folder so repeated runs don't collide.
$BaseSlug = ConvertTo-Slug $Title
$Slug     = $BaseSlug
$MediaDir = Join-Path $ProjectRoot "public\gallery\$Slug"
$i = 2
while (Test-Path -LiteralPath $MediaDir) {
    $Slug     = "$BaseSlug-$i"
    $MediaDir = Join-Path $ProjectRoot "public\gallery\$Slug"
    $i++
}

New-Item -ItemType Directory -Path $MediaDir | Out-Null

$DestFile = Join-Path $MediaDir $File.Name
Copy-Item -LiteralPath $File.FullName -Destination $DestFile

$SrcPath    = "/gallery/$Slug/$($File.Name)"
$PosterPath = $null

if ($MediaType -eq 'video') {
    $ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($ffmpeg) {
        $PosterFile = Join-Path $MediaDir "poster.jpg"
        & ffmpeg -y -loglevel error -i $DestFile -ss 00:00:01 -vframes 1 $PosterFile
        if (Test-Path -LiteralPath $PosterFile) {
            $PosterPath = "/gallery/$Slug/poster.jpg"
        }
    } else {
        Write-Host "ffmpeg not found on PATH - skipping poster frame, add one manually." -ForegroundColor Yellow
    }
}

$Date = Get-Date -Format 'yyyy-MM-dd'
$TitleEsc    = Escape-Yaml $Title
$PipelineEsc = Escape-Yaml $Pipeline

$Lines = @(
    '---'
    "title: `"$TitleEsc`""
    "pipeline: `"$PipelineEsc`""
    "date: $Date"
    "mediaType: `"$MediaType`""
    "src: `"$SrcPath`""
)
if ($PosterPath) {
    $Lines += "poster: `"$PosterPath`""
}
$Lines += @(
    'description: ""'
    '# params:'
    '#   sampler: ""'
    '#   cfg: ""'
    '#   steps: ""'
    '#   seed: ""'
    'tags: []'
    '---'
    ''
    ''
)

$MdPath = Join-Path $ProjectRoot "src\content\gallery\$Slug.md"
$Lines -join "`r`n" | Set-Content -LiteralPath $MdPath -Encoding UTF8

Write-Host ""
Write-Host "Done:" -ForegroundColor Green
Write-Host "  $DestFile"
if ($PosterPath) { Write-Host "  $MediaDir\poster.jpg" }
Write-Host "  $MdPath"
Write-Host ""

notepad $MdPath
