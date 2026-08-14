-- 002_add_work_order_sequence.sql
--
-- 修正「Database constraint conflict」問題：
-- 舊版前端在 client 端用 `state.workOrders.length + 1` 拼湊 work_order_id，
-- 這不是原子操作，短時間內重複點擊或多個使用者併發建單時，
-- 會算出相同的 work_order_id，導致撞上 work_orders_pkey (work_order_id) 唯一鍵。
--
-- 解法：改用 PostgreSQL SEQUENCE 在後端 Transaction 內原子產生流水號，
-- 前端不再自行計算或傳送 work_order_id。

CREATE SEQUENCE IF NOT EXISTS work_order_seq
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  NO MAXVALUE
  CACHE 1;
