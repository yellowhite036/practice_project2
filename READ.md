# 使用說明

## 1. 環境需求

請先確認已安裝：

* Docker Desktop
* Docker Compose
* Node.js
* npm

專案主要服務：

* React 前端
* Node.js / Express 後端 API
* PostgreSQL 資料庫
* Nginx
* Playwright E2E 測試環境

---

## 2. 環境變數設定

在專案根目錄建立 `.env`：

```env
POSTGRES_DB=practice_project2
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_NAME=practice_project2
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres

JWT_SECRET=your-jwt-secret
```

`.env` 已加入 `.gitignore`，不可提交至 Git。

---

## 3. 啟動系統

在專案根目錄執行：

```bash
docker compose up -d --build
```

確認容器：

```bash
docker compose ps
```

查看服務 Log：

```bash
docker compose logs -f
```

停止系統：

```bash
docker compose down
```

重新啟動：

```bash
docker compose restart
```

---

## 4. 系統操作

啟動完成後，透過瀏覽器進入前端系統。

登入後依照使用者角色提供不同功能。

### Admin

管理員可以：

* 查看庫存
* 新增、修改材料
* 手動調整庫存
* 查看全廠流水帳
* 發起生產工單

### User

一般使用者可以：

* 查看庫存
* 發起生產工單

一般使用者無法執行庫存管理功能。

---

## 5. 生產工單操作

登入系統後：

1. 進入生產工單功能。
2. 選擇要生產的產品。
3. 輸入生產數量。
4. 發起生產工單。
5. 系統依照 BOM 自動計算材料需求。
6. PostgreSQL Transaction 執行材料扣料與模具狀態更新。
7. 工單建立成功後，模具狀態變為 `In_Use`。
8. 工單完成後，產品庫存增加。
9. 模具恢復為 `Idle`。

當材料不足或模具正在使用時，工單會被拒絕，交易會 Rollback。

---

## 6. PostgreSQL 資料庫

查看 PostgreSQL：

```bash
docker compose exec postgres psql -U postgres -d practice_project2
```

查看資料表：

```sql
\dt
```

查看產品：

```sql
SELECT * FROM products;
```

查看材料：

```sql
SELECT * FROM materials;
```

查看模具：

```sql
SELECT * FROM molds;
```

查看 BOM：

```sql
SELECT * FROM bom_table;
```

查看工單：

```sql
SELECT * FROM work_orders;
```

查看庫存異動：

```sql
SELECT * FROM inventory_transactions;
```

查看系統 Log：

```sql
SELECT * FROM system_logs ORDER BY created_at DESC;
```

離開 PostgreSQL：

```sql
\q
```

---

## 7. PostgreSQL Integration Test

進入後端：

```bash
cd server
```

執行 Integration Test：

```bash
npm run test:integration
```

測試內容包含：

* Work Order 正常建立
* BOM 數量計算
* Product Stock Lifecycle
* Mold Lifecycle
* Work Order Reject Rollback
* Mold `In_Use` Transaction Rollback
* Work Order Quantity Validation
* PostgreSQL Constraints
* Optimistic Lock
* Invalid Work Order State Transition

---

## 8. Stage 4 Playwright E2E Test

進入 E2E：

```bash
cd e2e
```

安裝依賴：

```bash
npm ci
```

安裝 Chromium：

```bash
npx playwright install chromium
```

Windows PowerShell 若因 Execution Policy 無法執行 `npx.ps1`，可以使用：

```bash
npm.cmd exec playwright install chromium
```

執行 E2E：

```bash
npm test
```

目前 Stage 4 E2E 測試包含：

1. 前端頁面與登入驗證
2. 建立工單並扣減材料
3. Pending → In_Progress
4. In_Progress → Complete
5. Reject 並恢復材料
6. 模具使用中拒絕工單
7. 材料不足拒絕工單
8. 非法工單狀態轉換拒絕

查看 Playwright 報告：

```bash
npx playwright show-report
```

測試使用 `headless: true` 執行。

當 E2E 發生異常時，測試會保留錯誤相關 HTML、Screenshot 與 Trace，方便進行問題分析。

---

## 9. Stage 5 高並發測試

Stage 5 使用 3 個 Worker 同時競爭相同材料與模具。

進入後端：

```bash
cd server
```

執行：

```bash
npm run test:integration
```

高並發測試驗證：

* 3 個 Worker 同時搶同一個模具
* 只有一個 Worker 可以成功建立工單
* 材料庫存不會被超賣
* 材料庫存不會變成負數
* 同一工單重複完成只會增加一次產品庫存
* Optimistic Lock 同一時間只允許一個版本更新成功

預期結果：

```text
tests 14
pass 14
fail 0
```

---

## 10. E2E 測試資料庫

E2E 測試可以使用獨立 PostgreSQL Database。

建立測試資料庫：

```bash
docker compose exec postgres psql -U postgres -c "CREATE DATABASE practice_project2_test;"
```

PowerShell 設定：

```powershell
$env:TEST_DB_HOST="localhost"
$env:TEST_DB_PORT="5432"
$env:TEST_DB_NAME="practice_project2_test"
$env:TEST_DB_USER="postgres"
$env:TEST_DB_PASSWORD="postgres"
```

確認資料庫：

```bash
docker compose exec postgres psql -U postgres -d practice_project2_test -c "SELECT 1;"
```

---

## 11. 常見問題

### Docker Compose 顯示 `version is obsolete`

如果看到：

```text
the attribute `version` is obsolete, it will be ignored
```

代表 `docker-compose.yml` 中仍存在舊版 `version` 欄位。

Docker Compose v2 已不需要此欄位，可以移除：

```yaml
version: "3.8"
```

不影響目前服務執行。

### PowerShell 無法執行 npx

如果看到：

```text
npx.ps1 cannot be loaded because running scripts is disabled
```

Windows 可以改用：

```bash
npm.cmd exec playwright install chromium
```

或：

```bash
npm.cmd test
```

### 查看容器狀態

```bash
docker compose ps
```

### 查看後端 Log

```bash
docker compose logs -f backend
```

### 查看 PostgreSQL Log

```bash
docker compose logs -f postgres
```

### 完全重新建立容器

```bash
docker compose down
docker compose up -d --build
```

---

## 12. Stage 1～5 驗收狀態

| Stage   | 驗收內容                                            | 狀態 |
| ------- | ----------------------------------------------- | -- |
| Stage 1 | 多角色權限與 Material / Mold / Product 資料庫設計          | 通過 |
| Stage 2 | BOM 與 PostgreSQL Transaction 自動領料               | 通過 |
| Stage 3 | Docker / Docker Compose / `.env` / `.gitignore` | 通過 |
| Stage 4 | Playwright 生產線 E2E                              | 通過 |
| Stage 5 | 3 Worker PostgreSQL 高並發測試                       | 通過 |

目前系統已完成 Stage 1～5 的主要功能與驗收測試。

---

## 13. 測試總覽

目前後端 Integration Test：

```text
14 passed
0 failed
```

Playwright E2E：

```text
8 passed
0 failed
```

測試涵蓋：

* 權限控制
* BOM
* 工單生命週期
* 庫存扣料
* 庫存回補
* 產品庫存
* 模具狀態
* Transaction Rollback
* PostgreSQL Constraint
* Optimistic Lock
* 3 Worker 高並發
* Playwright E2E
* Nginx API 整合
