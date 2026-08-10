# WMS + MES 生產管理系統 — Codex / Claude Code 開發規範

## 1. 專案基準

專案：

```text
practice_project2
```

GitHub：

```text
https://github.com/yellowhite036/practice_project2
```

目前正式開發基準：

```text
master
```

目前已確認 `master` 為純前端 Prototype。

`master` 目前主要檔案：

```text
README.md
index.html
app.js
styles.css
```

目前 `master` 尚未正式具備：

```text
Node.js / Express Backend
PostgreSQL
Database Migration
PostgreSQL Transaction
Pessimistic Lock
Optimistic Lock
JWT Authentication
Docker
Playwright
Concurrent Worker
Race Condition Test
```

因此不得假設上述功能已存在。

---

# 2. Git Branch 規則

所有正式開發必須以：

```text
master
```

為基準。

開始工作前必須確認：

```bash
git branch
git status
git log --oneline --decorate -5
```

確認目前 Branch 與工作區狀態。

如果目前為：

```text
HEAD (no branch)
```

不得直接在 detached HEAD 上進行正式開發。

必須先確認使用者是否允許切換至 `master`。

---

# 3. 工作區安全規則

開始任何工作前必須檢查：

```bash
git status
```

如果存在未提交修改：

```text
README.md modified
CLAUDE.md untracked
其他使用者修改
```

不得自行：

```bash
git reset --hard
git clean -fd
git checkout -- .
git restore .
```

不得覆蓋使用者既有修改。

不得自行刪除未追蹤檔案。

---

# 4. Detached HEAD 版本規則

目前已知 detached HEAD 可能包含：

```text
package.json
package-lock.json
server.js
.gitignore
```

這些檔案只能作為：

```text
參考資料
```

不得直接視為 `master` 的正式架構。

不得直接將 detached HEAD 整批複製到 `master`。

使用前必須：

1. 分析其功能。
2. 確認與 master 的差異。
3. 確認哪些程式可以重用。
4. 提出採用原因。
5. 等待使用者確認。

---

# 5. 目前 master 架構

目前：

```text
HTML
 │
 ▼
Vanilla JavaScript
 │
 ▼
localStorage
```

目前不是：

```text
React
 │
 ▼
Node.js / Express
 │
 ▼
PostgreSQL
```

因此後續開發必須逐步完成架構升級。

目標架構：

```text
Frontend
    │
    │ HTTP / REST API
    ▼
Node.js / Express
    │
    │ PostgreSQL Driver
    ▼
PostgreSQL
```

---

# 6. 目前已完成的 Frontend 功能

目前 `master` 已具備部分 WMS / MES Prototype：

* Material 管理
* Product 管理
* BOM 關聯資料
* Mold 管理
* Work Order 建立
* Material Stock 顯示
* Product Stock 顯示
* Mold Status
* Work Order List
* Inventory / Log 顯示
* localStorage 資料保存
* Material Stock 不足前端防呆
* Mold `In_Use` 前端防呆

這些功能屬於：

```text
Frontend Prototype
```

不是正式 Database Transaction。

---

# 7. BOM 規則

目前專案已採用：

```text
bomTable
```

作為 Product 與 Material 的關聯資料。

目標資料模型：

```text
Product
   │
   ▼
BOM
   │
   ├── Material
   │
   ├── Amount Per Unit
   │
   └── Mold
```

不得重新將 BOM 長期放回：

```text
product.bom
```

正式 Backend / PostgreSQL 架構必須使用獨立 BOM 關聯表。

目前 `master` 若仍存在：

```text
product.bom
```

相關殘留程式碼，必須在正式修改前先分析。

不得直接刪除而不確認其使用位置。

---

# 8. Backend 建立規則

因為 `master` 目前沒有正式 Backend，必須建立：

```text
Node.js
Express
```

Backend 負責：

* Authentication
* Product API
* Material API
* BOM API
* Mold API
* Work Order API
* Inventory API
* Log API

Frontend 不得直接操作 PostgreSQL。

架構：

```text
Frontend
   │
   ▼
Express API
   │
   ▼
PostgreSQL
```

