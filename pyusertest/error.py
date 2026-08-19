import asyncio
import json
import os
import time
from datetime import datetime

from playwright.async_api import async_playwright


BASE_URL = "http://localhost:8080"
API_URL = "http://localhost:3001"

USER_ID = "ADMIN-TEST"

PRODUCT_ID = "PRD-GLASS-BOTTLE"
PRODUCT_NAME = "玻璃水壺"

QUANTITY = 10
LINE = "L1"
MOLD_ID = "MOLD-BOTTLE"

MATERIAL_REQUIREMENTS = {
    "MAT-GLASS": 1.5,
}

DEBUG_DIR = "debug"


def timestamp():
    return datetime.now().strftime("%Y%m%d_%H%M%S_%f")


def ensure_debug_dir():
    os.makedirs(DEBUG_DIR, exist_ok=True)


async def save_debug(page, reason):
    ensure_debug_dir()

    ts = timestamp()

    screenshot_path = os.path.join(
        DEBUG_DIR,
        f"error_{ts}.png"
    )

    html_path = os.path.join(
        DEBUG_DIR,
        f"error_{ts}.html"
    )

    info_path = os.path.join(
        DEBUG_DIR,
        f"error_{ts}.txt"
    )

    print()
    print("=" * 70)
    print("發生驗證異常")
    print(reason)
    print("=" * 70)

    try:
        await page.screenshot(
            path=screenshot_path,
            full_page=True
        )

        html = await page.content()

        with open(
            html_path,
            "w",
            encoding="utf-8"
        ) as f:
            f.write(html)

        body_text = ""

        try:
            body_text = await page.locator("body").inner_text()
        except Exception:
            pass

        with open(
            info_path,
            "w",
            encoding="utf-8"
        ) as f:
            f.write(
                f"URL: {page.url}\n"
                f"TITLE: {await page.title()}\n"
                f"\n"
                f"REASON:\n{reason}\n"
                f"\n"
                f"BODY TEXT:\n{body_text}\n"
            )

        print(f"目前 URL：{page.url}")
        print(f"HTML 快照：{html_path}")
        print(f"截圖：{screenshot_path}")
        print(f"除錯資訊：{info_path}")

    except Exception as e:
        print(f"DEBUG 輸出失敗：{e}")


async def login_with_ui(page):
    print()
    print("[2/8] 使用前端登入")

    print(f"目前 URL：{page.url}")

    # 等待登入頁出現
    await page.wait_for_load_state("networkidle")

    # 印出目前頁面資訊
    try:
        print(
            "頁面文字：",
            (await page.locator("body").inner_text())[:1000]
        )
    except Exception:
        pass

    # ---------------------------------------------------------
    # 嘗試尋找 user_id 輸入框
    # ---------------------------------------------------------

    selectors = [
        'input[name="user_id"]',
        'input[id="user_id"]',
        'input[placeholder*="user"]',
        'input[placeholder*="User"]',
        'input[placeholder*="使用者"]',
        'input[type="text"]',
    ]

    user_input = None

    for selector in selectors:
        locator = page.locator(selector)

        try:
            if await locator.count() > 0:
                if await locator.first.is_visible():
                    user_input = locator.first
                    print(
                        f"找到登入帳號欄位：{selector}"
                    )
                    break
        except Exception:
            continue

    if user_input is None:
        raise RuntimeError(
            "找不到登入 user_id 輸入框"
        )

    await user_input.fill(USER_ID)

    print(
        f"輸入使用者：{USER_ID}"
    )

    # ---------------------------------------------------------
    # 尋找登入按鈕
    # ---------------------------------------------------------

    login_selectors = [
        'button[type="submit"]',
        'button:has-text("登入")',
        'button:has-text("Login")',
        'input[type="submit"]',
    ]

    login_button = None

    for selector in login_selectors:
        locator = page.locator(selector)

        try:
            if await locator.count() > 0:
                if await locator.first.is_visible():
                    login_button = locator.first
                    print(
                        f"找到登入按鈕：{selector}"
                    )
                    break
        except Exception:
            continue

    if login_button is None:
        raise RuntimeError(
            "找不到登入按鈕"
        )

    # ---------------------------------------------------------
    # 點擊登入
    # ---------------------------------------------------------

    print("點擊登入")

    await login_button.click()

    # 等待前端完成 API Login
    await page.wait_for_timeout(1000)

    # 等待頁面更新
    try:
        await page.wait_for_load_state(
            "networkidle",
            timeout=10000
        )
    except Exception:
        pass

    print(
        f"登入後 URL：{page.url}"
    )

    # ---------------------------------------------------------
    # 確認已經不是登入畫面
    # ---------------------------------------------------------

    body_text = ""

    try:
        body_text = await page.locator(
            "body"
        ).inner_text()
    except Exception:
        pass

    print()
    print("登入後頁面：")
    print(body_text[:1500])

    login_keywords = [
        "登入",
        "Login",
        "user_id is required",
    ]

    # 如果頁面還停留在登入畫面
    if (
        any(
            keyword in body_text
            for keyword in login_keywords
        )
        and (
            "建立生產工單" not in body_text
            and "Production Order" not in body_text
        )
    ):
        raise RuntimeError(
            "前端登入沒有成功，仍停留在登入畫面"
        )

    # ---------------------------------------------------------
    # 等待 Production Order / 建立生產工單
    # ---------------------------------------------------------

    production_keywords = [
        "建立生產工單",
        "Production Order",
        "生產數量",
        "綁定模具",
    ]

    production_found = False

    for _ in range(20):

        body_text = await page.locator(
            "body"
        ).inner_text()

        if any(
            keyword in body_text
            for keyword in production_keywords
        ):
            production_found = True
            break

        await page.wait_for_timeout(500)

    if not production_found:
        raise RuntimeError(
            "登入成功後沒有進入生產工單畫面"
        )

    print()
    print("前端登入成功")
    print("已進入生產工單畫面")


