const express = require('express');
const mongoose = require('mongoose');
const DailySale = require('../models/dailySale');
const { requireSales } = require('../middleware/salesAuth');
const {
  monthUtcRange,
  parseSaleDate,
  salesUserMonthSummary,
} = require('../utils/salesHelpers');

const router = express.Router();

function saleResponse(doc) {
  const o = doc.toObject ? doc.toObject() : { ...doc };
  return o;
}

function parseYearMonth(query) {
  const y = parseInt(query.year, 10);
  const m = parseInt(query.month, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return null;
  }
  return { year: y, month: m };
}

router.get('/summary', requireSales, async (req, res) => {
  const ym = parseYearMonth(req.query);
  if (!ym) {
    return res.status(400).json({
      error: 'Query params year and month (1-12) are required',
    });
  }
  try {
    const summary = await salesUserMonthSummary(req.salesUser, ym.year, ym.month);
    return res.json(summary);
  } catch {
    return res.status(500).json({ error: 'Failed to load summary' });
  }
});

router.get('/daily', requireSales, async (req, res) => {
  const ym = parseYearMonth(req.query);
  if (!ym) {
    return res.status(400).json({
      error: 'Query params year and month (1-12) are required',
    });
  }
  const { start, end } = monthUtcRange(ym.year, ym.month);
  try {
    const rows = await DailySale.find({
      salesUserId: req.salesUser._id,
      saleDate: { $gte: start, $lt: end },
    })
      .sort({ saleDate: -1 })
      .lean();
    return res.json({ dailySales: rows });
  } catch {
    return res.status(500).json({ error: 'Failed to list daily sales' });
  }
});

router.post('/daily', requireSales, async (req, res) => {
  const { date, amount, note } = req.body || {};
  const saleDate = parseSaleDate(date);
  if (!saleDate) {
    return res.status(400).json({
      error: 'date is required (YYYY-MM-DD or ISO)',
    });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0) {
    return res.status(400).json({ error: 'amount must be a non-negative number' });
  }

  const noteStr =
    note == null || note === ''
      ? ''
      : String(note).trim().slice(0, 2000);

  try {
    const doc = await DailySale.create({
      salesUserId: req.salesUser._id,
      saleDate,
      amount: amt,
      note: noteStr,
    });
    return res.status(201).json({ dailySale: saleResponse(doc) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(500).json({
        error:
          'Daily log uniqueness index still exists. Run npm run drop:daily-sale-unique-index in backend.',
      });
    }
    return res.status(500).json({ error: 'Failed to save daily sale' });
  }
});

router.get('/daily/:id', requireSales, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const doc = await DailySale.findById(id);
    if (!doc || String(doc.salesUserId) !== String(req.salesUser._id)) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json({ dailySale: saleResponse(doc) });
  } catch {
    return res.status(500).json({ error: 'Failed to load daily sale' });
  }
});

router.put('/daily/:id', requireSales, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  const { date, amount, note } = req.body || {};
  try {
    const doc = await DailySale.findById(id);
    if (!doc || String(doc.salesUserId) !== String(req.salesUser._id)) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (date !== undefined) {
      const sd = parseSaleDate(date);
      if (!sd) {
        return res.status(400).json({ error: 'Invalid date' });
      }
      doc.saleDate = sd;
    }
    if (amount !== undefined) {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt < 0) {
        return res.status(400).json({ error: 'amount must be a non-negative number' });
      }
      doc.amount = amt;
    }
    if (note !== undefined) {
      doc.note =
        note == null || note === ''
          ? ''
          : String(note).trim().slice(0, 2000);
    }
    await doc.save();
    return res.json({ dailySale: saleResponse(doc) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(500).json({
        error:
          'Daily log uniqueness index still exists. Run npm run drop:daily-sale-unique-index in backend.',
      });
    }
    return res.status(500).json({ error: 'Failed to update daily sale' });
  }
});

router.delete('/daily/:id', requireSales, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const doc = await DailySale.findOneAndDelete({
      _id: id,
      salesUserId: req.salesUser._id,
    });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    return res.json({ message: 'Deleted' });
  } catch {
    return res.status(500).json({ error: 'Failed to delete daily sale' });
  }
});

module.exports = router;
