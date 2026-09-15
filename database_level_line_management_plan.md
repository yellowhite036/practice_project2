# 實作計畫：資料庫級別的產線與模具管理

## 目標

將目前以文字字串管理的產線，升級為資料庫中的正式實體，並建立產線能力、模具資源與品項對應關係。

完成後，系統將具備以下能力：

- 從資料庫自訂產線數量，例如 L1～L10。
- 新增產線後，自動納入排程系統。
- 每條產線可以設定不同品項的生產速率。
- 管理模具，支援多條產線共用同一套模具。
- 保留產線與模具的歷史使用紀錄。
- 排程系統只使用目前啟用且具備必要能力的產線。
- 資料庫遷移可以在新環境自動執行，不依賴人工補 SQL。

---

# 一、資料庫設計

## 1. 建立產線資料表 `production_lines`

產線從原本的文字設定，轉為資料庫中的獨立實體。

```sql
CREATE TABLE production_lines (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 欄位說明

| 欄位 | 用途 |
|---|---|
| `id` | 產線唯一識別碼 |
| `name` | 產線名稱，例如 L1、L2、L3 |
| `is_active` | 是否啟用 |
| `created_at` | 建立時間 |
| `updated_at` | 更新時間 |

### 預設資料

遷移時建立預設產線：

- L1
- L2
- L3

遷移時使用 `INSERT ... ON CONFLICT DO NOTHING`，避免重複建立或覆蓋現有資料。

---

## 2. 建立品項與產線能力對應表 `line_item_rates`

這張表是自動排程的核心。

單純知道「有 L4」不足以進行排程，系統還需要知道：

> L4 生產某個品項時，每小時可以生產多少數量。

```sql
CREATE TABLE line_item_rates (
    line_id INTEGER NOT NULL REFERENCES production_lines(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    units_per_hour NUMERIC(12, 3) NOT NULL CHECK (units_per_hour > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (line_id, item_id)
);
```

### 設計重點

- 一條產線可以生產多個品項。
- 同一個品項可以由多條產線生產。
- 同一條產線對不同品項可以有不同速率。
- `units_per_hour` 必須大於 0。
- 使用複合主鍵，避免同一產線與品項重複設定。

### 範例

| 產線 | 品項 | 生產速率 |
|---|---|---:|
| L1 | A 品項 | 100 / 小時 |
| L1 | B 品項 | 80 / 小時 |
| L2 | A 品項 | 120 / 小時 |
| L4 | C 品項 | 60 / 小時 |

### 重要行為

新增 L4 時：

1. 建立 L4 產線。
2. 由管理者設定 L4 可以生產哪些品項。
3. 設定各品項的生產速率。
4. 排程系統才會將 L4 視為可用產線。

**新增產線不代表自動具備所有品項的生產能力。**

---

## 3. 建立模具資料表 `molds`

模具需要成為獨立的資料庫實體，方便追蹤、共用與管理。

```sql
CREATE TABLE molds (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    code VARCHAR(100) UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 欄位說明

| 欄位 | 用途 |
|---|---|
| `id` | 模具唯一識別碼 |
| `name` | 模具名稱 |
| `code` | 模具編號，可供現場管理使用 |
| `is_active` | 是否啟用 |
| `created_at` | 建立時間 |
| `updated_at` | 更新時間 |

---

## 4. 建立品項與模具對應表 `item_mold_options`

這張表描述：

> 某個品項可以使用哪些模具生產。

```sql
CREATE TABLE item_mold_options (
    item_id INTEGER NOT NULL REFERENCES items(id),
    mold_id INTEGER NOT NULL REFERENCES molds(id),
    is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (item_id, mold_id)
);
```

### 設計重點

- 一個品項可以對應多個模具。
- 一個模具可以被多個品項使用。
- 可以設定預設或優先模具。
- 支援未來增加替代模具。

### 範例

| 品項 | 可用模具 | 優先模具 |
|---|---|---|
| A 品項 | M1、M2 | M1 |
| B 品項 | M2 | M2 |
| C 品項 | M1、M3 | M3 |

這樣可以表達：

> L1、L2、L3 共用 M1 模具，M1 可以生產 A 品項與 C 品項。

---

## 5. 確認現有工單與排程紀錄的關聯

在正式建立外鍵前，需要確認現有資料表名稱與欄位。

預計檢查：

- `work_orders`
- `production_orders`
- `schedule_records`
- 現有模具欄位
- 現有產線欄位
- 品項資料表實際名稱與主鍵

### 預計關聯方式

若現有工單有產線欄位：

```sql
ALTER TABLE work_orders
ADD COLUMN line_id INTEGER REFERENCES production_lines(id);
```

若現有工單有模具欄位：

```sql
ALTER TABLE work_orders
ADD COLUMN mold_id INTEGER REFERENCES molds(id);
```

實際執行前需要依現有 schema 判斷：

- 欄位是否已存在。
- 是否需要資料轉換。
- 舊的文字欄位是否需要保留。
- 歷史資料是否能正確對應到新的 ID。

**不直接假設現有資料表名稱或欄位結構。**

---

# 二、資料庫遷移計畫

## 1. 新增遷移檔

預計建立：

```text
003_create_production_management.sql
```

內容包含：

1. `production_lines`
2. `line_item_rates`
3. `molds`
4. `item_mold_options`
5. 必要的工單關聯欄位
6. 索引
7. 預設產線資料

### 建議索引

```sql
CREATE INDEX idx_production_lines_active
ON production_lines(is_active);

CREATE INDEX idx_line_item_rates_item
ON line_item_rates(item_id);

CREATE INDEX idx_item_mold_options_mold
ON item_mold_options(mold_id);
```

---

## 2. 遷移必須具備冪等性

遷移腳本需要能安全地重複執行，避免因為：

- 容器重建
- 部署中斷
- 開發環境重跑
- CI/CD 重複執行

而造成資料表或預設資料重複。

預計使用：

- `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- `INSERT ... ON CONFLICT DO NOTHING`

實際遷移工具若已具備版本追蹤，則依現有機制整合，不重複建立另一套遷移系統。

---

## 3. 現有 PostgreSQL 容器的處理方式

本次不以「只手動執行 SQL」作為正式方案。

執行順序：

1. 將遷移檔加入專案。
2. 確認專案目前的 migration 機制。
3. 將 `003_create_production_management.sql` 納入正式遷移流程。
4. 對現有 PostgreSQL 容器執行一次遷移。
5. 驗證資料表、預設產線與既有資料。
6. 確認新環境重新建立時也能自動建立相同 schema。

### 需要特別確認

若目前使用 `docker-entrypoint-initdb.d`：

- 該機制通常只會在資料目錄第一次初始化時執行。
- 已存在的 PostgreSQL volume 不會因為新增 SQL 檔就自動執行。

因此現有容器仍需要執行一次正式 migration，或透過既有部署腳本執行。

**不使用 `docker-compose down -v` 作為一般遷移方式，避免刪除現有資料。**

---

# 三、後端 API 實作

## 1. 新增產線路由

新增：

```text
server/src/routes/lines.js
```

預計提供以下 API。

### `GET /lines`

取得產線清單。

預設回傳啟用中的產線，並依需求提供管理頁面查看停用產線的能力。

回傳資料預計包含：

```json
[
  {
    "id": 1,
    "name": "L1",
    "is_active": true
  }
]
```

---

### `POST /lines`

新增產線。

請求資料：

```json
{
  "name": "L4"
}
```

驗證內容：

- 名稱不可為空。
- 名稱不可重複。
- 名稱長度符合限制。
- 清除不必要的前後空白。
- 防止 SQL Injection。

新增成功後回傳建立的產線資料。

---

### `PATCH /lines/:id`

更新產線。

用途：

- 修改產線名稱。
- 啟用產線。
- 停用產線。

請求範例：

```json
{
  "is_active": false
}
```

這個端點讓管理功能更完整，也能避免為了停用產線而使用硬刪除。

---

### `DELETE /lines/:id`

建議保留此端點作為管理操作，但實際行為採用**軟刪除**。

執行內容：

```sql
UPDATE production_lines
SET is_active = FALSE,
    updated_at = NOW()
WHERE id = $1;
```

### 刪除行為規則

- 不直接刪除資料庫中的產線。
- 保留歷史工單與排程紀錄的關聯。
- 停用後不再列入新的自動排程。
- 若產線已被歷史資料使用，仍可安全停用。
- 若產線已停用，再次刪除應回傳適當狀態。

API 名稱可以維持 `DELETE`，前端使用者看到的是「刪除」或「停用」皆可，內部採軟刪除。

---

## 2. 新增產線能力 API

建議不要只建立產線 API，還需要讓管理者設定品項速率。

預計新增：

```text
server/src/routes/line-rates.js
```

### `GET /lines/:lineId/rates`

取得指定產線的品項能力與速率。

### `PUT /lines/:lineId/rates/:itemId`

設定或更新指定產線對指定品項的生產速率。

請求範例：

```json
{
  "units_per_hour": 100
}
```

### `DELETE /lines/:lineId/rates/:itemId`

移除該產線對指定品項的生產能力。

執行後，排程系統不再將該產線用於該品項。

---

## 3. 新增模具 API

預計新增：

```text
server/src/routes/molds.js
```

### `GET /molds`

取得模具清單。

### `POST /molds`

新增模具。

### `PATCH /molds/:id`

更新模具資料或啟用狀態。

### `DELETE /molds/:id`

採軟刪除，將 `is_active` 設為 `false`。

---

## 4. 新增品項與模具對應 API

預計新增：

```text
server/src/routes/item-molds.js
```

### `GET /items/:itemId/molds`

取得品項可用模具。

### `PUT /items/:itemId/molds`

更新品項的模具選項。

請求概念：

```json
{
  "mold_ids": [1, 2],
  "preferred_mold_id": 1
}
```

後端需要驗證：

- 模具是否存在。
- 模具是否啟用。
- `preferred_mold_id` 是否包含在 `mold_ids` 中。

---

# 四、全域狀態與前端整合

## 1. 更新 `fetchBackendState()`

目前前端可能以文字或固定陣列管理產線。

預計修改：

```text
app.js
```

啟動時向後端取得：

- `state.lines`
- 產線能力資料
- 模具資料
- 品項模具對應資料

概念結構：

```text
state
├── lines
├── lineItemRates
├── molds
└── itemMoldOptions
```

實際結構依現有 `state` 設計整合，不任意破壞既有狀態欄位。

---

## 2. 移除畫面上的產線配置文字輸入框

自動排程頁面不再讓使用者輸入：

```text
L1,L2,L3,L4
```

或類似的產線配置字串。

產線來源統一改為：

```text
資料庫 → Backend API → state.lines → 排程引擎
```

這樣可以確保：

- 所有使用者看到相同的產線設定。
- 產線數量由資料庫控制。
- 不需要每台瀏覽器個別設定。
- 新增產線後不必修改前端程式碼。

---

# 五、前端管理介面

## 1. 頁籤名稱

將目前的「模具排程」擴展為：

> 產線與模具管理

---

## 2. 產線管理區塊

顯示資料庫中的產線清單。

### 顯示欄位

| 欄位 | 說明 |
|---|---|
| 產線名稱 | L1、L2、L3 |
| 狀態 | 啟用／停用 |
| 生產能力 | 已設定的品項數量 |
| 建立時間 | 產線建立時間 |
| 操作 | 編輯、設定能力、停用 |

### 操作功能

- 新增產線
- 修改產線名稱
- 停用產線
- 重新啟用產線
- 設定產線品項能力
- 設定每小時生產速率

---

## 3. 新增產線流程

使用者輸入：

```text
產線名稱：L4
```

按下「新增產線」後：

1. 前端呼叫 `POST /lines`。
2. 後端驗證名稱。
3. 寫入 `production_lines`。
4. 回傳新產線。
5. 更新前端 `state.lines`。
6. 管理畫面立即顯示 L4。

---

## 4. 產線能力設定介面

每條產線提供「設定生產能力」功能。

介面概念：

| 品項 | 生產速率 | 是否啟用 |
|---|---:|---|
| A 品項 | 100 / 小時 | 啟用 |
| B 品項 | 80 / 小時 | 啟用 |
| C 品項 | — | 未設定 |

使用者可以：

- 新增品項能力。
- 修改生產速率。
- 移除品項能力。
- 查看目前可生產品項。

### 防呆

- 生產速率必須大於 0。
- 未設定速率的品項不能被該產線排程。
- 不允許儲存無效數值。
- API 錯誤需要在 UI 顯示。

---

## 5. 模具管理區塊

管理頁面新增模具管理功能。

### 功能

- 新增模具。
- 修改模具名稱與編號。
- 停用模具。
- 查看模具可支援的品項。
- 設定品項可用模具。
- 設定優先模具。

### 共用模具情境

```text
M1 模具
├── L1 使用
├── L2 使用
└── L3 使用
```

模具本身不綁死單一產線，透過品項、產線與排程關係決定實際使用方式。

---

# 六、自動排程系統更新

## 1. 產線來源改為資料庫

修改：

```text
analyzeAutoOrders
```

排程可用產線來源改為：

```text
state.lines
```

實際計算時只選取：

- `is_active = true`
- 有設定該品項生產速率
- 生產速率大於 0
- 符合其他排程條件

---

## 2. 排程能力判斷

排程時需要依照品項取得產線能力。

```text
品項 A
├── L1：100 / 小時
├── L2：120 / 小時
└── L4：未設定，不可排程
```

排程引擎不應只判斷產線存在，還需要判斷：

> 該產線是否具備生產這個品項的能力。

---

## 3. 模具資源判斷

若排程涉及模具，則排程引擎需要進一步確認：

1. 該品項有哪些可用模具。
2. 該產線是否能使用該模具。
3. 模具是否已被其他排程占用。
4. 同一時段是否發生模具衝突。
5. 是否需要等待模具釋放。

### 排程概念

```text
訂單
  ↓
品項
  ↓
可生產產線
  ↓
可用模具
  ↓
產線速率
  ↓
模具與產線衝突檢查
  ↓
產生排程
```

---

## 4. 新增產線後的行為

例如資料庫新增 L4：

```text
production_lines
L1
L2
L3
L4
```

並設定：

```text
L4 → A 品項 → 100 / 小時
```

下次執行自動下單時：

- L4 自動出現在排程候選池。
- 系統依照排程條件評估 L4。
- 不需要修改 `app.js` 中的產線字串。
- 不需要重新部署前端才能增加產線。

---

# 七、軟刪除與歷史資料策略

## 1. 產線採軟刪除

不直接刪除：

```sql
DELETE FROM production_lines;
```

改為：

```sql
UPDATE production_lines
SET is_active = FALSE
WHERE id = $1;
```

## 2. 模具採軟刪除

模具也採相同策略：

```sql
UPDATE molds
SET is_active = FALSE
WHERE id = $1;
```

## 3. 歷史資料保留

歷史工單應保留：

- `line_id`
- `mold_id`
- 當時的產線名稱快照或可追溯關聯
- 當時使用的生產速率（若報表需要）

### 建議

若歷史報表必須呈現「當時的產線名稱」，可以考慮在工單中保存：

```text
line_id
line_name_snapshot
```

模具同理：

```text
mold_id
mold_name_snapshot
```

這能避免未來改名後，歷史報表顯示內容產生歧義。

---

# 八、並行安全與資料一致性

## 1. 排程執行時固定候選產線

`analyzeAutoOrders` 開始執行時，先取得該次排程所需的產線與能力資料。

概念：

```text
開始排程
  ↓
讀取啟用產線與能力
  ↓
建立本次排程候選池
  ↓
執行排程計算
  ↓
產生結果
```

排程過程中不應反覆依賴前端畫面上的可變文字設定。

---

## 2. 刪除產線時的處理

當使用者停用產線：

- 資料庫立即更新 `is_active = false`。
- 新的排程不再使用該產線。
- 已存在的歷史工單不受影響。
- 正在執行的排程應使用開始時取得的候選池。

---

## 3. 模具衝突需要交易或鎖定策略

如果排程會實際寫入模具占用紀錄，建議使用 PostgreSQL transaction，必要時搭配：

- `SELECT ... FOR UPDATE`
- 唯一約束
- 排程版本號
- 衝突重試機制

避免兩個使用者同時排程時，將同一模具分配給互相衝突的工單。

**第一階段可以先完成資料模型與排程讀取，模具占用的交易鎖定依現有排程寫入流程實作。**

---

# 九、驗證計畫

## 1. 資料庫驗證

- [ ] `production_lines` 建立成功。
- [ ] `line_item_rates` 建立成功。
- [ ] `molds` 建立成功。
- [ ] `item_mold_options` 建立成功。
- [ ] L1～L3 預設資料存在。
- [ ] 重複執行遷移不會產生重複資料。
- [ ] 外鍵約束正常。
- [ ] 生產速率不可設定為 0 或負數。
- [ ] 停用產線後資料仍保留。

---

## 2. API 驗證

### 產線

- [ ] `GET /lines` 可以取得產線。
- [ ] `POST /lines` 可以新增 L4。
- [ ] 重複新增 L4 會回傳錯誤。
- [ ] `PATCH /lines/:id` 可以停用與重新啟用。
- [ ] `DELETE /lines/:id` 執行軟刪除。
- [ ] 停用產線仍可查詢歷史關聯。

### 產線能力

- [ ] 可以設定 L4 的品項速率。
- [ ] 可以修改速率。
- [ ] 可以刪除品項能力。
- [ ] 無能力設定的品項不會被排程。

### 模具

- [ ] 可以新增模具。
- [ ] 可以停用模具。
- [ ] 可以設定品項可用模具。
- [ ] 可以設定優先模具。
- [ ] 重複建立相同對應不會產生重複資料。

---

## 3. 前端驗證

- [ ] 頁籤名稱更新為「產線與模具管理」。
- [ ] 可以從 UI 新增產線。
- [ ] 新增後重新整理頁面仍存在。
- [ ] 可以停用產線。
- [ ] 停用後產線不出現在新的排程候選池。
- [ ] 可以設定產線生產速率。
- [ ] 可以管理模具。
- [ ] 可以設定品項與模具的對應關係。
- [ ] 移除舊的產線配置文字輸入框。

---

## 4. 自動排程驗證

### 測試案例 A：新增產線

```text
資料庫產線：L1、L2、L3、L4
L4 → A 品項 → 100 / 小時
```

執行自動下單，確認 L4 可以被納入排程。

### 測試案例 B：停用產線

```text
L4 → is_active = false
```

執行自動下單，確認 L4 不再被分配新訂單。

### 測試案例 C：無生產能力

```text
L4 → 未設定 A 品項速率
```

執行 A 品項排程，確認 L4 不會被選用。

### 測試案例 D：不同產線速率

```text
L1 → A → 100 / 小時
L2 → A → 200 / 小時
```

確認排程計算使用各自的速率，而不是所有產線共用同一個固定值。

### 測試案例 E：模具共用

```text
M1 → A 品項
L1、L2 → 均可生產 A 品項
```

確認排程能正確讀取品項可用模具，並依現有規則處理模具衝突。

---

# 十、實作順序

## 第 1 階段：盤點現有資料庫與排程結構

確認：

- `items` 的實際資料表名稱與主鍵。
- 工單與排程資料表結構。
- 現有產線與模具欄位。
- 現有 migration 機制。
- 目前 `state` 的資料結構。
- `analyzeAutoOrders` 的產線與速率來源。

避免外鍵、欄位名稱與既有資料結構衝突。

## 第 2 階段：建立資料庫遷移

一次建立：

- 產線資料表。
- 產線能力資料表。
- 模具資料表。
- 品項與模具對應表。
- 必要的工單關聯欄位。
- 索引、外鍵與預設 L1～L3。

## 第 3 階段：實作後端 API

完成：

- 產線 CRUD。
- 產線軟刪除與重新啟用。
- 產線能力管理。
- 模具管理。
- 品項與模具對應管理。

## 第 4 階段：整合前端狀態

修改 `fetchBackendState()`，讓產線、能力與模具資料由資料庫統一提供。

## 第 5 階段：完成管理 UI

將頁籤改為「產線與模具管理」，加入：

- 產線新增。
- 產線停用與啟用。
- 產線能力設定。
- 模具管理。
- 品項模具對應設定。

## 第 6 階段：修改自動排程

移除產線文字輸入，改用啟用中的資料庫產線與 `line_item_rates` 進行計算。

## 第 7 階段：執行完整驗證

測試：

- 新增 L4。
- 設定 L4 生產能力。
- 停用與重新啟用產線。
- 模具共用。
- 歷史資料保留。
- 容器重建後的遷移流程。
- 並行排程與模具衝突。

---

# 十一、最終範圍確認

| 模組 | 本次是否納入 |
|---|---|
| 資料庫產線實體 | 納入 |
| 產線自訂數量 | 納入 |
| 產線軟刪除 | 納入 |
| 產線品項生產速率 | 納入 |
| 產線能力管理 UI | 納入 |
| 模具資料表 | 納入 |
| 品項與模具對應 | 納入 |
| 模具管理 UI | 納入 |
| 自動排程讀取資料庫產線 | 納入 |
| 自動排程讀取產線能力 | 納入 |
| 模具衝突與占用交易鎖定 | 依現有排程寫入機制實作 |
| 歷史工單資料轉換 | 先盤點 schema，再執行必要轉換 |
| 手動 SQL 作為唯一遷移方式 | 不採用 |

---

## 結論

這份計畫可作為 Proceed 前的正式實作規格。

核心已經從「新增產線清單」提升為：

- 產線實體
- 產線生產能力
- 模具實體
- 品項與模具對應
- 軟刪除
- 歷史資料一致性
- 自動排程資料庫整合

後續新增 L4、L5 或更多產線時，只需要透過資料庫與管理介面設定，不需要再修改程式中的產線數量。
