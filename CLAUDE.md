# WMS + MES 生產管理系統 — Claude Code 開發規範

## 1. 專案基準

專案：

```text
practice_project2
```

GitHub：

```text
https://github.com/yellowhite036/practice_project2
```

正式開發 Branch：

```text
master
```

目前專案架構逐步由：

```text
Frontend Prototype
    ↓
Node.js / Express
    ↓
PostgreSQL
```

升級為完整 WMS + MES 系統。

---

# 2. 七階段開發流程

正式開發只使用以下 7 個 Issue：

```text
#1 Database + BOM
 ↓
#2 Backend + Environment
 ↓
#3 Transaction + Pessimistic Lock
 ↓
#4 Optimistic Lock + Constraint Handling
 ↓
#5 Docker + Network Isolation
 ↓
#6 Playwright E2E
 ↓
#7 Concurrent Race Condition
```

不得重新使用舊的：

```text
#0
#16
#17
#18
#19
#20
#21
#22
#23
#24
```

作為新的開發順序。

原 Issue 功能已合併到新的 7 個 Issue。

目前已完成的 Backend API Constraint Handling 視為：

```text
Issue #2
```

的一部分。

不得重複實作。

---

# 3. Git Branch

開始工作前必須確認：

```bash
git branch
git status
git log --oneline --decorate -5
```

正式開發使用：

```text
master
```

如果：

```text
HEAD (no branch)
```

不得直接進行正式開發。

---

# 4. 工作區安全

開始工作前：

```bash
git status
```

如果存在使用者未提交修改：

```text
modified
untracked
staged
```

不得自行刪除或覆蓋。

禁止自行執行：

```bash
git reset --hard
git clean -fd
git checkout -- .
git restore .
```

不得修改與目前 Issue 無關的檔案。

---

# 5. Issue 開發規則

每次只處理一個 Issue。

流程：

```text
閱讀 CLAUDE.md
 ↓
確認 Branch
 ↓
確認 git status
 ↓
閱讀相關程式
 ↓
分析目前架構
 ↓
確認 Issue 範圍
 ↓
實作
 ↓
測試
 ↓
git diff
 ↓
git diff --check
 ↓
git status
 ↓
回報結果
 ↓
使用者確認 Commit
 ↓
進入下一 Issue
```

使用者明確要求直接實作時可以直接進行。

禁止自行：

```text
Commit
Push
建立 PR
```

除非使用者明確要求。

---

# 6. 修改範圍

只修改目前 Issue 必要檔案。

禁止：

```text
無關重構
無關 UI 修改
無關 API 修改
刪除既有功能
修改測試預期以讓測試通過
降低驗證條件
一次完成多個未確認 Issue
```

需要大幅修改架構時：

```text
停止
 ↓
說明原因
 ↓
等待確認
```

---

# 7. Issue #1 — Database + BOM

目的：

```text
建立正式 PostgreSQL Database
+
確認 BOM 關聯結構
```

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

必須建立：

```text
Primary Key
Foreign Key
Unique Constraint
Check Constraint
Index
Migration
```

BOM 正式使用：

```text
bom_table
```

不得重新使用：

```text
product.bom
```

正式 Database BOM：

```text
Product
   │
   ▼
bom_table
   │
   ├── Material
   └── Amount Per Unit
```

完成後驗證：

```text
Migration 可以執行
Tables 正確建立
Foreign Key 正常
Unique Constraint 正常
Check Constraint 正常
BOM 關聯正常
```

---

# 8. Issue #2 — Backend + Environment

目的：

```text
建立完整基本 Backend API
+
Environment Variables
```

Backend：

```text
Node.js
Express
pg
```

API：

```text
Materials
Products
BOM
Molds
Work Orders
Logs
```

必要時包含：

```text
Authentication
Inventory API
```

目前已完成的：

```text
pg.Pool
PostgreSQL API
Explicit SQL Columns
Parameterized SQL
Constraint Error Handling
Input Validation
Health Check
```

視為 Issue #2 已完成內容。

不得重新實作。

---

## Issue #2 SQL 規則

禁止：

```sql
SELECT *
```

禁止：

```sql
RETURNING *
```

使用明確欄位：

```sql
SELECT
    material_id,
    name,
    unit,
    stock
FROM materials;
```

INSERT / UPDATE：

```sql
RETURNING
    material_id,
    name,
    unit,
    stock;
```

必須使用：

```text
Parameterized Query
```

禁止：

```text
String Concatenation SQL
```

---

## Issue #2 PostgreSQL Error Mapping

使用 PostgreSQL error code：

```text
23505 → 409
23503 → 409
23514 → 409
23502 → 400
```

API 不得暴露：

```text
Stack Trace
Database Password
SQL Internal Details
Filesystem Path
```

Health Check：

```text
Database OK → 200
Database Failure → 503
```

DELETE 成功回傳明確 JSON：