---

# 9. PostgreSQL 資料模型

正式 Database 預計包含：

```text
users
materials
products
bom_table
molds
work_orders
inventory_transactions
system_logs
```

建立 Database Schema 前：

1. 先確認目前 frontend state。
2. 確認每個欄位的用途。
3. 建立 migration。
4. 建立必要的 Primary Key。
5. 建立 Foreign Key。
6. 建立必要的 Unique Constraint。
7. 建立必要的 Check Constraint。
8. 確認 Transaction 所需欄位。

禁止直接根據文件猜測目前資料欄位。

---

# 10. Transaction 核心規則

正式生產工單建立流程必須使用單一 PostgreSQL Transaction。

流程：

```text
BEGIN
  ↓
驗證 User
  ↓
驗證 Product
  ↓
取得 BOM
  ↓
鎖定 Material
  ↓
檢查 Material Stock
  ↓
鎖定 Mold
  ↓
檢查 Mold Status
  ↓
扣減 Material Stock
  ↓
增加 Product Stock
  ↓
更新 Mold Status
  ↓
建立 Work Order
  ↓
建立 Inventory Transaction
  ↓
建立 System Log
  ↓
COMMIT
```

任何步驟失敗：

```text
ROLLBACK
```

禁止產生部分完成狀態。

---

# 11. Material Stock 規則

Material Stock 不得小於 0。

需求量：

```text
Required Amount
=
BOM Amount Per Unit
×
Production Quantity
```

如果：

```text
Current Stock < Required Amount
```

則：

```text
Reject Work Order
ROLLBACK
```

結果：

```text
Material 不扣減
Product 不增加
Mold 不更新
Work Order 不建立
```

---

# 12. Mold 規則

Mold 狀態：

```text
Idle
In_Use
```

只有：

```text
Idle
```

可以被新的 Work Order 使用。

如果：

```text
Mold = In_Use
```

則：

```text
Reject
ROLLBACK
```

同一個 Mold 不得同時被兩張成功 Work Order 使用。

---

# 13. PostgreSQL 悲觀鎖

正式生產流程使用 PostgreSQL Pessimistic Lock。

Material：

```sql
SELECT ...
FROM materials
WHERE material_id = $1
FOR UPDATE;
```

Mold：

```sql
SELECT ...
FROM molds
WHERE mold_id = $1
FOR UPDATE;
```

規則：

* Lock 必須位於 Transaction 內。
* Material 扣減前必須取得 Lock。
* Mold 狀態修改前必須取得 Lock。
* Commit 後 Lock 釋放。
* Rollback 後 Lock 釋放。
* 不得使用 JavaScript memory lock 取代 Database Lock。
* 不得使用單機 mutex 取代 PostgreSQL Lock。

---

# 14. PostgreSQL 樂觀鎖

管理型資料使用：

```text
version
```

主要資料：

```text
materials
products
bom_table
molds
```

更新：

```sql
UPDATE ...
SET
    ...,
    version = version + 1
WHERE id = $1
AND version = $2;
```

如果：

```text
affected rows = 0
```

代表版本衝突。

API：

```text
HTTP 409 Conflict
```

錯誤訊息必須明確表示：

```text
資料已被其他使用者修改，請重新載入。
```

---

# 15. Lock 分工

Pessimistic Lock：

```text
生產時資源競爭
```

主要：

```text
Material
Mold
```

Optimistic Lock：

```text
管理資料編輯
```

主要：

```text
Material
Product
BOM
Mold
```

不得將兩者混成同一個機制。

---

# 16. Authentication

正式系統使用 JWT。

JWT Secret 必須：

```text
process.env.JWT_SECRET
```

禁止：

```javascript
const JWT_SECRET = "secret";
```

禁止：

```text
Hardcoded Secret
```

使用者登入資訊必須由 Backend 驗證。

Frontend 的 role toggle 不得視為正式 Authentication。

---

# 17. Environment Variables

敏感資訊使用：

```text
.env
```

至少包含：

