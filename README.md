# WMS + MES 生產管理系統

`practice_project2` 是一個 WMS + MES 生產管理系統練習專案，用於模擬製造現場的產品、材料、BOM、模具、庫存與生產工單管理。

專案從 Frontend Prototype 開始，逐步建立：

```text
Frontend
    ↓
Node.js / Express API
    ↓
PostgreSQL
```

最終加入：

```text
PostgreSQL Transaction
Rollback
Pessimistic Lock
Optimistic Lock
Docker
Playwright E2E
Concurrent Worker
Race Condition Test
```

---

# 1. 專案資訊

Repository：

```text
https://github.com/yellowhite036/practice_project2
```

主要 Branch：

```text
master
```

---

# 2. 專案目標

建立一套具有資料一致性與並發控制能力的 WMS + MES 練習系統。

最終架構：

```text
┌────────────────────┐
│      Frontend      │
│                    │
│ Product            │
│ Material           │
│ BOM                │
│ Mold               │
│ Work Order         │
└─────────┬──────────┘
          │ REST API
          ▼
┌────────────────────┐
│ Node.js / Express  │
│                    │
│ Authentication     │
│ Product API        │
│ Material API       │
│ BOM API            │
│ Mold API           │
│ Work Order API     │
│ Inventory API      │
│ Log API            │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│     PostgreSQL     │
│                    │
│ Transaction        │
│ Rollback           │
│ Pessimistic Lock   │
│ Optimistic Lock    │
└────────────────────┘
```

---

# 3. 目前功能

Frontend Prototype 已具備：

* Material 管理
* Product 管理
* BOM 管理
* Mold 管理
* Work Order 建立
* Material Stock 顯示
* Product Stock 顯示
* Mold Status 顯示
* Inventory / Log 顯示
* localStorage 保存
* Material Stock 不足防呆
* Mold `In_Use` 防呆
* 生產後 Material Stock 扣減
* 生產後 Product Stock 增加
* 生產後 Mold 狀態更新

Backend 已逐步建立：

```text
Node.js
Express
PostgreSQL
pg.Pool
REST API
PostgreSQL Constraint Error Handling
```

目前 API 已具備：

* Health Check
* Materials API
* Products API
* Molds API
* BOM API
* Work Orders API
* Logs API
* PostgreSQL constraint error mapping
* 明確 SQL 欄位
* Parameterized SQL
* API input validation

目前已驗證：

```text
npm test
10 tests
10 passed
0 failed
```

目前 PostgreSQL API 已實際測試：

```text
GET /api/health
POST /api/materials
GET /api/materials
```

並驗證：

```text
Invalid stock → 400
Duplicate material → 409
Database health failure → 503
```

---

# 4. Database 資料模型

正式 Database：

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

BOM 使用獨立關聯表：

```text
Product
   │
   ▼
bom_table
   │
   ├── Material
   └── Amount Per Unit
```

正式 Database 不使用：

```text
product.bom
```

作為 BOM 儲存結構。

---

# 5. Material

主要欄位：

```text
material_id
name
unit
stock
capacity
safety_stock
location
version
```

規則：

```text
stock >= 0
capacity >= 0
safety_stock >= 0
```

生產需求：

```text
Required Amount
=
Amount Per Unit
×
Production Quantity
```

Material 不足時：

```text
Reject
+
ROLLBACK
```

禁止：

```text
Stock < 0
```

---

# 6. Product

主要欄位：

```text
product_id
name
cycle_minutes
mold_id
stock
version
```

規則：

```text
cycle_minutes > 0
stock >= 0
```

Product 與 Mold 使用 Foreign Key：

```text
products.mold_id
        ↓
molds.mold_id
```

---

# 7. Mold

主要欄位：

```text
mold_id
name
status
line
eta
product_id
version
```

狀態：

```text
Idle
In_Use
```

只有：

```text
Idle
```

可以被新的生產工單取得。

---

# 8. BOM

主要欄位：

```text
bom_id
product_id
material_id
amount_per_unit
version
```

Constraint：

```text
(product_id, material_id) UNIQUE
amount_per_unit > 0
```

Product 與 Material：

```text
products
   │
   ▼
bom_table
   │
   ▼
materials
```

---

# 9. Work Order

主要欄位：

```text
work_order_id
product_id
quantity
line
mold_id
status
creator_user_id
creator_name
```

正式生產流程：

```text
建立 Work Order
        ↓
取得 BOM
        ↓
計算 Material Requirement
        ↓
鎖定 Material
        ↓
檢查 Stock
        ↓
鎖定 Mold
        ↓
檢查 Mold Status
        ↓
扣減 Material
        ↓
增加 Product Stock
        ↓
更新 Mold
        ↓
建立 Work Order
        ↓
建立 Inventory Transaction
        ↓
建立 System Log
        ↓
COMMIT
```

---

# 10. Transaction

整個生產流程使用單一 PostgreSQL Transaction：

```text
BEGIN
  ↓
Lock
  ↓
Validate
  ↓
Update
  ↓
Insert
  ↓
COMMIT
```