```json
{
  "deleted": true,
  "id": "..."
}
```

---

## Issue #2 Environment

至少使用：

```text
DATABASE_HOST
DATABASE_PORT
DATABASE_NAME
DATABASE_USER
DATABASE_PASSWORD
JWT_SECRET
```

建立：

```text
.env
.env.example
```

`.env` 不得進 Git。

`.env.example` 不得包含真實密碼。

禁止：

```javascript
const password = "postgres";
```

禁止：

```javascript
const JWT_SECRET = "secret";
```

---

# 9. Issue #3 — Transaction + Pessimistic Lock

目的：

```text
建立正式生產 Transaction
+
Rollback
+
Pessimistic Lock
```

生產流程：

```text
BEGIN
 ↓
Validate User
 ↓
Validate Product
 ↓
Get BOM
 ↓
Lock Material
 ↓
Check Material Stock
 ↓
Lock Mold
 ↓
Check Mold Status
 ↓
Deduct Material
 ↓
Increase Product
 ↓
Update Mold
 ↓
Create Work Order
 ↓
Create Inventory Transaction
 ↓
Create System Log
 ↓
COMMIT
```

任何錯誤：

```text
ROLLBACK
```

---

# 10. Material Pessimistic Lock

Material 必須在 Transaction 內：

```sql
SELECT ...
FROM materials
WHERE material_id = $1
FOR UPDATE;
```

目的：

```text
防止 Material Race Condition
防止 Stock 超賣
```

Material：

```text
stock >= 0
```

如果：

```text
Current Stock < Required Amount
```

則：

```text
Reject
ROLLBACK
```

---

# 11. Mold Pessimistic Lock

Mold：

```sql
SELECT ...
FROM molds
WHERE mold_id = $1
FOR UPDATE;
```

只有：

```text
Idle
```

可以取得。

如果：

```text
In_Use
```

則：

```text
Reject
ROLLBACK
```

禁止使用：

```text
JavaScript Mutex
Memory Lock
Single Machine Lock
```

取代 PostgreSQL Lock。

---

# 12. Issue #3 驗證

至少測試：

```text
Material 不足
Mold In_Use
Transaction Rollback
Material Lock
Mold Lock
```

失敗後必須確認：

```text
Material 沒有被扣減
Product 沒有增加
Mold 沒有錯誤更新
Work Order 沒有建立
Inventory Transaction 沒有建立
System Log 符合預期
```

---

# 13. Issue #4 — Optimistic Lock + Constraint Handling

目的：

```text
Version Control
+
Concurrent Update Conflict
+
PostgreSQL Constraint Error Handling
```

主要資料：

```text
materials
products
bom_table
molds
```

加入：

```text
version
```

更新：

```sql
UPDATE materials
SET
    stock = $1,
    version = version + 1
WHERE material_id = $2
AND version = $3;
```

如果：

```text
affected rows = 0
```

回傳：

```text
409 Conflict
```

錯誤訊息：

```text
資料已被其他使用者修改，請重新載入。
```

---

# 14. Issue #4 Constraint

PostgreSQL：

```text
23505 → 409
23503 → 409
23514 → 409
23502 → 400
```

測試：

```text
Duplicate
Foreign Key Violation
Check Violation
Not Null Violation
```

目前已完成的 API constraint mapping 可以直接沿用。

---

# 15. Issue #5 — Docker + Network Isolation

建立：

```text
Frontend Container
Backend Container
PostgreSQL Container
```

執行：

```bash
docker compose up -d
```

Backend 使用 Docker Service Name：

```text
postgres:5432
```

禁止 Container 內依賴：

```text
localhost:5432
```

---

# 16. PostgreSQL Network

PostgreSQL 不得：

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

PostgreSQL 只存在 Docker Network。

驗證：

```text
Backend → PostgreSQL = 成功
External Host → PostgreSQL = 無法直接連線
```

---

# 17. Issue #6 — Playwright E2E

使用：

```text
Playwright
```

執行：

```text
headless: true
```

測試：

```text
Login
 ↓
選擇 Product
 ↓
取得 Material Before
 ↓
取得 Product Before
 ↓
取得 Mold Before
 ↓
Create Work Order
 ↓
取得 Material After
 ↓
取得 Product After
 ↓
取得 Mold After
```

驗證：

```text
Material Stock 減少
Product Stock 增加
Mold 狀態正確
Work Order 建立
```

測試必須可重複執行。

---

# 18. Issue #6 Failure Debug

E2E 失敗時自動保存：

```text
Screenshot
HTML Snapshot
Console Log
API Log
Playwright Trace
```

目標：

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

不得要求使用者重新執行一次才能取得除錯資料。

---

# 19. Issue #7 — Concurrent Race Condition

建立：

```text
Worker A
Worker B
Worker C
```

三個 Worker 必須真正同時送出 Request。

禁止：

```text
A 完成
 ↓
B 完成
 ↓
C 完成
```

