$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Set-Location 'C:\Users\AJ\Documents\GitHub\dev1'

$repoRoot = (Get-Location).Path
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$pgData = Join-Path (Get-Location) '.scratch\pg-auth-data2'
$pgPort = 55432
$apiPort = 3003
$webPort = 3100
$apiUrl = "http://127.0.0.1:$apiPort"
$webUrl = "http://127.0.0.1:$webPort"
$apiLog = '.scratch/runtime/api.runtime.log'
$webLog = '.scratch/runtime/web.runtime.log'
$pgLog = '.scratch/runtime/postgres.runtime.log'
$apiLogAbs = Join-Path $repoRoot $apiLog
$webLogAbs = Join-Path $repoRoot $webLog
$pgLogAbs = Join-Path $repoRoot $pgLog

$null = New-Item -ItemType Directory -Force -Path '.scratch/runtime'

function Wait-ForHttp {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [int]$TimeoutSeconds = 60
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        return
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  throw "Timed out waiting for HTTP endpoint: $Uri"
}

function Wait-ForPg {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 40
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    & (Join-Path $pgBin 'pg_isready.exe') -h 127.0.0.1 -p $Port -U postgres | Out-Null
    if ($LASTEXITCODE -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Timed out waiting for PostgreSQL on port $Port"
}

function Resolve-PgAdminUser {
  param([int]$Port)
  $candidates = @('postgres', $env:USERNAME, 'devteam') | Where-Object { $_ -and $_.Trim() -ne '' } | Select-Object -Unique
  foreach ($candidate in $candidates) {
    try {
      & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $Port -U $candidate -d postgres -tAc "SELECT 1;" 1>$null 2>$null
      if ($LASTEXITCODE -eq 0) {
        return $candidate
      }
    } catch {
      continue
    }
  }
  throw "Unable to connect to postgres as any admin candidate: $($candidates -join ', ')"
}

function Test-HttpUp {
  param([Parameter(Mandatory = $true)][string]$Uri)
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2
    return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Invoke-Json {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [string]$Method = 'GET',
    [object]$Body = $null,
    [Microsoft.PowerShell.Commands.WebRequestSession]$Session = $null,
    [hashtable]$Headers = @{},
    [int]$ExpectedStatus = 200
  )
  $params = @{
    Uri = $Uri
    Method = $Method
    UseBasicParsing = $true
    TimeoutSec = 20
    ErrorAction = 'Stop'
  }
  if ($Session) { $params.WebSession = $Session }
  if ($Headers.Count -gt 0) { $params.Headers = $Headers }
  if ($Body -ne $null) {
    $params.ContentType = 'application/json'
    $params.Body = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 8 }
  }
  try {
    $response = Invoke-WebRequest @params
    if ($response.StatusCode -ne $ExpectedStatus) {
      throw "Expected HTTP $ExpectedStatus but received $($response.StatusCode) from $Uri"
    }
    $raw = $response.Content
    $json = if ($raw) { $raw | ConvertFrom-Json } else { $null }
    return [PSCustomObject]@{
      StatusCode = $response.StatusCode
      Headers = $response.Headers
      Json = $json
      Response = $response
    }
  } catch {
    $ex = $_.Exception
    if ($ex.Response) {
      $status = [int]$ex.Response.StatusCode
      $reader = New-Object System.IO.StreamReader($ex.Response.GetResponseStream())
      $content = $reader.ReadToEnd()
      $reader.Close()
      if ($status -ne $ExpectedStatus) {
        throw "Expected HTTP $ExpectedStatus but received $status from $Uri. Body: $content"
      }
      $json = if ($content) { $content | ConvertFrom-Json } else { $null }
      return [PSCustomObject]@{
        StatusCode = $status
        Headers = $ex.Response.Headers
        Json = $json
        Response = $ex.Response
      }
    }
    throw
  }
}

function Get-CookieValue {
  param(
    [Parameter(Mandatory = $true)][Microsoft.PowerShell.Commands.WebRequestSession]$Session,
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$Name
  )
  $cookieCollection = $Session.Cookies.GetCookies([Uri]$Uri)
  foreach ($cookie in $cookieCollection) {
    if ($cookie.Name -eq $Name) {
      return $cookie.Value
    }
  }
  return $null
}

$jobs = @()
$result = [ordered]@{
  email = $null
  checks = @()
  runtime = [ordered]@{
    postgres_started_by_script = $false
    api_started_by_script = $false
    web_started_by_script = $false
    api_url = $apiUrl
    web_url = $webUrl
    db_port = $pgPort
  }
  db = [ordered]@{}
}

