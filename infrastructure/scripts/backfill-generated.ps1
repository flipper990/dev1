$projectsDir = "apps/backend/data/projects"
$generatedRoot = "apps/backend/data/generated"

if (-not (Test-Path $projectsDir)) {
  throw "Projects directory not found: $projectsDir"
}

New-Item -ItemType Directory -Path $generatedRoot -Force | Out-Null
$projectFiles = Get-ChildItem -Path $projectsDir -Filter *.json -File
$count = 0

foreach ($projectFile in $projectFiles) {
  $project = Get-Content -Raw $projectFile.FullName | ConvertFrom-Json
  if (-not $project.id) { continue }

  $outDir = Join-Path $generatedRoot $project.id
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null

  $dupes = @{}
  $bundle = New-Object System.Collections.Generic.List[string]
  $bundle.Add("# Project: $($project.name)") | Out-Null
  $bundle.Add("# Project ID: $($project.id)") | Out-Null
  $bundle.Add("# Backfilled At: $(Get-Date -Format o)") | Out-Null
  $bundle.Add("") | Out-Null
  $bundle.Add("# Prompt") | Out-Null
  $bundle.Add([string]$project.prompt) | Out-Null
  $bundle.Add("") | Out-Null
  $bundle.Add("# Files") | Out-Null
  $bundle.Add("") | Out-Null

  foreach ($f in @($project.artifacts.files)) {
    if (-not $f.path) { continue }

    $safe = ([string]$f.path).Replace('\\', '/').Trim().TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($safe)) { continue }

    $segments = $safe.Split('/') | Where-Object { $_ -and $_ -ne '.' -and $_ -ne '..' }
    if ($segments.Count -eq 0) { continue }

    $rel = ($segments -join '/')

    if (-not $dupes.ContainsKey($rel)) {
      $dupes[$rel] = 0
    } else {
      $dupes[$rel] = [int]$dupes[$rel] + 1
    }

    $idx = [int]$dupes[$rel]
    $finalRel = $rel

    if ($idx -gt 0) {
      $ext = [System.IO.Path]::GetExtension($rel)
      if ([string]::IsNullOrEmpty($ext)) {
        $finalRel = "$rel__dup$($idx + 1)"
      } else {
        $base = $rel.Substring(0, $rel.Length - $ext.Length)
        $finalRel = "$base__dup$($idx + 1)$ext"
      }
    }

    $target = Join-Path $outDir $finalRel.Replace('/', '\\')
    $parent = Split-Path -Parent $target
    if (-not (Test-Path $parent)) {
      New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    Set-Content -Path $target -Value ([string]$f.content) -Encoding UTF8

    $bundle.Add("===== FILE: $finalRel =====") | Out-Null
    $bundle.Add([string]$f.content) | Out-Null
    $bundle.Add("") | Out-Null
  }

  Set-Content -Path (Join-Path $outDir "FULL_CODE_BUNDLE.txt") -Value ($bundle -join "`n") -Encoding UTF8
  $count++
}

Write-Host "Backfilled projects: $count"
Get-ChildItem -Path $generatedRoot -Directory | Select-Object -ExpandProperty Name
