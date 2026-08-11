const express = require("express");
const cors = require("cors");
const defaultPool = require("./db/pool");
const { errorHandler, notFound } = require("./middleware/errorHandler");
const createMaterialsRouter = require("./routes/materials");
const createProductsRouter = require("./routes/products");
const createMoldsRouter = require("./routes/molds");
const createBomRouter = require("./routes/bom");
const createWorkOrdersRouter = require("./routes/workOrders");
const createLogsRouter = require("./routes/logs");

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
  app.use("/api/molds", createMoldsRouter(pool));
  app.use("/api/bom", createBomRouter(pool));
  app.use("/api/work-orders", createWorkOrdersRouter(pool));
  app.use("/api/logs", createLogsRouter(pool));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
