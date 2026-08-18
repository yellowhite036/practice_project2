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
# 取得 Web API URL
# ============================================================

function Get-ApiBaseUrl {
    $services = docker compose config --services 2>$null

    if ($services -contains "nginx") {
        $port = docker compose port nginx 80 2>$null

        if ($port -match ":(\d+)$") {
            return "http://127.0.0.1:$($Matches[1])"
        }
    }

    if ($services -contains "frontend") {
        $port = docker compose port frontend 80 2>$null

        if ($port -match ":(\d+)$") {
            return "http://127.0.0.1:$($Matches[1])"
        }
    }

    if ($services -contains "web") {
        $port = docker compose port web 80 2>$null

        if ($port -match ":(\d+)$") {
            return "http://127.0.0.1:$($Matches[1])"
        }
    }

    return "http://127.0.0.1"
}

# ============================================================
# 三產線並發 Worker
#
# 模擬：
#
#   Line-1 ─┐
#   Line-2 ─┼─> Product A
#   Line-3 ─┘
#
# 三條產線：
#   - 同一時間送出 POST /api/work-orders
#   - 相同 product_id
#   - 相同 mold_id
#   - 相同 material
#
# 預期：
#   1 條成功
#   2 條被拒絕
#
# Worker 使用獨立 Node.js Process。
# 每個 Worker 都是獨立程序。
# ============================================================

function Run-FactoryRaceTest {
    Write-Title "3 條產線並發搶同一模具 / 材料"

    if (-not (Ensure-Server)) {
        Write-ErrorMsg "Docker Server 尚未啟動"
        Read-Host "按 Enter 返回主選單"
        return
    }

    if (-not (Test-PostgresNotExposed)) {
        Read-Host "按 Enter 返回主選單"
        return
    }

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-ErrorMsg "找不到 Node.js"
        Read-Host "按 Enter 返回主選單"
        return
    }

    $ApiBaseUrl = Get-ApiBaseUrl

    Write-Host ""
    Write-Host "API：" -NoNewline
    Write-Host " $ApiBaseUrl" -ForegroundColor Yellow

    Write-Host ""
    Write-Host "模擬工廠：" -ForegroundColor White
    Write-Host "  產線 A -> Product A -> Mold Y -> Material X"
    Write-Host "  產線 B -> Product A -> Mold Y -> Material X"
    Write-Host "  產線 C -> Product A -> Mold Y -> Material X"
    Write-Host ""
    Write-Host "三個 Worker 將同時送出生產工單。" -ForegroundColor Cyan
    Write-Host ""

    # --------------------------------------------------------
    # 初始化 E2E 資料
    # --------------------------------------------------------

    Write-Host "初始化 E2E 資料..." -ForegroundColor Cyan
    node -e "require('./e2e/utils/db.js').clearE2EData(); require('./e2e/utils/db.js').seedE2EData();"
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "初始化 E2E 資料失敗"
        Read-Host "按 Enter 返回主選單"
        return
    }

    # --------------------------------------------------------
    # 建立暫時 Worker Script
    #
    # run.ps1 執行完後會自動刪除。
    # 不會新增專案檔案。
    # --------------------------------------------------------

    $WorkerScript = Join-Path $env:TEMP "practice-project2-factory-worker-$([guid]::NewGuid().ToString()).js"

    $WorkerCode = @'
const workerId = process.argv[2];
const apiBaseUrl = process.argv[3];
const resultFile = process.argv[4];

const ADMIN_ID = "E2E-ADMIN";

const fs = require("fs");

function writeResult(code) {
  fs.writeFileSync(resultFile, String(code), "utf8");
  process.exitCode = code;
}