async def get_state(request, token):
    response = await request.get(
        f"{API_URL}/api/state",
        headers={
            "Authorization": f"Bearer {token}"
        }
    )

    if response.status != 200:
        raise RuntimeError(
            f"取得系統狀態失敗：HTTP "
            f"{response.status}\n"
            f"{await response.text()}"
        )

    return await response.json()


def find_material(state, material_id):
    materials = state.get(
        "materials",
        []
    )

    for material in materials:
        if material.get(
            "material_id"
        ) == material_id:
            return material

    return None


def find_product(state, product_id):
    products = state.get(
        "products",
        []
    )

    for product in products:
        if product.get(
            "product_id"
        ) == product_id:
            return product

    return None


def find_mold(state, mold_id):
    molds = state.get(
        "molds",
        []
    )

    for mold in molds:
        if mold.get(
            "mold_id"
        ) == mold_id:
            return mold

    return None


async def get_token(request):
    response = await request.post(
        f"{API_URL}/api/auth/login",
        data={
            "user_id": USER_ID
        }
    )

    if response.status != 200:
        raise RuntimeError(
            f"API Login 失敗：HTTP "
            f"{response.status}\n"
            f"{await response.text()}"
        )

    data = await response.json()

    token = data.get("token")

    if not token:
        raise RuntimeError(
            "API Login 成功但沒有 JWT token"
        )

    return token


async def create_work_order(
    request,
    token
):
    payload = {
        "product_id": PRODUCT_ID,
        "quantity": QUANTITY,
        "line": LINE,
        "mold_id": MOLD_ID,
        "priority": "Normal",
    }

    print()
    print("[5/8] 建立生產工單")

    print(
        json.dumps(
            payload,
            indent=2,
            ensure_ascii=False
        )
    )

    response = await request.post(
        f"{API_URL}/api/work-orders",
        headers={
            "Authorization":
                f"Bearer {token}",
            "Content-Type":
                "application/json"
        },
        data=payload
    )

    text = await response.text()

    print(
        f"HTTP {response.status}"
    )

    if response.status not in [200, 201]:
        raise RuntimeError(
            f"建立工單失敗："
            f"HTTP {response.status}\n"
            f"{text}"
        )

    data = json.loads(text)

    work_order_id = (
        data.get("work_order_id")
        or data.get("workOrderId")
        or data.get(
            "work_order",
            {}
        ).get("work_order_id")
    )

    if not work_order_id:
        raise RuntimeError(
            "後端沒有回傳 work_order_id："
            f"{data}"
        )

    return work_order_id