try {
  if (-not (Test-Path $pgData)) {
    & (Join-Path $pgBin 'initdb.exe') -D $pgData -U $env:USERNAME -A trust --encoding=UTF8 --locale=C *> '.scratch/runtime/initdb.runtime.log'
    if ($LASTEXITCODE -ne 0) {
      throw "initdb failed and no existing cluster was available at $pgData"
    }
  }

  $jobs += Start-Job -ScriptBlock {
    param($root, $bin, $data, $port, $logPath)
    Set-Location $root
    & (Join-Path $bin 'postgres.exe') -D $data -p $port -h 127.0.0.1 *>> $logPath
  } -ArgumentList $repoRoot, $pgBin, $pgData, $pgPort, $pgLogAbs
  $result.runtime.postgres_started_by_script = $true
  Wait-ForPg -Port $pgPort -TimeoutSeconds 50

  $pgAdminUser = Resolve-PgAdminUser -Port $pgPort

  $roleExists = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $pgPort -U $pgAdminUser -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='devteam';"
  if (($roleExists | Out-String).Trim() -ne '1') {
    & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $pgPort -U $pgAdminUser -d postgres -c "CREATE ROLE devteam LOGIN;"
  }
  $dbExists = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $pgPort -U $pgAdminUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='devteam';"
  if (($dbExists | Out-String).Trim() -ne '1') {
    & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $pgPort -U $pgAdminUser -d postgres -c "CREATE DATABASE devteam OWNER devteam;"
  }
  & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $pgPort -U $pgAdminUser -d postgres -c "ALTER ROLE devteam WITH LOGIN;"

  if (-not (Test-HttpUp -Uri "$apiUrl/health")) {
    $jobs += Start-Job -ScriptBlock {
      Set-Location 'C:\Users\AJ\Documents\GitHub\dev1'
      $env:DATABASE_URL = "postgresql://devteam@127.0.0.1:$using:pgPort/devteam"
      $env:API_PORT = [string]$using:apiPort
      $env:AUTH_TOKEN_SECRET = 'devteam-local-auth-secret-change-this-32-bytes'
      $env:DEV_AUTH_BYPASS = 'false'
      $env:NODE_ENV = 'development'
      npm run start --workspace=@devteam/api *>> $using:apiLogAbs
    }
    $result.runtime.api_started_by_script = $true
    Wait-ForHttp -Uri "$apiUrl/health" -TimeoutSeconds 80
  }

  if (-not (Test-HttpUp -Uri "$webUrl/login")) {
    $jobs += Start-Job -ScriptBlock {
      Set-Location 'C:\Users\AJ\Documents\GitHub\dev1'
      $env:NEXT_PUBLIC_API_BASE = "http://127.0.0.1:$using:apiPort"
      $env:NEXT_PUBLIC_WS_BASE = "ws://127.0.0.1:$using:apiPort"
      $env:NEXT_PUBLIC_DEV_AUTH_BYPASS = 'false'
      npm run build --workspace=@devteam/web *>> $using:webLogAbs
      npm run start --workspace=@devteam/web -- --port $using:webPort *>> $using:webLogAbs
    }
    $result.runtime.web_started_by_script = $true
    Wait-ForHttp -Uri "$webUrl/login" -TimeoutSeconds 180
  }

  $email = "runtime.auth.$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@local.test"
  $password = 'StrongPass!1234'
  $newPassword = 'EvenBetter!5678'
  $wrongPassword = 'WrongPass!1234'
  $result.email = $email

  # Anonymous web access must redirect to login for protected route.
  $anonStatus = $null
  $anonLocation = $null
  try {
    $anonResp = Invoke-WebRequest -UseBasicParsing -Uri "$webUrl/overview" -MaximumRedirection 0 -ErrorAction Stop
    $anonStatus = [int]$anonResp.StatusCode
    $anonLocation = [string]$anonResp.Headers.Location
  } catch {
    if ($_.Exception.Response) {
      $anonStatus = [int]$_.Exception.Response.StatusCode
      $anonLocation = [string]$_.Exception.Response.Headers['Location']
    } else {
      throw
    }
  }
  if ($anonStatus -ne 307 -or -not $anonLocation.StartsWith('/login')) {
    throw "Protected route was not blocked for anonymous request. status=$anonStatus location=$anonLocation"
  }
  $result.checks += 'anonymous_protected_route_redirect'

  $signupSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $signup = Invoke-Json -Uri "$apiUrl/api/auth/signup" -Method POST -Session $signupSession -ExpectedStatus 201 -Body @{
    fullName = 'Runtime Auth Tester'
    email = $email
    password = $password
  }
  if (-not $signup.Json.authenticated) { throw 'Signup did not authenticate user' }
  if (-not $signup.Json.emailVerification.token) { throw 'Signup did not return verification token in dev mode' }
  $verifyToken = [string]$signup.Json.emailVerification.token
  $result.checks += 'signup_success'

  $accessCookie = Get-CookieValue -Session $signupSession -Uri "$apiUrl/" -Name 'devteam_access_token'
  $refreshCookie = Get-CookieValue -Session $signupSession -Uri "$apiUrl/api/auth/refresh" -Name 'devteam_refresh_token'
  $csrfCookie = Get-CookieValue -Session $signupSession -Uri "$apiUrl/" -Name 'devteam_csrf_token'
  if (-not $accessCookie -or -not $refreshCookie -or -not $csrfCookie) {
    throw 'Expected auth cookies were not set after signup'
  }
  $result.checks += 'auth_cookie_creation'

  Invoke-Json -Uri "$apiUrl/api/auth/signup" -Method POST -ExpectedStatus 409 -Body @{
    fullName = 'Runtime Auth Tester'
    email = $email
    password = $password
  } | Out-Null
  $result.checks += 'duplicate_email_rejected'

  Invoke-Json -Uri "$apiUrl/api/auth/signin" -Method POST -ExpectedStatus 401 -Body @{
    email = $email
    password = $wrongPassword
  } | Out-Null
  $result.checks += 'invalid_password_rejected'

  $signinSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $signin = Invoke-Json -Uri "$apiUrl/api/auth/signin" -Method POST -Session $signinSession -ExpectedStatus 200 -Body @{
    email = $email
    password = $password
  }
  if (-not $signin.Json.authenticated) { throw 'Signin did not authenticate user' }
  $result.checks += 'signin_success'

  $session = Invoke-Json -Uri "$apiUrl/api/auth/session" -Method GET -Session $signinSession -ExpectedStatus 200
  if ([string]$session.Json.user.email -ne $email) { throw 'Session endpoint returned unexpected user' }
  $result.checks += 'session_endpoint_success'

  $webProtected = Invoke-WebRequest -UseBasicParsing -Uri "$webUrl/overview" -MaximumRedirection 0 -WebSession $signinSession -ErrorAction Stop
  if ([int]$webProtected.StatusCode -ne 200) {
    throw "Authenticated protected route did not return 200. status=$($webProtected.StatusCode)"
  }
  $webProtectedReload = Invoke-WebRequest -UseBasicParsing -Uri "$webUrl/overview" -MaximumRedirection 0 -WebSession $signinSession -ErrorAction Stop
  if ([int]$webProtectedReload.StatusCode -ne 200) {
    throw "Reloaded protected route did not return 200. status=$($webProtectedReload.StatusCode)"
  }
  $result.checks += 'protected_route_allows_authenticated'
  $result.checks += 'session_persists_after_reload'

  $oldRefresh = Get-CookieValue -Session $signinSession -Uri "$apiUrl/api/auth/refresh" -Name 'devteam_refresh_token'
  $csrfForRefresh = Get-CookieValue -Session $signinSession -Uri "$apiUrl/" -Name 'devteam_csrf_token'
  Invoke-Json -Uri "$apiUrl/api/auth/refresh" -Method POST -Session $signinSession -ExpectedStatus 200 -Headers @{ 'x-csrf-token' = $csrfForRefresh } -Body @{} | Out-Null
  $newRefresh = Get-CookieValue -Session $signinSession -Uri "$apiUrl/api/auth/refresh" -Name 'devteam_refresh_token'
  if (-not $newRefresh -or $newRefresh -eq $oldRefresh) {
    throw 'Refresh token was not rotated'
  }
  $result.checks += 'refresh_token_rotation'

  Invoke-Json -Uri "$apiUrl/api/auth/verify-email/confirm" -Method POST -ExpectedStatus 200 -Body @{ token = $verifyToken } | Out-Null
  $result.checks += 'email_verification_confirm'

  $forgot = Invoke-Json -Uri "$apiUrl/api/auth/forgot-password" -Method POST -ExpectedStatus 200 -Body @{ email = $email }
  if (-not $forgot.Json.token) { throw 'Forgot password did not return token in dev mode' }
  $resetToken = [string]$forgot.Json.token
  $result.checks += 'forgot_password_success'

  Invoke-Json -Uri "$apiUrl/api/auth/reset-password" -Method POST -ExpectedStatus 200 -Body @{ token = $resetToken; password = $newPassword } | Out-Null
  $result.checks += 'reset_password_success'

  Invoke-Json -Uri "$apiUrl/api/auth/signin" -Method POST -ExpectedStatus 401 -Body @{ email = $email; password = $password } | Out-Null
  $result.checks += 'old_password_rejected_after_reset'

  $postResetSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Invoke-Json -Uri "$apiUrl/api/auth/signin" -Method POST -Session $postResetSession -ExpectedStatus 200 -Body @{ email = $email; password = $newPassword } | Out-Null
  $result.checks += 'signin_with_new_password_success'

  $csrfForSignout = Get-CookieValue -Session $postResetSession -Uri "$apiUrl/" -Name 'devteam_csrf_token'
  Invoke-Json -Uri "$apiUrl/api/auth/signout" -Method POST -Session $postResetSession -ExpectedStatus 200 -Headers @{ 'x-csrf-token' = $csrfForSignout } -Body @{} | Out-Null
  $result.checks += 'signout_success'

  Invoke-Json -Uri "$apiUrl/api/auth/session" -Method GET -Session $postResetSession -ExpectedStatus 401 | Out-Null
  $result.checks += 'signed_out_session_invalid'

  $postSignoutStatus = $null
  $postSignoutLocation = $null
  try {
    $postSignoutResp = Invoke-WebRequest -UseBasicParsing -Uri "$webUrl/overview" -MaximumRedirection 0 -WebSession $postResetSession -ErrorAction Stop
    $postSignoutStatus = [int]$postSignoutResp.StatusCode
    $postSignoutLocation = [string]$postSignoutResp.Headers.Location
  } catch {
    if ($_.Exception.Response) {
      $postSignoutStatus = [int]$_.Exception.Response.StatusCode
      $postSignoutLocation = [string]$_.Exception.Response.Headers['Location']
    } else {
      throw
    }
  }
  if ($postSignoutStatus -ne 307 -or -not $postSignoutLocation.StartsWith('/login')) {
    throw "Protected route did not redirect after signout. status=$postSignoutStatus location=$postSignoutLocation"
  }
  $result.checks += 'protected_route_redirect_after_signout'

  $quotedEmail = $email.Replace("'", "''")
  $userCount = (& (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $pgPort -U $pgAdminUser -d devteam -tAc "SELECT count(*) FROM auth_users WHERE email = '$quotedEmail';" | Out-String).Trim()
  $verified = (& (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $pgPort -U $pgAdminUser -d devteam -tAc "SELECT email_verified::int FROM auth_users WHERE email = '$quotedEmail' LIMIT 1;" | Out-String).Trim()
  $refreshCount = (& (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $pgPort -U $pgAdminUser -d devteam -tAc "SELECT count(*) FROM auth_refresh_tokens t JOIN auth_users u ON u.id = t.user_id WHERE u.email = '$quotedEmail';" | Out-String).Trim()
  if ($userCount -ne '1') { throw "Expected exactly one persisted user, got $userCount" }
  if ($verified -ne '1') { throw 'Expected email_verified=true after verification flow' }
  if ([int]$refreshCount -lt 1) { throw 'Expected at least one refresh token row for user' }
  $result.db.user_count = [int]$userCount
  $result.db.email_verified = ($verified -eq '1')
  $result.db.refresh_token_rows = [int]$refreshCount
  $result.checks += 'database_persistence_verified'

  $result | ConvertTo-Json -Depth 8 | Set-Content -Path '.scratch/runtime/auth-runtime-result.json'
  Write-Output 'AUTH_RUNTIME_RESULT=.scratch/runtime/auth-runtime-result.json'
  Write-Output 'AUTH_RUNTIME_STATUS=PASS'
}
finally {
  for ($i = $jobs.Count - 1; $i -ge 0; $i--) {
    $job = $jobs[$i]
    try {
      Stop-Job $job -ErrorAction SilentlyContinue | Out-Null
    } catch {}
  }
  for ($i = $jobs.Count - 1; $i -ge 0; $i--) {
    $job = $jobs[$i]
    try {
      Receive-Job $job -Keep | Out-Null
    } catch {}
    try {
      Remove-Job $job -Force -ErrorAction SilentlyContinue
    } catch {}
  }
}
