const express = require('express');
const mongoose = require('mongoose');
const Quotation = require('../models/quotation');
const { requireSales } = require('../middleware/salesAuth');
const { requireManager } = require('../middleware/managerAuth');
const { requireService } = require('../middleware/serviceAuth');
const {
  applyQuotationUpdates,
  parseListLimit,
  parseQuotationBody,
  parseYearMonth,
  quotationResponse,
  resolveQuotationListFilter,
} = require('../utils/quotationHelpers');

function badId(res) {
  return res.status(400).json({ error: 'Invalid quotation id' });
}

function createOwnerQuotationRouter(getOwnerUser) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const owner = getOwnerUser(req);
    const ym = parseYearMonth(req.query);
    const resolved = resolveQuotationListFilter(req.query);
    const limit = parseListLimit(req.query, { monthScoped: Boolean(ym) });

    try {
      const rows = await Quotation.find({
        salesUserId: owner._id,
        ...resolved.filter,
      })
        .sort({ date: -1, createdAt: -1 })
        .limit(limit)
        .lean();
      return res.json({ quotations: rows });
    } catch {
      return res.status(500).json({ error: 'Failed to list quotations' });
    }
  });

  router.post('/', async (req, res) => {
    const owner = getOwnerUser(req);
    const parsed = parseQuotationBody(req.body);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    try {
      const doc = await Quotation.create({
        ...parsed.data,
        salesUserId: owner._id,
      });
      return res.status(201).json({ quotation: quotationResponse(doc) });
    } catch {
      return res.status(500).json({ error: 'Failed to create quotation' });
    }
  });

  router.get('/:id', async (req, res) => {
    const owner = getOwnerUser(req);
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return badId(res);

    try {
      const doc = await Quotation.findById(id);
      if (!doc || String(doc.salesUserId) !== String(owner._id)) {
        return res.status(404).json({ error: 'Quotation not found' });
      }
      return res.json({ quotation: quotationResponse(doc) });
    } catch {
      return res.status(500).json({ error: 'Failed to load quotation' });
    }
  });

  router.put('/:id', async (req, res) => {
    const owner = getOwnerUser(req);
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return badId(res);

    try {
      const doc = await Quotation.findById(id);
      if (!doc || String(doc.salesUserId) !== String(owner._id)) {
        return res.status(404).json({ error: 'Quotation not found' });
      }

      const updated = applyQuotationUpdates(doc, req.body);
      if (updated.error) {
        return res.status(400).json({ error: updated.error });
      }

      await doc.save();
      return res.json({ quotation: quotationResponse(doc) });
    } catch {
      return res.status(500).json({ error: 'Failed to update quotation' });
    }
  });

  router.delete('/:id', async (req, res) => {
    const owner = getOwnerUser(req);
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return badId(res);

    try {
      const doc = await Quotation.findOneAndDelete({
        _id: id,
        salesUserId: owner._id,
      });
      if (!doc) {
        return res.status(404).json({ error: 'Quotation not found' });
      }
      return res.json({ message: 'Deleted' });
    } catch {
      return res.status(500).json({ error: 'Failed to delete quotation' });
    }
  });

  return router;
}

const salesQuotationRoutes = express.Router();
salesQuotationRoutes.use(requireSales);
salesQuotationRoutes.use(createOwnerQuotationRouter((req) => req.salesUser));

const managerQuotationRoutes = express.Router();
managerQuotationRoutes.use(requireManager);
managerQuotationRoutes.use(createOwnerQuotationRouter((req) => req.manager));

const serviceQuotationRoutes = express.Router();
serviceQuotationRoutes.use(requireService);
serviceQuotationRoutes.use(createOwnerQuotationRouter((req) => req.serviceUser));

module.exports = {
  salesQuotationRoutes,
  managerQuotationRoutes,
  serviceQuotationRoutes,
};
