# WMS + MES 生產管理系統

`practice_project2` 是一個 WMS + MES 生產管理系統練習專案，用於模擬製造現場的產品、材料、BOM、模具、庫存與生產工單管理。

專案目前由前端 Prototype 開始，後續逐步建立：

```text
Frontend
    ↓
Node.js / Express API
    ↓
PostgreSQL
```

並加入：

* PostgreSQL Transaction
* Rollback
* 悲觀鎖
* 樂觀鎖
* Docker
* Playwright E2E
* Race Condition
* 多產線高並發測試

---

# 1. 專案資訊

Repository：

```text
https://github.com/yellowhite036/practice_project2
```

主要開發 Branch：

```text
master
```

---

# 2. 目前專案狀態

目前 `master` 為前端 Prototype。

目前主要檔案：

```text
README.md
CLAUDE.md
index.html
app.js
styles.css
```

目前前端使用：

```text
HTML
CSS
Vanilla JavaScript
localStorage
```

目前尚未完成：

```text
Node.js / Express Backend
PostgreSQL
Database Migration
PostgreSQL Transaction
Pessimistic Lock
Optimistic Lock
JWT Authentication
Docker
Playwright E2E
Concurrent Worker
Race Condition Test
```

---

# 3. 已完成功能

目前前端 Prototype 已提供：

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

這些功能目前屬於：

```text
Frontend Simulation
```

尚未具備正式 Database Transaction。

---

# 4. 目前 Frontend 架構

```text
┌──────────────────────┐
│      index.html      │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│       app.js         │
│                      │
│ Product              │
│ Material             │
│ BOM                  │
│ Mold                 │
│ Work Order           │
│ Inventory            │
│ Logs                 │
└──────────┬───────────┘
           │
           ▼
      localStorage
```

目前資料主要存在瀏覽器端。

---

# 5. 目標架構

完成後：

```text
┌──────────────────────┐
│ Frontend             │
│                      │
│ Login                │
│ Product              │
│ Material             │
│ BOM                  │
│ Mold                 │
│ Work Order           │
└──────────┬───────────┘
           │ REST API
           ▼
┌──────────────────────┐
│ Node.js / Express    │
│                      │
│ Authentication       │
│ Product API          │
│ Material API         │
│ BOM API              │
│ Mold API              │
│ Work Order API       │
│ Inventory API         │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ PostgreSQL           │
│                      │
│ users                │
│ materials            │
│ products             │
│ bom_table            │
│ molds                │
│ work_orders          │
│ inventory_transactions│
│ system_logs          │
└──────────────────────┘
```

---

# 6. Database 資料模型

目標建立：

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

BOM 使用獨立關聯表。

```text
Product
   │
   ▼
bom_table
   │
   ├── Material
   ├── Amount Per Unit
   └── Mold
```

不再以：

```text
product.bom
```

作為正式 Database BOM 結構。

---

# 7. 生產工單流程

正式 Backend 完成後：

```text
Login
  ↓
選擇 Product
  ↓
取得 BOM
  ↓
計算 Material Requirement
  ↓
鎖定 Material
  ↓
檢查 Material Stock
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

整個流程使用單一 PostgreSQL Transaction。

---

# 8. Transaction / Rollback

任何生產流程錯誤：

```text
ROLLBACK
```

例如：

```text
Material Stock 不足
```

結果：

```text
Material 不扣減
Product 不增加
Mold 不更新
Work Order 不建立
```

如果：

```text
Mold = In_Use
```

同樣：

```text
ROLLBACK
```

禁止出現：

```text
Material 已扣減
+
Mold 取得失敗
```

這類部分完成狀態。

---

# 9. 悲觀鎖

生產工單使用 PostgreSQL Pessimistic Lock。

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

用途：

```text
Material
↓
防止超賣

Mold
↓
防止同一模具被多條產線同時取得
```

---

# 10. 樂觀鎖

管理型資料加入：

```text
version
```

適用：

```text
materials
products
bom_table
molds
```

更新時：

```sql
UPDATE ...
SET version = version + 1
WHERE id = $1
AND version = $2;
```

如果更新筆數為：

```text
0
```

代表版本衝突。

API 回傳：

```text
409 Conflict
```

---

# 11. Material 規則

Material Stock 不得小於：

```text
0
```

需求量：

```text
BOM Amount Per Unit
×
Production Quantity
```

如果庫存不足：

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

可以被新的工單取得。

如果：

```text
In_Use
```

則拒絕新的生產工單。

同一 Mold 不得同時被兩張成功 Work Order 使用。

---

# 13. Environment Variables

正式架構使用：

```text
.env
```

管理：

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
.gitignore
```

`.env` 不得 Push 到 Git。

`.env.example` 不放真實密碼。

---

# 14. Authentication

正式 Backend 使用 JWT。

JWT Secret 使用：

```text
process.env.JWT_SECRET
```

禁止將 JWT Secret 寫死在程式碼。

---

# 15. Docker

目標使用：

```bash
docker compose up -d
```

啟動：

```text
Frontend
Backend
PostgreSQL
```

Container 架構：

```text
Frontend
   ↓
Backend
   ↓
PostgreSQL
```

Backend 透過 Docker Network 連 PostgreSQL。

---

# 16. PostgreSQL Network Isolation

PostgreSQL 不對 Host 暴露：

```text
5432
```

禁止：

```yaml
ports:
  - "5432:5432"
```

目標：

```text
Docker Network
      │
      ├── Frontend
      ├── Backend
      └── PostgreSQL
```

外部電腦不能直接連 PostgreSQL。