```text
DATABASE_HOST
DATABASE_PORT
DATABASE_NAME
DATABASE_USER
DATABASE_PASSWORD
JWT_SECRET
```

實際名稱依專案實作決定。

必須建立：

```text
.env
.env.example
.gitignore
```

`.env`：

```text
禁止 Push
```

`.env.example`：

```text
只允許 Placeholder
```

禁止將真實密碼或 Secret 寫入：

* JavaScript
* JSON
* Dockerfile
* docker-compose.yml
* README
* Git

---

# 18. Docker

目標：

```bash
docker compose up -d
```

啟動：

```text
Frontend
Backend
PostgreSQL
```

Backend 使用 Docker Network 連 PostgreSQL。

Container 內禁止依賴：

```text
localhost:5432
```

應使用 Docker Service Name。

---

# 19. PostgreSQL Network Isolation

PostgreSQL 不得直接對 Host 暴露：

```yaml
ports:
  - "5432:5432"
```

目標：

```text
Frontend
   ↓
Backend
   ↓
PostgreSQL
```

PostgreSQL 只允許 Docker Network 內部服務連線。

必須實際驗證：

```text
Backend → PostgreSQL
```

可以連線。

並驗證：

```text
External Host → PostgreSQL
```

無法直接連線。

---

# 20. Playwright E2E

使用：

```text
Playwright
```

執行：

```text
headless: true
```

主要流程：

```text
Login
 ↓
選擇 Product A
 ↓
記錄 Material Before
 ↓
記錄 Product Before
 ↓
記錄 Mold Before
 ↓
建立 Work Order
 ↓
記錄 Material After
 ↓
記錄 Product After
 ↓
記錄 Mold After
 ↓
驗證結果
```

必須驗證：

```text
Material Stock 減少
Product Stock 增加
Mold Idle → In_Use
```

測試必須可以重複執行。

---

# 21. E2E Failure Debug

E2E 失敗時自動產生：

```text
Screenshot
HTML Snapshot
Console Log
API Log
Playwright Trace
```

建議：

```text
test-results/
└── <test-case>/
    └── <timestamp>/
        ├── screenshot.png
        ├── page.html
        ├── console.log
        ├── api.log
        └── trace.zip
```

不得要求使用者重新手動執行一次才能取得除錯資料。

---

# 22. Concurrent Worker

建立：

```text
Worker A
Worker B
Worker C
```

三個 Worker 同時生產：

```text
Product A
```

共同競爭：

```text
Material X
Mold Y
```

必須建立真正的並發 Request。

不得使用：

```text
A 完成 → B → 完成 → C
```

取代並發測試。

---

# 23. 三產線預期結果

假設：

```text
Mold Y = 1
Material X = 有限
```

三個 Worker 同時建立工單：

```text
Worker A → SUCCESS
Worker B → REJECT
Worker C → REJECT
```

預期：

```text
SUCCESS = 1
REJECT = 2
```

成功：

```text
Material 正確扣減
Product 正確增加
Mold = In_Use
Work Order 建立
```

失敗：

```text
Transaction ROLLBACK
```

---

# 24. Concurrent 驗收

至少執行：

```text
5 rounds
```

每輪重新初始化測試資料。

每輪確認：

```text
SUCCESS = 1
REJECT = 2
```

並確認：

```text
Material Stock >= 0
```

```text
同一 Mold 不得被多張成功工單使用
```

```text
Product Stock 只增加成功工單數量
```

```text
失敗 Transaction 沒有殘留資料
```

---

# 25. 開發 Issue 順序

因為目前 `master` 尚未具備 Backend / PostgreSQL，所以正式順序：

```text
#0  Master BOM 結構修正
 ↓
#1  PostgreSQL Schema / Migration
 ↓
#2  Node.js / Express Backend API
 ↓
#20 Environment Variables
 ↓
#16 PostgreSQL Transaction + 悲觀鎖
 ↓
#17 PostgreSQL 樂觀鎖
 ↓
#18 Transaction / Lock Test
 ↓
#19 Docker Compose
 ↓
#21 PostgreSQL Network Isolation
 ↓
#22 Playwright E2E
 ↓
#23 E2E Failure Debug
 ↓
#24 三產線高並發 Race Condition
```