任何錯誤：

```text
ROLLBACK
```

例如 Material 不足：

```text
Material 不扣減
Product 不增加
Mold 不更新
Work Order 不建立
```

---

# 11. Pessimistic Lock

生產時使用 PostgreSQL：

```sql
SELECT ...
FROM materials
WHERE material_id = $1
FOR UPDATE;
```

以及：

```sql
SELECT ...
FROM molds
WHERE mold_id = $1
FOR UPDATE;
```

用途：

```text
Material
→ 防止超賣

Mold
→ 防止同一模具被多個 Worker 同時取得
```

Lock 必須存在於 PostgreSQL Transaction 中。

---

# 12. Optimistic Lock

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

更新時：

```text
WHERE id = ?
AND version = ?
```

成功：

```text
version + 1
```

如果更新筆數：

```text
0
```

代表版本衝突：

```text
HTTP 409 Conflict
```

---

# 13. API Error Handling

PostgreSQL Constraint Error：

```text
23505 → 409 Conflict
23503 → 409 Conflict
23514 → 409 Conflict
23502 → 400 Bad Request
```

API 不回傳：

```text
database stack trace
SQL details
internal path
```

Health Check：

```text
Database OK → 200
Database failure → 503
```

---

# 14. Environment Variables

使用：

```text
.env
.env.example
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

`.env`：

```text
禁止進入 Git
```

`.env.example`：

```text
只放 Placeholder
```

---

# 15. Docker

最終使用：

```bash
docker compose up -d
```

啟動：

```text
Frontend
Backend
PostgreSQL
```

Docker Network：

```text
Frontend
   ↓
Backend
   ↓
PostgreSQL
```

PostgreSQL 不直接暴露：

```text
5432
```

---

# 16. Playwright E2E

測試：

```text
Login
 ↓
Product
 ↓
Material Before
 ↓
Product Before
 ↓
Mold Before
 ↓
Create Work Order
 ↓
Material After
 ↓
Product After
 ↓
Mold After
```

驗證：

```text
Material Stock 減少
Product Stock 增加
Mold 狀態正確
```

失敗時保存：

```text
Screenshot
HTML Snapshot
Console Log
API Log
Playwright Trace
```

---

# 17. Concurrent Race Condition

建立：

```text
Worker A
Worker B
Worker C
```

三個 Worker 同時競爭：

```text
Material X
Mold Y
```

預期：

```text
Worker A → SUCCESS
Worker B → REJECT
Worker C → REJECT
```

每輪：

```text
SUCCESS = 1
REJECT = 2
```

至少執行：

```text
5 rounds
```

驗證：

```text
Material Stock >= 0
Mold 不被同時使用
Product Stock 正確
Failed Transaction 完整 Rollback
```

---

# 18. 七階段 Issue

專案正式開發縮減為 7 個 Issue：

| Issue | 名稱                                    | 主要內容                                 |
| ----- | ------------------------------------- | ------------------------------------ |
| #1    | Database + BOM                        | BOM、Schema、Migration、Constraints     |
| #2    | Backend + Environment                 | Express、API、pg、Environment Variables |
| #3    | Transaction + Pessimistic Lock        | Transaction、Rollback、FOR UPDATE      |
| #4    | Optimistic Lock + Constraint Handling | Version、409、DB Error Mapping         |
| #5    | Docker + Network Isolation            | Compose、Network、PostgreSQL Isolation |
| #6    | Playwright E2E                        | 完整工單流程與失敗除錯                          |
| #7    | Concurrent Race Condition             | 3 Worker、並發、5 rounds                 |

---

# 19. Issue 開發順序

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

每個 Issue 完成後：

```text
測試
 ↓
git diff
 ↓
git status
 ↓
確認修改範圍
 ↓
Commit
 ↓
進入下一個 Issue
```

---

# 20. 最終驗收

## Database

* [ ] Schema
* [ ] Migration
* [ ] Primary Key
* [ ] Foreign Key
* [ ] Unique Constraint
* [ ] Check Constraint
* [ ] Index
* [ ] BOM 關聯正常

## Backend

* [ ] Express
* [ ] PostgreSQL
* [ ] Product API
* [ ] Material API
* [ ] BOM API
* [ ] Mold API
* [ ] Work Order API
* [ ] Log API
* [ ] Environment Variables

## Transaction

* [ ] BEGIN
* [ ] COMMIT
* [ ] ROLLBACK
* [ ] Material Lock
* [ ] Mold Lock
* [ ] Material 不足 Rollback
* [ ] Mold In_Use Rollback

## Optimistic Lock

* [ ] version
* [ ] Version Conflict
* [ ] HTTP 409
* [ ] Material
* [ ] Product
* [ ] BOM
* [ ] Mold

## Docker

* [ ] Frontend Container
* [ ] Backend Container
* [ ] PostgreSQL Container
* [ ] Docker Network
* [ ] PostgreSQL 不暴露 Host Port

## E2E

* [ ] Playwright
* [ ] Headless
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

# 21. 最終目標

完成後：

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