const payload = {
  work_order_id: `E2E-FACTORY-${workerId}-${Date.now()}`,
  product_id: "E2E-PRD-CREATE",
  quantity: 5,
  line: workerId,
  mold_id: "E2E-MOLD-CREATE",
  creator_user_id: ADMIN_ID,
  creator_name: ADMIN_ID
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("");
  console.log("============================================================");
  console.log(` Worker ${workerId}`);
  console.log("============================================================");
  console.log(`產線       : ${workerId}`);
  console.log(`Product    : ${payload.product_id}`);
  console.log(`Mold       : ${payload.mold_id}`);
  console.log(`Quantity   : ${payload.quantity}`);
  console.log(`開始時間   : ${new Date().toISOString()}`);

  try {
    const loginResponse = await fetch(
      `${apiBaseUrl}/api/auth/login`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          user_id: ADMIN_ID
        })
      }
    );

    const loginText = await loginResponse.text();

    let loginBody = null;

    try {
      loginBody = JSON.parse(loginText);
    } catch {
      loginBody = null;
    }

    if (!loginResponse.ok) {
      console.log(`[REJECTED] Login HTTP ${loginResponse.status}: ${loginText}`);
      writeResult(1);
      return;
    }

    const token = loginBody?.token;

    if (!token) {
      console.log("[ERROR] Login response 沒有 token");
      writeResult(1);
      return;
    }

    console.log("[OK] Login 成功");

    await sleep(100);

    const startTime = process.hrtime.bigint();

    const response = await fetch(
      `${apiBaseUrl}/api/work-orders`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      }
    );

    const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1000000;

    const responseText = await response.text();

    let body = null;

    try {
      body = JSON.parse(responseText);
    } catch {
      body = null;
    }

    console.log("");
    console.log(`HTTP Status : ${response.status}`);
    console.log(`耗時        : ${elapsedMs.toFixed(2)} ms`);

    if (response.status === 201) {
      console.log("");
      console.log("[SUCCESS] 搶到模具");
      console.log(`Work Order  : ${body?.work_order_id || payload.work_order_id}`);
      console.log(`Status      : ${body?.status || "Unknown"}`);
      console.log(`Mold        : ${payload.mold_id}`);
      writeResult(0);
      return;
    }

    if (response.status === 409) {
      console.log("");
      console.log("[REJECTED] 生產請求被系統拒絕");

      if (body?.error) {
        console.log(`原因        : ${body.error}`);
      } else {
        console.log(`Response    : ${responseText}`);
      }

      writeResult(0);
      return;
    }

    console.log("");
    console.log("[ERROR] 非預期 HTTP Response");
    console.log(`Response    : ${responseText}`);

    writeResult(1);
    return;
  } catch (error) {
    console.log("");
    console.log("[ERROR] Worker 執行失敗");
    console.log(error.message);

    writeResult(1);
    return;
  }
}