`#0～#2` 為前置架構任務。

原有 #16～#24 編號保持不變。

---

# 26. Issue #0 — 修正 Master BOM 結構

目的：

確認 `master` 前端已完全使用：

```text
bomTable
```

處理目前仍存在的：

```text
product.bom
```

相關殘留邏輯。

例如：

```text
getDerivedProduct()
deleteMaterial()
```

修改前必須先完整搜尋：

```text
product.bom
p.bom
```

確認所有使用位置。

不得直接刪除欄位而造成其他功能失效。

完成後必須測試：

* Product 顯示
* BOM
* Material
* Work Order
* Material Delete
* Product Delete

---

# 27. Issue #1 — PostgreSQL Schema / Migration

建立正式 PostgreSQL Database Schema。

包含：

```text
users
materials
products
bom_table
molds
work_orders
inventory_transactions
system_logs
```

必須：

* Primary Key
* Foreign Key
* Unique Constraint
* Check Constraint
* 必要 Index
* Migration

此階段先建立正確 Database Model。

---

# 28. Issue #2 — Backend API

建立：

```text
Node.js
Express
PostgreSQL Driver
```

API 至少涵蓋：

```text
Authentication
Products
Materials
BOM
Molds
Work Orders
Inventory
Logs
```

Frontend 逐步從：

```text
localStorage
```

轉換成：

```text
REST API
```

此階段先完成基本 CRUD 與資料流。

正式 Transaction / Lock 由 #16 處理。

---

# 29. Issue #20 — Environment Variables

建立：

```text
.env
.env.example
.gitignore
```

所有 Database 與 JWT Secret 改由 Environment Variables 取得。

---

# 30. Issue #16 — Transaction + Pessimistic Lock

實作：

```text
PostgreSQL Transaction
+
SELECT ... FOR UPDATE
+
Rollback
```

驗證：

* Material 不足
* Mold In_Use
* Material Race
* Mold Race

---

# 31. Issue #17 — Optimistic Lock

加入：

```text
version
```

處理：

```text
Material
Product
BOM
Mold
```

Version Conflict：

```text
409 Conflict
```

---

# 32. Issue #18 — Lock / Transaction Test

建立：

* Transaction Rollback Test
* Material Concurrent Test
* Mold Concurrent Test
* Optimistic Lock Conflict Test
* Pessimistic Lock Test
* Negative Stock Test
* Duplicate Mold Test

所有測試必須實際執行。

---

# 33. Issue #19 — Docker Compose

建立：

```text
Frontend
Backend
PostgreSQL
```

支援：

```bash
docker compose up -d
```

---

# 34. Issue #21 — PostgreSQL Network Isolation

確認：

```text
PostgreSQL 不暴露 Host Port
```

Backend 可以正常連線。

External Host 不可直接連 PostgreSQL。

---

# 35. Issue #22 — Playwright E2E

建立完整工單 E2E：

```text
Login
→ Product A
→ Create Work Order
→ Material Validation
→ Product Validation
→ Mold Validation
```

---

# 36. Issue #23 — E2E Failure Debug

失敗自動產生：

```text
Screenshot
HTML
Console Log
API Log
Trace
```

---

# 37. Issue #24 — 三產線 Race Condition

建立：

```text
Worker A
Worker B
Worker C
```

同時搶：

```text
Material X
Mold Y
```

預期：

```text
1 SUCCESS
2 REJECT
```

至少執行：

```text
5 rounds
```

確認資料一致性。

---

# 38. 修改前流程

每一個 Issue：

```text
閱讀 CLAUDE.md
 ↓
確認 Git Branch
 ↓
確認 git status
 ↓
閱讀相關程式
 ↓
分析目前架構
 ↓
提出實作計畫
 ↓
等待使用者確認
 ↓
修改
 ↓
測試
 ↓
git diff
 ↓
回報結果
```

如果使用者沒有明確要求直接修改：

```text
只提供實作計畫
```

---

# 39. 修改範圍

只修改目前 Issue 必要檔案。