這不算 Concurrent Test。

共同競爭：

```text
Material X
Mold Y
```

---

# 20. Concurrent 預期結果

每輪：

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

至少：

```text
5 rounds
```

每輪重新初始化測試資料。

---

# 21. Concurrent 驗收

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
Product Stock 只增加成功工單對應數量
```

```text
Failed Transaction 沒有殘留資料
```

---

# 22. 測試規則

每個 Issue 完成後必須實際測試。

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

# 23. Git 驗證

完成後執行：

```bash
git status
git diff --check
git diff --stat
git diff
```

確認：

```text
只有目前 Issue 必要檔案
沒有 Secret
沒有 .env
沒有無關修改
```

---

# 24. Commit 規則

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
feat: 建立 PostgreSQL 資料模型與 BOM 結構 (#1)
```

```text
feat: 建立 Express Backend API 與環境變數管理 (#2)
```

```text
feat: 實作 PostgreSQL Transaction 與悲觀鎖 (#3)
```

```text
feat: 實作 Optimistic Lock 與 Constraint Error Handling (#4)
```

```text
feat: 建立 Docker Compose 與 PostgreSQL Network Isolation (#5)
```

```text
test: 建立 Playwright 生產工單 E2E 測試 (#6)
```

```text
test: 建立三 Worker Race Condition 並發測試 (#7)
```

---

# 25. 禁止事項

禁止：

```text
SQLite
```

禁止使用：

```text
JavaScript Memory Lock
```

取代 PostgreSQL Lock。

禁止：

```text
Hardcoded Database Password
```

禁止：

```text
Hardcoded JWT Secret
```

禁止：

```text
SELECT *
```

禁止：

```text
RETURNING *
```

禁止：

```text
Frontend 直接連 PostgreSQL
```

禁止：

```text
PostgreSQL Host Port 直接暴露
```

禁止：

```text
假並發測試
```

禁止：

```text
為了測試通過而降低驗證條件
```

禁止：

```text
為了測試通過而修改預期結果
```

---

# 26. 最終開發順序

```text
Issue #1
Database + BOM
        ↓
Issue #2
Backend + Environment
        ↓
Issue #3
Transaction + Pessimistic Lock
        ↓
Issue #4
Optimistic Lock + Constraint Handling
        ↓
Issue #5
Docker + Network Isolation
        ↓
Issue #6
Playwright E2E
        ↓
Issue #7
Concurrent Race Condition
```

---

# 27. 最終驗收

## Database

* [ ] Schema
* [ ] Migration
* [ ] Primary Key
* [ ] Foreign Key
* [ ] Unique
* [ ] Check
* [ ] Index
* [ ] BOM 關聯

## Backend

* [ ] Express
* [ ] pg.Pool
* [ ] Environment Variables
* [ ] Materials API
* [ ] Products API
* [ ] BOM API
* [ ] Molds API
* [ ] Work Orders API
* [ ] Logs API
* [ ] Constraint Error Handling

## Transaction

* [ ] BEGIN
* [ ] COMMIT
* [ ] ROLLBACK
* [ ] Material `FOR UPDATE`
* [ ] Mold `FOR UPDATE`
* [ ] Material 不足 Rollback
* [ ] Mold In_Use Rollback

## Optimistic Lock

* [ ] version
* [ ] Material
* [ ] Product
* [ ] BOM
* [ ] Mold
* [ ] 409 Conflict

## Docker

* [ ] Frontend
* [ ] Backend
* [ ] PostgreSQL
* [ ] Docker Network
* [ ] PostgreSQL 不暴露 Host Port

## E2E

* [ ] Playwright
* [ ] Headless
* [ ] Login
* [ ] Work Order
* [ ] Material
* [ ] Product
* [ ] Mold
* [ ] Screenshot
* [ ] HTML
* [ ] Console Log
* [ ] API Log
* [ ] Trace

## Concurrent

* [ ] Worker A
* [ ] Worker B
* [ ] Worker C
* [ ] 真正並發 Request
* [ ] 1 SUCCESS
* [ ] 2 REJECT
* [ ] 5 rounds
* [ ] Material 不為負數
* [ ] Mold 不重複使用
* [ ] Product Stock 正確
* [ ] Failed Transaction 完整 Rollback

---

# 28. 最終目標

```text
                         ┌────────────────────┐
                         │   Playwright E2E   │
                         └─────────┬──────────┘
                                   │
                                   ▼
┌─────────────────┐       ┌────────────────────┐
│    Frontend     │──────►│ Node.js / Express  │
└─────────────────┘       └─────────┬──────────┘
                                    │
                                    ▼
                         ┌────────────────────┐
                         │    PostgreSQL      │
                         │                    │
                         │ Transaction        │
                         │ Rollback           │
                         │ Pessimistic Lock   │
                         │ Optimistic Lock    │
                         └─────────┬──────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                Worker A       Worker B       Worker C
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