main();
'@

    $resultFiles = @{}

    try {
        Set-Content `
            -Path $WorkerScript `
            -Value $WorkerCode `
            -Encoding UTF8

        Write-Success "Worker Script 建立完成"

        # ----------------------------------------------------
        # 啟動三個獨立 Node.js Process
        # ----------------------------------------------------

        Write-Host ""
        Write-Host "同時啟動 3 個 Worker..." -ForegroundColor Cyan
        Write-Host ""

        $workers = @(
            "LINE-A",
            "LINE-B",
            "LINE-C"
        )

        $processes = @()

        foreach ($worker in $workers) {

            $resultFile = Join-Path $env:TEMP "practice-project2-result-$worker-$([guid]::NewGuid().ToString()).txt"
            $resultFiles[$worker] = $resultFile

            $process = Start-Process `
                -FilePath "node" `
                -ArgumentList @(
                    $WorkerScript,
                    $worker,
                    $ApiBaseUrl,
                    $resultFile
                ) `
                -NoNewWindow `
                -PassThru

            $processes += $process

            Write-Host "  Worker 啟動：" -NoNewline
            Write-Host $worker -ForegroundColor Yellow
        }

        Write-Host ""
        Write-Host "等待三個 Worker 完成..." -ForegroundColor Cyan

        # ----------------------------------------------------
        # 等待全部 Worker
        # ----------------------------------------------------

        foreach ($process in $processes) {
            $process.WaitForExit()
            $process.Refresh()
        }

        Write-Host ""
        Write-Title "並發搶工單結果"

        $errorCount = 0

        foreach ($worker in $workers) {

            $resultFile = $resultFiles[$worker]

            if (-not (Test-Path $resultFile)) {
                Write-Host "Worker $worker 沒有寫入結果檔案（可能異常終止）" -ForegroundColor Red
                $errorCount++
                continue
            }

            $exitCodeText = (Get-Content $resultFile -Raw).Trim()

            if ($exitCodeText -eq "0") {
                Remove-Item $resultFile -Force -ErrorAction SilentlyContinue
                continue
            }

            Write-Host "Worker $worker exit code: $exitCodeText" -ForegroundColor Red
            $errorCount++

            Remove-Item $resultFile -Force -ErrorAction SilentlyContinue
        }

        # ----------------------------------------------------
        # 使用 Docker PostgreSQL 直接驗證最終資料
        # ----------------------------------------------------

        Write-Host "驗證資料庫最終狀態..." -ForegroundColor Cyan
        Write-Host ""

        $postgresContainer = "practice_project2-postgres-1"

        $dbCheckSql = @"
SELECT
    COUNT(*) AS work_order_count,
    COUNT(*) FILTER (WHERE status = 'Pending') AS pending_count
FROM work_orders
WHERE creator_user_id = 'E2E-ADMIN';
"@

        $dbOutput = docker exec `
            -i `
            $postgresContainer `
            psql `
            -U postgres `
            -d practice_project2 `
            -t `
            -A `
            -c $dbCheckSql 2>&1

        if ($LASTEXITCODE -ne 0) {
            Write-ErrorMsg "無法驗證 PostgreSQL"
            Write-Host $dbOutput

            Remove-Item $WorkerScript -Force -ErrorAction SilentlyContinue

            Read-Host "按 Enter 返回主選單"
            return
        }

        $dbLine = ($dbOutput | Select-Object -Last 1).ToString().Trim()

        $parts = $dbLine -split "\|"

        $workOrderCount = 0
        $pendingCount = 0

        if ($parts.Count -ge 2) {
            [int]::TryParse($parts[0], [ref]$workOrderCount) | Out-Null
            [int]::TryParse($parts[1], [ref]$pendingCount) | Out-Null
        }

        Write-Host "  工單數量：" -NoNewline
        Write-Host $workOrderCount -ForegroundColor Yellow

        Write-Host "  Pending ：" -NoNewline
        Write-Host $pendingCount -ForegroundColor Yellow

        # ----------------------------------------------------
        # 驗證模具
        # ----------------------------------------------------

        $moldSql = @"
SELECT status
FROM molds
WHERE mold_id = 'E2E-MOLD-CREATE';
"@

        $moldStatus = docker exec `
            -i `
            $postgresContainer `
            psql `
            -U postgres `
            -d practice_project2 `
            -t `
            -A `
            -c $moldSql 2>&1

        if ($LASTEXITCODE -ne 0) {
            Write-ErrorMsg "無法讀取模具狀態"
            Write-Host $moldStatus
        }
        else {
            $moldStatus = ($moldStatus | Select-Object -Last 1).ToString().Trim()

            Write-Host "  模具狀態：" -NoNewline
            Write-Host $moldStatus -ForegroundColor Yellow
        }

        # ----------------------------------------------------
        # 驗證材料庫存
        # ----------------------------------------------------

        $materialSql = @"
SELECT stock
FROM materials
WHERE material_id = 'E2E-MAT-CREATE';
"@

        $materialStock = docker exec `
            -i `
            $postgresContainer `
            psql `
            -U postgres `
            -d practice_project2 `
            -t `
            -A `
            -c $materialSql 2>&1

        if ($LASTEXITCODE -ne 0) {
            Write-ErrorMsg "無法讀取材料庫存"
            Write-Host $materialStock
        }
        else {
            $materialStock = ($materialStock | Select-Object -Last 1).ToString().Trim()

            Write-Host "  材料庫存：" -NoNewline
            Write-Host $materialStock -ForegroundColor Yellow
        }

        # ----------------------------------------------------
        # 最終判定
        # ----------------------------------------------------

        Write-Host ""

        if (
            $workOrderCount -eq 1 -and
            $pendingCount -eq 1 -and
            $moldStatus -eq "In_Use" -and
            [decimal]$materialStock -eq 90
        ) {
            Write-Host "============================================================" -ForegroundColor Green
            Write-Host "  並發競爭驗證成功" -ForegroundColor Green
            Write-Host "============================================================" -ForegroundColor Green
            Write-Host ""
            Write-Host "  [OK] 3 條產線同時競爭"
            Write-Host "  [OK] 只有 1 張工單成功"
            Write-Host "  [OK] 模具只有 1 條產線使用"
            Write-Host "  [OK] 材料只扣除 1 次"
            Write-Host "  [OK] 材料沒有變成負數"
            Write-Host "  [OK] 資料庫狀態一致"
            Write-Host ""
        }
        else {
            Write-Host "============================================================" -ForegroundColor Red
            Write-Host "  並發競爭驗證失敗" -ForegroundColor Red
            Write-Host "============================================================" -ForegroundColor Red
            Write-Host ""

            Write-Host "  預期：" -ForegroundColor Yellow
            Write-Host "    Work Orders = 1"
            Write-Host "    Pending     = 1"
            Write-Host "    Mold        = In_Use"
            Write-Host "    Material    = 90"

            Write-Host ""
            Write-Host "  實際：" -ForegroundColor Yellow
            Write-Host "    Work Orders = $workOrderCount"
            Write-Host "    Pending     = $pendingCount"
            Write-Host "    Mold        = $moldStatus"
            Write-Host "    Material    = $materialStock"

            $errorCount++
        }

        # ----------------------------------------------------
        # 顯示相關工單
        # ----------------------------------------------------

        Write-Host ""
        Write-Host "本次競爭產生的工單：" -ForegroundColor Cyan

        $ordersSql = @"
SELECT
    work_order_id,
    line,
    product_id,
    mold_id,
    quantity,
    status
FROM work_orders
WHERE creator_user_id = 'E2E-ADMIN'
ORDER BY work_order_id;
"@

        $ordersOutput = docker exec `
            -i `
            $postgresContainer `
            psql `
            -U postgres `
            -d practice_project2 `
            -c $ordersSql 2>&1

        Write-Host $ordersOutput

        Write-Host ""

        if ($errorCount -eq 0) {
            Write-Success "3 Worker 並發競爭測試完成"
        }
        else {
            Write-ErrorMsg "並發競爭測試發現異常"
        }
    }
    finally {
        # ----------------------------------------------------
        # 清除 E2E 資料
        # ----------------------------------------------------

        Write-Host "清除 E2E 資料..." -ForegroundColor Cyan
        node -e "require('./e2e/utils/db.js').clearE2EData();"

        # ----------------------------------------------------
        # 清除暫時 Worker Script
        # ----------------------------------------------------

        if (Test-Path $WorkerScript) {
            Remove-Item $WorkerScript -Force -ErrorAction SilentlyContinue
        }

        # ----------------------------------------------------
        # 清除殘留的 Result 檔案
        # ----------------------------------------------------

        if ($resultFiles) {
            foreach ($worker in $resultFiles.Keys) {
                $rf = $resultFiles[$worker]
                if (Test-Path $rf) {
                    Remove-Item $rf -Force -ErrorAction SilentlyContinue
                }
            }
        }

        Set-Location $ProjectRoot
    }

    Write-Host ""
    Read-Host "按 Enter 返回主選單"
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
    Write-Host "  [5] 3 條產線並發搶同一模具 / 材料"
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

        "5" {
            Set-Location $ProjectRoot

            Run-FactoryRaceTest

            return
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