禁止：

* 無關重構
* 無關 UI 修改
* 無關 API 修改
* 刪除既有功能
* 為測試通過而修改測試預期
* 為測試通過而降低驗證條件
* 一次執行多個未確認 Issue

如果需要大幅修改架構：

```text
先停止
先回報
等待確認
```

---

# 40. 測試規則

完成後必須實際執行測試。

禁止只回報：

```text
應該可以
理論上沒問題
```

必須提供：

```text
Test Command
PASS / FAIL
測試數量
錯誤內容
```

Concurrent Test 必須提供：

```text
Round 1
Round 2
Round 3
Round 4
Round 5
```

結果。

---

# 41. Git Commit 規則

除非使用者明確要求：

```text
不要自行 Commit
不要自行 Push
不要自行建立 PR
```

Commit 格式：

```text
<type>: <description> (#issue)
```

例如：

```text
feat: 建立 PostgreSQL 資料模型 (#1)
```

```text
feat: 建立 Node.js Express Backend API (#2)
```

```text
feat: 實作 PostgreSQL 悲觀鎖機制 (#16)
```

```text
test: 新增三產線高並發 Race Condition 測試 (#24)
```

---

# 42. 最終驗收

## Frontend

* [ ] BOM 使用 bomTable
* [ ] 不再依賴 product.bom
* [ ] Work Order 正常
* [ ] Material 正常
* [ ] Product 正常
* [ ] Mold 正常

## Backend

* [ ] Express API
* [ ] Authentication
* [ ] Product API
* [ ] Material API
* [ ] BOM API
* [ ] Mold API
* [ ] Work Order API
* [ ] Inventory API
* [ ] Log API

## PostgreSQL

* [ ] Schema
* [ ] Migration
* [ ] Foreign Key
* [ ] Constraint
* [ ] Transaction
* [ ] Rollback
* [ ] Pessimistic Lock
* [ ] Optimistic Lock

## Security

* [ ] `.env`
* [ ] `.env.example`
* [ ] `.gitignore`
* [ ] JWT Secret 不寫死
* [ ] DB Password 不寫死
* [ ] `.env` 未 Push

## Docker

* [ ] Frontend Container
* [ ] Backend Container
* [ ] PostgreSQL Container
* [ ] Docker Network
* [ ] PostgreSQL 不暴露 Host Port

## E2E

* [ ] Playwright
* [ ] headless
* [ ] Login
* [ ] Work Order
* [ ] Material 驗證
* [ ] Product 驗證
* [ ] Mold 驗證
* [ ] Screenshot
* [ ] HTML Snapshot
* [ ] Console Log
* [ ] API Log
* [ ] Trace

## Concurrent

* [ ] 3 Worker
* [ ] 同時 Request
* [ ] 1 SUCCESS
* [ ] 2 REJECT
* [ ] Material 不為負數
* [ ] Mold 不重複使用
* [ ] Product Stock 正確
* [ ] Transaction 完整 Rollback
* [ ] 5 rounds 穩定通過

---

# 43. 最終目標架構

```text
                         ┌────────────────────┐
                         │   Playwright E2E   │
                         └─────────┬──────────┘
                                   │
                                   ▼
┌─────────────────┐       ┌────────────────────┐
│ React / Frontend│ ────► │ Node.js / Express  │
└─────────────────┘       └─────────┬──────────┘
                                    │
                                    ▼
                         ┌────────────────────┐
                         │    PostgreSQL      │
                         │                    │
                         │ Transaction        │
                         │ Pessimistic Lock   │
                         │ Optimistic Lock    │
                         │ Rollback            │
                         └─────────┬──────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
               Worker A                       Worker B
                    │                             │
                    └────────── Worker C ─────────┘
```

最終必須證明：

```text
Material 不會變負數
+
Mold 不會被同時使用
+
失敗工單完整 Rollback
+
Optimistic Lock 可以偵測版本衝突
+
3 Worker 並發時資料保持一致
+
PostgreSQL 不直接暴露給外部
+
Secret 不進入 Git
+
E2E 可以驗證完整生產流程
```