async def wait_for_work_order(
    request,
    token,
    work_order_id,
    timeout=30
):
    start = time.time()

    while (
        time.time() - start
        < timeout
    ):

        state = await get_state(
            request,
            token
        )

        work_orders = state.get(
            "workOrders",
            state.get(
                "work_orders",
                []
            )
        )

        for work_order in work_orders:

            if (
                work_order.get(
                    "work_order_id"
                )
                == work_order_id
            ):

                status = work_order.get(
                    "status"
                )

                print(
                    f"工單 {work_order_id} "
                    f"狀態：{status}"
                )

                if status in [
                    "Completed",
                    "Rejected"
                ]:
                    return work_order

        await asyncio.sleep(
            0.5
        )

    raise TimeoutError(
        f"等待工單 "
        f"{work_order_id} "
        f"完成逾時"
    )


async def run_test():

    ensure_debug_dir()

    async with async_playwright() as p:

        browser = await p.chromium.launch(
            headless=True
        )

        context = await browser.new_context()

        page = await context.new_page()

        request = await p.request.new_context()

        try:

            print("=" * 70)
            print("E2E 生產工單測試")
            print("=" * 70)

            print(
                f"Frontend：{BASE_URL}"
            )

            print(
                f"Backend ：{API_URL}"
            )

            print(
                f"User    ：{USER_ID}"
            )

            print(
                f"Product ：{PRODUCT_ID}"
            )

            print(
                f"Quantity：{QUANTITY}"
            )

            print(
                f"Line    ：{LINE}"
            )

            print(
                f"Mold    ：{MOLD_ID}"
            )

            print("=" * 70)

            # -------------------------------------------------
            # 1. 開啟前端
            # -------------------------------------------------

            print()
            print("[1/8] 開啟前端")

            await page.goto(
                BASE_URL,
                wait_until="domcontentloaded",
                timeout=15000
            )

            await page.wait_for_timeout(
                1000
            )

            print(
                f"目前 URL：{page.url}"
            )

            # -------------------------------------------------
            # 2. 真正使用 UI 登入
            # -------------------------------------------------

            await login_with_ui(
                page
            )

            # -------------------------------------------------
            # 3. API 登入取得 Token
            # -------------------------------------------------

            print()
            print("[3/8] 建立 API 驗證 Session")

            token = await get_token(
                request
            )

            print(
                "JWT Token 取得成功"
            )

            # -------------------------------------------------
            # 4. 生產前狀態
            # -------------------------------------------------

            print()
            print("[4/8] 讀取生產前狀態")

            before = await get_state(
                request,
                token
            )

            material_before = find_material(
                before,
                "MAT-GLASS"
            )

            product_before = find_product(
                before,
                PRODUCT_ID
            )

            mold_before = find_mold(
                before,
                MOLD_ID
            )

            if not material_before:
                raise RuntimeError(
                    "找不到 MAT-GLASS"
                )

            if not product_before:
                raise RuntimeError(
                    f"找不到產品 "
                    f"{PRODUCT_ID}"
                )

            if not mold_before:
                raise RuntimeError(
                    f"找不到模具 "
                    f"{MOLD_ID}"
                )

            material_stock_before = float(
                material_before[
                    "stock"
                ]
            )

            product_stock_before = int(
                product_before[
                    "stock"
                ]
            )

            mold_status_before = (
                mold_before[
                    "status"
                ]
            )

            print(
                f"MAT-GLASS："
                f"{material_stock_before}"
            )

            print(
                f"{PRODUCT_ID}："
                f"{product_stock_before}"
            )

            print(
                f"{MOLD_ID}："
                f"{mold_status_before}"
            )

            # -------------------------------------------------
            # 5. 建立工單
            # -------------------------------------------------

            work_order_id = (
                await create_work_order(
                    request,
                    token
                )
            )

            print(
                f"工單建立成功："
                f"{work_order_id}"
            )

            # -------------------------------------------------
            # 6. 等待完成
            # -------------------------------------------------

            print()
            print("[6/8] 等待工單完成")

            work_order = (
                await wait_for_work_order(
                    request,
                    token,
                    work_order_id
                )
            )

            final_status = (
                work_order.get(
                    "status"
                )
            )

            if final_status != "Completed":
                raise RuntimeError(
                    f"工單沒有完成："
                    f"{final_status}"
                )

            # -------------------------------------------------
            # 7. 生產後狀態
            # -------------------------------------------------

            print()
            print(
                "[7/8] 驗證庫存 / "
                "產品 / 模具"
            )

            after = await get_state(
                request,
                token
            )

            material_after = find_material(
                after,
                "MAT-GLASS"
            )

            product_after = find_product(
                after,
                PRODUCT_ID
            )

            mold_after = find_mold(
                after,
                MOLD_ID
            )

            material_stock_after = float(
                material_after[
                    "stock"
                ]
            )

            product_stock_after = int(
                product_after[
                    "stock"
                ]
            )

            mold_status_after = (
                mold_after[
                    "status"
                ]
            )

            expected_material_decrease = (
                MATERIAL_REQUIREMENTS[
                    "MAT-GLASS"
                ]
                * QUANTITY
            )

            expected_material_stock = (
                material_stock_before
                - expected_material_decrease
            )

            expected_product_stock = (
                product_stock_before
                + QUANTITY
            )

            actual_material_decrease = (
                material_stock_before
                - material_stock_after
            )

            actual_product_increase = (
                product_stock_after
                - product_stock_before
            )

            print()
            print(
                "MAT-GLASS："
                f"{material_stock_before}"
                f" -> "
                f"{material_stock_after}"
            )

            print(
                "預期："
                f"{expected_material_stock}"
            )

            print(
                "實際扣除："
                f"{actual_material_decrease}"
            )

            print()
            print(
                f"{PRODUCT_NAME}："
                f"{product_stock_before}"
                f" -> "
                f"{product_stock_after}"
            )

            print(
                "實際增加："
                f"{actual_product_increase}"
            )

            print()
            print(
                f"{MOLD_ID}："
                f"{mold_status_before}"
                f" -> "
                f"{mold_status_after}"
            )

            # -------------------------------------------------
            # 8. 驗證
            # -------------------------------------------------

            print()
            print("[8/8] 驗證結果")

            errors = []

            if (
                material_stock_after
                >= material_stock_before
            ):
                errors.append(
                    "BUG：材料庫存沒有減少"
                )

            if abs(
                actual_material_decrease
                - expected_material_decrease
            ) > 0.001:

                errors.append(
                    "BUG：材料扣除數量錯誤，"
                    f"預期："
                    f"{expected_material_decrease}，"
                    f"實際："
                    f"{actual_material_decrease}"
                )

            if (
                product_stock_after
                <= product_stock_before
            ):
                errors.append(
                    "BUG：產品庫存沒有增加"
                )

            if (
                actual_product_increase
                != QUANTITY
            ):
                errors.append(
                    "BUG：產品增加數量錯誤，"
                    f"預期：{QUANTITY}，"
                    f"實際："
                    f"{actual_product_increase}"
                )

            if (
                mold_status_after
                != "In_Use"
            ):
                errors.append(
                    "BUG：模具沒有變成 In_Use"
                )

            if errors:

                reason = "\n".join(
                    errors
                )

                await save_debug(
                    page,
                    reason
                )

                print()
                print("=" * 70)
                print("E2E TEST FAILED")
                print("=" * 70)

                for error in errors:
                    print(error)

                print("=" * 70)

                return False

            print()
            print("=" * 70)
            print("E2E TEST PASSED")
            print("=" * 70)

            print(
                f"工單：{work_order_id}"
            )

            print(
                f"材料："
                f"{material_stock_before}"
                f" -> "
                f"{material_stock_after}"
            )

            print(
                f"產品："
                f"{product_stock_before}"
                f" -> "
                f"{product_stock_after}"
            )

            print(
                f"模具："
                f"{mold_status_before}"
                f" -> "
                f"{mold_status_after}"
            )

            print("=" * 70)

            return True

        except Exception as e:

            await save_debug(
                page,
                f"未預期例外："
                f"{type(e).__name__}: {e}"
            )

            print()
            print("=" * 70)
            print("E2E TEST ERROR")
            print("=" * 70)

            print(e)

            print("=" * 70)

            return False

        finally:

            await request.dispose()

            await context.close()

            await browser.close()


if __name__ == "__main__":

    result = asyncio.run(
        run_test()
    )

    if not result:
        raise SystemExit(1)