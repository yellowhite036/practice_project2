import concurrent.futures
import requests
import time


# ============================================================
# 測試設定
# ============================================================

BASE_URL = "http://localhost:3001"

LOGIN_URL = f"{BASE_URL}/api/auth/login"
WORK_ORDER_URL = f"{BASE_URL}/api/work-orders"

USER_ID = "ADMIN-TEST"

# 同時搶奪的人數
USER_COUNT = 10000

# 目前資料庫實際存在的產品
PRODUCT_ID = "PRD-GLASS-BOTTLE"

# 目前資料庫實際存在的模具
MOLD_ID = "MOLD-BOTTLE"

# 生產線
LINE = "L1"

# 每個使用者要求生產數量
QUANTITY = 10


# ============================================================
# 登入
# ============================================================

def login():
    response = requests.post(
        LOGIN_URL,
        json={
            "user_id": USER_ID
        },
        timeout=10
    )

    if response.status_code != 200:
        raise RuntimeError(
            f"登入失敗 HTTP {response.status_code}: {response.text}"
        )

    data = response.json()

    token = data.get("token")

    if not token:
        raise RuntimeError("登入成功，但沒有取得 JWT Token")

    return token


# ============================================================
# 建立工單
# ============================================================

def create_work_order(token, user_index):

    payload = {
        "product_id": PRODUCT_ID,
        "quantity": QUANTITY,
        "line": LINE,
        "mold_id": MOLD_ID,
        "creator_user_id": USER_ID,
        "creator_name": f"Race User {user_index:02d}"
    }

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    start_time = time.perf_counter()

    try:

        response = requests.post(
            WORK_ORDER_URL,
            json=payload,
            headers=headers,
            timeout=30
        )

        elapsed = time.perf_counter() - start_time

        try:
            result = response.json()
        except Exception:
            result = response.text

        return {
            "user": user_index,
            "status": response.status_code,
            "elapsed": round(elapsed, 4),
            "result": result
        }

    except Exception as error:

        elapsed = time.perf_counter() - start_time

        return {
            "user": user_index,
            "status": "ERROR",
            "elapsed": round(elapsed, 4),
            "result": str(error)
        }


# ============================================================
# 主測試
# ============================================================

def main():

    print()
    print("=" * 70)
    print("多人同時搶奪工單測試")
    print("=" * 70)

    print(f"模擬使用者數量：{USER_COUNT}")
    print(f"產品：{PRODUCT_ID}")
    print(f"數量：{QUANTITY}")
    print(f"產線：{LINE}")
    print(f"模具：{MOLD_ID}")

    print()
    print("=" * 70)

    # --------------------------------------------------------
    # Step 1：登入
    # --------------------------------------------------------

    print("Step 1：登入系統")

    try:
        token = login()
        print("登入成功")
        print("JWT Token 已取得")

    except Exception as error:
        print()
        print("登入失敗")
        print(error)
        return

    print()

    # --------------------------------------------------------
    # Step 2：建立並發任務
    # --------------------------------------------------------

    print("Step 2：開始多人同時搶奪")
    print()

    start_time = time.perf_counter()

    results = []

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=USER_COUNT
    ) as executor:

        futures = []

        for user_index in range(1, USER_COUNT + 1):

            future = executor.submit(
                create_work_order,
                token,
                user_index
            )

            futures.append(future)

        for future in futures:

            result = future.result()

            results.append(result)

    total_time = time.perf_counter() - start_time

    # --------------------------------------------------------
    # Step 3：輸出結果
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("測試結果")
    print("=" * 70)

    success_count = 0
    failed_count = 0

    for result in sorted(results, key=lambda x: x["user"]):

        print(
            f"User {result['user']:02d} | "
            f"HTTP {result['status']} | "
            f"{result['elapsed']:.4f} sec | "
            f"{result['result']}"
        )

        if (
            isinstance(result["status"], int)
            and 200 <= result["status"] < 300
        ):
            success_count += 1
        else:
            failed_count += 1

    # --------------------------------------------------------
    # Step 4：測試摘要
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("測試摘要")
    print("=" * 70)

    print(f"成功：{success_count}")
    print(f"失敗：{failed_count}")
    print(f"總請求數：{USER_COUNT}")
    print(f"總耗時：{total_time:.4f} 秒")

    print()
    print("=" * 70)

    # --------------------------------------------------------
    # Step 5：Race Condition 判定
    # --------------------------------------------------------

    print("Race Condition 判定")
    print("=" * 70)

    if success_count == 1:

        print("PASS")
        print("只有 1 個使用者成功取得模具。")
        print("其餘請求被 Transaction / Lock 正確阻擋。")

    elif success_count == 0:

        print("WARNING")
        print("沒有任何使用者成功建立工單。")
        print("請檢查產品、模具、庫存或 API 請求格式。")

    elif success_count > 1:

        print("FAIL")
        print("偵測到多個使用者同時成功建立工單。")
        print("可能存在 Race Condition。")

    print("=" * 70)


if __name__ == "__main__":
    main()