# ============================================================
# Practice Project 2 - Docker / E2E 啟動腳本
# ============================================================

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$E2EDir = Join-Path $ProjectRoot "e2e"

Set-Location $ProjectRoot

# ============================================================
# 顏色輸出
# ============================================================

function Write-Title {
    param([string]$Text)

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host " $Text" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Text)

    Write-Host "  [OK] $Text" -ForegroundColor Green
}

function Write-WarningMsg {
    param([string]$Text)

    Write-Host "  [WARNING] $Text" -ForegroundColor Yellow
}

function Write-ErrorMsg {
    param([string]$Text)

    Write-Host "  [ERROR] $Text" -ForegroundColor Red
}

# ============================================================
# Docker 檢查
# ============================================================

function Test-Docker {
    try {
        docker version | Out-Null
        return ($LASTEXITCODE -eq 0)
    }
    catch {
        return $false
    }
}

function Test-DockerCompose {
    try {
        docker compose version | Out-Null
        return ($LASTEXITCODE -eq 0)
    }
    catch {
        return $false
    }
}

# ============================================================
# PostgreSQL 安全檢查
# ============================================================

function Test-PostgresNotExposed {
    Write-Host ""
    Write-Host "檢查 PostgreSQL 對外 Port..." -ForegroundColor Yellow

    $result = docker compose ps --format "{{.Service}}|{{.Ports}}" 2>$null

    foreach ($line in $result) {
        if ($line -match "^postgres\|") {
            if ($line -match "5432->5432") {
                Write-ErrorMsg "PostgreSQL 5432 已對 Host 開放"
                Write-ErrorMsg "規範禁止 PostgreSQL 對外暴露"
                return $false
            }
        }
    }

    Write-Success "PostgreSQL 5432 未對 Host 開放"

    return $true
}

# ============================================================
# Docker Compose 啟動
# ============================================================

function Start-Server {
    Write-Title "啟動 Docker 伺服器"

    if (-not (Test-Docker)) {
        Write-ErrorMsg "Docker Desktop 尚未啟動"
        return $false
    }

    if (-not (Test-DockerCompose)) {
        Write-ErrorMsg "Docker Compose 無法使用"
        return $false
    }

    Write-Host ""
    Write-Host "啟動 Docker Compose..." -ForegroundColor White

    docker compose up -d

    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "Docker Compose 啟動失敗"
        return $false
    }

    Write-Success "Docker Compose 啟動完成"

    Start-Sleep -Seconds 3

    if (-not (Test-PostgresNotExposed)) {
        return $false
    }

    Show-DockerStatus

    return $true
}

# ============================================================
# Docker 停止
# ============================================================

function Stop-Server {
    Write-Title "停止 Docker 伺服器"

    if (-not (Test-Docker)) {
        Write-ErrorMsg "Docker 無法使用"
        return
    }

    docker compose down

    if ($LASTEXITCODE -eq 0) {
        Write-Success "Docker Compose 已停止"
    }
    else {
        Write-ErrorMsg "停止 Docker Compose 失敗"
    }
}

# ============================================================
# Docker 狀態
# ============================================================

function Show-DockerStatus {
    Write-Title "Docker 容器狀態"

    docker compose ps
}

# ============================================================
# Playwright 檢查
# ============================================================

function Test-Playwright {
    $PlaywrightPath = Join-Path $E2EDir "node_modules\.bin\playwright.cmd"

    return (Test-Path $PlaywrightPath)
}

function Install-E2EDependencies {
    Write-Title "安裝 E2E Dependencies"

    if (-not (Test-Path $E2EDir)) {
        Write-ErrorMsg "找不到 e2e 目錄"
        return $false
    }

    Set-Location $E2EDir

    npm install

    if ($LASTEXITCODE -ne 0) {
        Set-Location $ProjectRoot

        Write-ErrorMsg "npm install 失敗"

        return $false
    }

    Set-Location $ProjectRoot

    Write-Success "E2E Dependencies 安裝完成"

    return $true
}

function Ensure-Playwright {
    if (Test-Playwright) {
        return $true
    }

    Write-WarningMsg "找不到 Playwright"

    $answer = Read-Host "是否自動執行 npm install？(Y/N)"

    if ($answer -match "^[Yy]$") {
        return Install-E2EDependencies
    }

    return $false
}

# ============================================================
# 確認 Docker Server
# ============================================================

function Ensure-Server {
    $backend = docker compose ps --services --filter "status=running" 2>$null

    if ($backend -contains "postgres") {
        return $true
    }

    Write-WarningMsg "Docker Server 尚未啟動"

    $answer = Read-Host "是否自動啟動 Docker Server？(Y/N)"

    if ($answer -match "^[Yy]$") {
        return Start-Server
    }

    return $false
}