---

# 17. Playwright E2E

使用 Playwright。

測試：

```text
Login
 ↓
Product A
 ↓
Create Work Order
 ↓
Material Before / After
 ↓
Product Before / After
 ↓
Mold Before / After
```

確認：

```text
Material Stock 減少
Product Stock 增加
Mold Idle → In_Use
```

執行：

```text
headless: true
```

---

# 18. E2E 失敗除錯

測試失敗時自動保存：

```text
Screenshot
HTML Snapshot
Console Log
API Log
Playwright Trace
```

例如：

```text
test-results/
└── work-order/
    └── timestamp/
        ├── screenshot.png
        ├── page.html
        ├── console.log
        ├── api.log
        └── trace.zip
```

---

# 19. 三產線高並發

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

同時爭奪：

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

結果：

```text
1 SUCCESS
2 REJECT
```

失敗 Worker 必須完整 Rollback。

---

# 20. Race Condition 驗證

至少執行：

```text
5 rounds
```

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
Mold Y
不得同時被多張成功工單使用
```

```text
Product Stock
只增加成功工單對應數量
```

```text
Failed Transaction
不得留下異動
```

---

# 21. 開發階段

目前開發順序：

```text
#0  Master BOM 結構修正
 ↓
#1  PostgreSQL Schema / Migration
 ↓
#2  Node.js / Express Backend API
 ↓
#20 Environment Variables
 ↓
#16 Transaction + Pessimistic Lock
 ↓
#17 Optimistic Lock
 ↓
#18 Lock / Transaction Test
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

---

# 22. Issue 清單

| Issue | 內容                            | 狀態  |
| ----- | ----------------------------- | --- |
| #0    | Master BOM 結構修正               | 待完成 |
| #1    | PostgreSQL Schema / Migration | 待完成 |
| #2    | Node.js / Express Backend API | 待完成 |
| #20   | Environment Variables         | 待完成 |
| #16   | PostgreSQL Transaction + 悲觀鎖  | 待完成 |
| #17   | PostgreSQL 樂觀鎖                | 待完成 |
| #18   | Lock / Transaction Test       | 待完成 |
| #19   | Docker Compose                | 待完成 |
| #21   | PostgreSQL Network Isolation  | 待完成 |
| #22   | Playwright E2E                | 待完成 |
| #23   | E2E Failure Debug             | 待完成 |
| #24   | 三產線 Race Condition            | 待完成 |

---

# 23. 測試架構

## Unit Test

測試：

* BOM 計算
* Material Requirement
* Stock Validation
* Version Conflict
* Work Order Validation

## Integration Test

測試：

* PostgreSQL
* Transaction
* Rollback
* Pessimistic Lock
* Optimistic Lock
* Database Constraint

## E2E

使用：

```text
Playwright
```

測試：

* Login
* Product
* Work Order
* Material
* Product Stock
* Mold

## Concurrent Test

使用：

```text
Worker A
Worker B
Worker C
```

測試：

* Material Race Condition
* Mold Race Condition
* Transaction Isolation
* Rollback
* Multiple Production Lines

---

# 24. 開發規範

詳細開發規範請參考：

```text
CLAUDE.md
```

主要規範：

* Git Branch
* 工作區安全
* Backend
* PostgreSQL
* Transaction
* Pessimistic Lock
* Optimistic Lock
* Docker
* E2E
* Concurrent Test
* Git Commit

---

# 25. 最終驗收 Checklist

## Frontend

* [ ] BOM 使用 `bomTable`
* [ ] 不再依賴 `product.bom`
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

* [ ] Database Schema
* [ ] Migration
* [ ] Foreign Key
* [ ] Constraints
* [ ] Transaction
* [ ] Rollback
* [ ] Pessimistic Lock
* [ ] Optimistic Lock

## Security

* [ ] `.env`
* [ ] `.env.example`
* [ ] `.gitignore`
* [ ] JWT Secret 使用環境變數
* [ ] Database Password 使用環境變數
* [ ] `.env` 沒有進 Git

## Docker

* [ ] Frontend Container
* [ ] Backend Container
* [ ] PostgreSQL Container
* [ ] Docker Network
* [ ] PostgreSQL 沒有對外暴露 Port

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
* [ ] Playwright Trace

## Concurrent

* [ ] 3 Worker
* [ ] 同時發送 Request
* [ ] 1 Worker 成功
* [ ] 2 Worker 拒絕
* [ ] Material 不會變負數
* [ ] Mold 不會被同時使用
* [ ] Product Stock 正確
* [ ] Failed Transaction 完整 Rollback
* [ ] 5 rounds 穩定通過

---

# 26. 最終目標

完成後的系統：

```text
                         ┌─────────────────┐
                         │   Playwright    │
                         │      E2E        │
                         └────────┬────────┘
                                  │
                                  ▼
┌────────────────┐       ┌─────────────────┐
│    Frontend    │──────►│ Node.js/Express │
└────────────────┘       └────────┬────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │   PostgreSQL    │
                         │                 │
                         │ Transaction     │
                         │ Rollback        │
                         │ Pessimistic Lock│
                         │ Optimistic Lock │
                         └────────┬────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                Worker A       Worker B      Worker C
```

最終驗收必須證明：

```text
Material 不會變負數
+
Mold 不會被同時使用
+
失敗工單完整 Rollback
+
Optimistic Lock 可以偵測版本衝突
+
多產線並發時資料保持一致
+
PostgreSQL 不直接暴露給外部
+
Secret 不進入 Git
+
E2E 可以驗證完整生產流程
```
