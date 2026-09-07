const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

module.exports = function createQuestionRouter(pool) {
  const router = Router();

  router.post("", asyncRoute(async (req, res) => {
    const { question } = req.body;
    if (!question || typeof question !== "string") {
      throw createHttpError(400, "A valid question string is required");
    }
    // For now, just echo a placeholder answer
    const answer = `You asked: "${question}". This is a placeholder answer.`;
    res.json({ answer });
  }));

  return router;
};