# ============================================================
# Playwright
# ============================================================

function Run-Playwright {
    Write-Title "Playwright E2E 測試"

    if (-not (Ensure-Server)) {
        Write-ErrorMsg "Docker Server 尚未啟動"
        Read-Host "按 Enter 返回主選單"
        return
    }

    if (-not (Ensure-Playwright)) {
        Write-ErrorMsg "Playwright 尚未安裝"
        Read-Host "按 Enter 返回主選單"
        return
    }

    if (-not (Test-PostgresNotExposed)) {
        Read-Host "按 Enter 返回主選單"
        return
    }

    Set-Location $E2EDir

    $Playwright = ".\node_modules\.bin\playwright.cmd"

    Write-Host ""
    Write-Host "請選擇測試：" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  [1] production-flow-ui"
    Write-Host "  [2] work-orders"
    Write-Host "  [3] 全部 E2E"
    Write-Host "  [4] production-flow-ui + 顯示報告"
    Write-Host "  [0] 返回"
    Write-Host ""

    $choice = Read-Host "請選擇"

    switch ($choice) {

        "1" {
            Write-Title "執行 production-flow-ui"

            & $Playwright test `
                tests/production-flow-ui.spec.js `
                --project=production-flow-ui
        }

        "2" {
            Write-Title "執行 work-orders"

            & $Playwright test `
                tests/work-orders.spec.js
        }

        "3" {
            Write-Title "執行全部 E2E"

            & $Playwright test
        }

        "4" {
            Write-Title "執行 production-flow-ui"

            & $Playwright test `
                tests/production-flow-ui.spec.js `
                --project=production-flow-ui

            if ($LASTEXITCODE -eq 0) {
                Write-Success "E2E 測試通過"

                Write-Host ""
                Write-Host "開啟 Playwright Report..." -ForegroundColor Cyan

                & $Playwright show-report
            }
            else {
                Write-ErrorMsg "E2E 測試失敗"
            }
        }

        "0" {
            Set-Location $ProjectRoot
            return
        }

        default {
            Write-WarningMsg "無效選項"
        }
    }

    $exitCode = $LASTEXITCODE

    Set-Location $ProjectRoot

    Write-Host ""

    if ($exitCode -eq 0) {
        Write-Success "Playwright 測試完成"
    }
    else {
        Write-ErrorMsg "Playwright 測試失敗，Exit Code: $exitCode"
    }

    Write-Host ""
    Read-Host "按 Enter 返回主選單"
}

# ============================================================
# Docker + Playwright
# ============================================================

function Start-ServerAndRunE2E {
    Write-Title "啟動 Docker + 執行 E2E"

    if (-not (Start-Server)) {
        Write-ErrorMsg "Docker Server 啟動失敗"
        Read-Host "按 Enter 返回主選單"
        return
    }

    Run-Playwright
}

# ============================================================
# Git Status
# ============================================================

function Show-GitStatus {
    Write-Title "Git Status"

    git status

    Write-Host ""
    Read-Host "按 Enter 返回主選單"
}

# ============================================================
# 主選單
# ============================================================

function Show-MainMenu {

    while ($true) {

        Clear-Host

        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "              Practice Project 2" -ForegroundColor Cyan
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host ""

        Write-Host " 專案：" -NoNewline
        Write-Host " $ProjectRoot" -ForegroundColor Gray

        Write-Host ""
        Write-Host " [1] 啟動 Docker 伺服器"
        Write-Host " [2] 執行 Playwright E2E"
        Write-Host " [3] 啟動 Docker + 執行 Playwright E2E"
        Write-Host " [4] 查看 Docker 狀態"
        Write-Host " [5] 停止 Docker 伺服器"
        Write-Host " [6] 查看 Git Status"
        Write-Host " [0] 離開"
        Write-Host ""

        $choice = Read-Host "請選擇"

        switch ($choice) {

            "1" {
                Start-Server

                Write-Host ""
                Read-Host "按 Enter 返回主選單"
            }

            "2" {
                Run-Playwright
            }

            "3" {
                Start-ServerAndRunE2E
            }

            "4" {
                Show-DockerStatus

                Write-Host ""
                Read-Host "按 Enter 返回主選單"
            }

            "5" {
                Stop-Server

                Write-Host ""
                Read-Host "按 Enter 返回主選單"
            }

            "6" {
                Show-GitStatus
            }

            "0" {
                Clear-Host
                Write-Host ""
                Write-Host "結束。" -ForegroundColor Cyan
                Write-Host ""
                return
            }

            default {
                Write-WarningMsg "無效選項"
                Start-Sleep -Seconds 1
            }
        }
    }
}

# ============================================================
# 啟動
# ============================================================

Show-MainMenu