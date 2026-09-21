const express = require("express");
const cors = require("cors");
const defaultPool = require("./db/pool");
const { errorHandler, notFound } = require("./middleware/errorHandler");
const createMaterialsRouter = require("./routes/materials");
const createProductsRouter = require("./routes/products");
const createRoutingsRouter = require("./routes/routings");
const createMoldsRouter = require("./routes/molds");
const createBomRouter = require("./routes/bom");
const createWorkOrdersRouter = require("./routes/workOrders");
const createWorkOrderTasksRouter = require("./routes/workOrderTasks");
const createAovGraphsRouter = require("./routes/aovGraphs");
const createLogsRouter = require("./routes/logs");
const createAuthRouter = require("./routes/auth");
const createQuestionRouter = require("./routes/question");   // ← 新增 1
const createAutoOrdersRouter = require("./routes/autoOrders");
const createLinesRouter = require("./routes/lines");
const createLineRatesRouter = require("./routes/lineRates");
const createItemMoldsRouter = require("./routes/itemMolds");
const createLineMoldsRouter = require("./routes/lineMolds");

function createApp(options = {}) {
  const pool = options.pool || defaultPool;
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok", database: "ok" });
    } catch (error) {
      res.status(503).json({
        status: "error",
        database: "error",
        error: "Database connection failed"
      });
    }
  });

  app.use("/api/materials", createMaterialsRouter(pool));
  app.use("/api/products", createProductsRouter(pool));
  app.use("/api/routings", createRoutingsRouter(pool));
  app.use("/api/molds", createMoldsRouter(pool));
  app.use("/api/lines", createLinesRouter(pool));
  app.use("/api/lines", createLineRatesRouter(pool));
  app.use("/api/lines", createLineMoldsRouter(pool));
  app.use("/api/items", createItemMoldsRouter(pool));
  app.use("/api/bom", createBomRouter(pool));
  app.use("/api/aov-graphs", createAovGraphsRouter(pool));
  app.use("/api/work-orders", createWorkOrdersRouter(pool));
  app.use("/api/work-orders", createWorkOrderTasksRouter(pool));
  app.use("/api/logs", createLogsRouter(pool));
  app.use("/api/auth", createAuthRouter(pool));
  app.use("/api/question", createQuestionRouter(pool));      // ← 新增 2
  app.use("/api/auto-orders", createAutoOrdersRouter(pool));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
