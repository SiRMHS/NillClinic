import { Router } from "express";
import { fetchReceptionsLive } from "../services/receptions.service.js";

export const receptionsRouter = Router();

const jalaliDatePattern = /^\d{4}\/\d{2}\/\d{2}$/;

receptionsRouter.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 100), 200);
    const search = (req.query.search as string | undefined)?.trim();
    const fromDate = (req.query.fromDate as string | undefined)?.trim() || "1400/01/01";
    const toDate = (req.query.toDate as string | undefined)?.trim();

    if (!jalaliDatePattern.test(fromDate) || (toDate && !jalaliDatePattern.test(toDate))) {
      res.status(400).json({ error: "فرمت تاریخ باید YYYY/MM/DD شمسی باشد" });
      return;
    }

    const receptions = await fetchReceptionsLive({ limit, search, fromDate, toDate });
    res.json(receptions);
  } catch (e) {
    next(e);
  }
});
