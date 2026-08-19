"""
模擬「一般使用者」發起生產並驗證庫存/模具變化

建立工單時實際會發生的事：
- 材料庫存立刻減少
- 模具變成 In_Use
- 產品庫存不會增加（要等 complete 才會增加）
"""

import requests
import time
import sys

# ------------------------------------------------------------
# 基本設定
# ------------------------------------------------------------
BASE_URL = "http://localhost:3001"

LOGIN_ENDPOINT = f"{BASE_URL}/api/auth/login"
WORK_ORDER_ENDPOINT = f"{BASE_URL}/api/work-orders"
MATERIALS_ENDPOINT = f"{BASE_URL}/api/materials"
PRODUCTS_ENDPOINT = f"{BASE_URL}/api/products"
MOLDS_ENDPOINT = f"{BASE_URL}/api/molds"

LOGIN_PAYLOAD = {
    "user_id": "OPERATOR-TEST"
}

# 已確認可用的真實資料
PRODUCT_ID = "PRD-PLASTIC-TUBE"
MOLD_ID = "MOLD-TUBE"
MATERIAL_ID = "MAT-PLASTIC" 
LINE = "L1"
QUANTITY = 100


# ------------------------------------------------------------
# 工具函式
# ------------------------------------------------------------
def login(session: requests.Session) -> bool:
    resp = session.post(LOGIN_ENDPOINT, json=LOGIN_PAYLOAD, timeout=10)
    print(f"[登入] HTTP {resp.status_code}")

    if resp.status_code != 200:
        print(f"登入失敗：{resp.text}")
        return False

    data = resp.json()
    token = data.get("token")
    if not token:
        print("登入成功但沒有收到 token")
        return False

    session.headers.update({"Authorization": f"Bearer {token}"})
    print(f"登入成功，使用者：{data.get('user')}")
    return True


def get_stock(session: requests.Session, endpoint: str, item_id: str):
    resp = session.get(f"{endpoint}/{item_id}", timeout=10)
    if resp.status_code != 200:
        print(f"查詢失敗 {endpoint}/{item_id}：HTTP {resp.status_code} - {resp.text}")
        return None
    return resp.json().get("stock")


def get_mold_status(session: requests.Session, mold_id: str):
    resp = session.get(f"{MOLDS_ENDPOINT}/{mold_id}", timeout=10)
    if resp.status_code != 200:
        print(f"查詢模具失敗：HTTP {resp.status_code} - {resp.text}")
        return None
    return resp.json().get("status")


def create_work_order(session: requests.Session):
    payload = {
        "product_id": PRODUCT_ID,
        "quantity": QUANTITY,
        "line": LINE,
        "mold_id": MOLD_ID,
        "creator_user_id": "OPERATOR-TEST",
        "creator_name": "Operator Test",
    }

    start = time.time()
    resp = session.post(WORK_ORDER_ENDPOINT, json=payload, timeout=30)
    elapsed = round(time.time() - start, 3)

    try:
        data = resp.json()
    except Exception:
        data = resp.text

    print(f"[發起生產] HTTP {resp.status_code} | {elapsed} 秒")
    print(f"回應內容：{data}")
    return resp.status_code, data


# ------------------------------------------------------------
# 主流程
# ------------------------------------------------------------
def main():
    print("=" * 70)
    print("模擬一般使用者：發起生產並驗證庫存/模具狀態變化")
    print("=" * 70)

    session = requests.Session()

    if not login(session):
        sys.exit(1)

    print("\n--- 生產前狀態 ---")
    material_before = get_stock(session, MATERIALS_ENDPOINT, MATERIAL_ID)
    product_before = get_stock(session, PRODUCTS_ENDPOINT, PRODUCT_ID)
    mold_before = get_mold_status(session, MOLD_ID)

    print(f"材料 [{MATERIAL_ID}] stock：{material_before}")
    print(f"產品 [{PRODUCT_ID}] stock：{product_before}")
    print(f"模具 [{MOLD_ID}] status：{mold_before}")

    print("\n--- 發起生產工單 ---")
    status_code, result = create_work_order(session)

    if not (200 <= status_code < 300):
        print("\n發起生產失敗，中止後續驗證。")
        sys.exit(1)

    time.sleep(0.5)

    print("\n--- 生產後狀態 ---")
    material_after = get_stock(session, MATERIALS_ENDPOINT, MATERIAL_ID)
    product_after = get_stock(session, PRODUCTS_ENDPOINT, PRODUCT_ID)
    mold_after = get_mold_status(session, MOLD_ID)

    print(f"材料 [{MATERIAL_ID}] stock：{material_after}")
    print(f"產品 [{PRODUCT_ID}] stock：{product_after}")
    print(f"模具 [{MOLD_ID}] status：{mold_after}")

    print("\n" + "=" * 70)
    print("驗證結果")
    print("=" * 70)

    all_pass = True

    if material_before is not None and material_after is not None:
        if material_after < material_before:
            print(f"✅ 材料減少：{material_before} → {material_after}")
        else:
            print(f"❌ 材料未減少：{material_before} → {material_after}")
            all_pass = False
    else:
        print("⚠️ 無法取得材料數量")
        all_pass = False

    if product_before is not None and product_after is not None:
        if product_after == product_before:
            print(f"✅ 產品庫存正確不變：{product_before} → {product_after}")
        else:
            print(f"❌ 產品庫存異常變動：{product_before} → {product_after}")
            all_pass = False
    else:
        print("⚠️ 無法取得產品數量")
        all_pass = False

    if mold_after == "In_Use":
        print(f"✅ 模具狀態正確：{mold_before} → {mold_after}")
    else:
        print(f"❌ 模具狀態異常：{mold_before} → {mold_after}（預期 In_Use）")
        all_pass = False

    print("=" * 70)
    print("整體結果：" + ("✅ 全部通過" if all_pass else "❌ 有項目未通過"))
    print("=" * 70)


if __name__ == "__main__":
    main()