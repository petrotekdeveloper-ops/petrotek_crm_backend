const express = require('express');
const mongoose = require('mongoose');
const ServiceLog = require('../models/serviceLog');
const { requireService } = require('../middleware/serviceAuth');

const router = express.Router();

function parseDate(value) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseKm(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Undefined = omit; null = invalid; number = parsed amount. */
function parseOptionalAmount(value) {
  if (value == null) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function isServiceHead(req) {
  return req.serviceUser?.serviceHead === true;
}

function amountProvidedInBody(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function normalizeRequiredText(value) {
  if (value == null) return null;
  const v = String(value).trim();
  return v === '' ? null : v;
}

function normalizeOptionalText(value, maxLen = 2000) {
  if (value == null || value === '') return '';
  return String(value).trim().slice(0, maxLen);
}

function logResponse(doc) {
  const o = doc.toObject ? doc.toObject() : { ...doc };
  return o;
}

/** Non–service-head users never receive `amount` in JSON (defense in depth). */
function logResponseForViewer(doc, req) {
  const o = logResponse(doc);
  if (!isServiceHead(req)) {
    delete o.amount;
  }
  return o;
}

function stripAmountIfNeeded(row, req) {
  if (isServiceHead(req)) return row;
  const o = { ...row };
  delete o.amount;
  return o;
}

function badId(res) {
  return res.status(400).json({ error: 'Invalid log id' });
}

function parsePaging(query) {
  const limitRaw = Number(query?.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(200, Math.trunc(limitRaw)))
    : 100;
  return { limit };
}

function parseYearMonth(query) {
  const y = parseInt(query?.year, 10);
  const m = parseInt(query?.month, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return null;
  }
  return { year: y, month: m };
}

function monthUtcRange(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { start, end };
}

router.get('/', requireService, async (req, res) => {
  const { limit } = parsePaging(req.query);
  const ym = parseYearMonth(req.query);
  try {
    const filter = { serviceUserId: req.serviceUser._id };
    if (ym) {
      const { start, end } = monthUtcRange(ym.year, ym.month);
      filter.date = { $gte: start, $lt: end };
    }
    const logs = await ServiceLog.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json({
      serviceLogs: logs.map((row) => stripAmountIfNeeded(row, req)),
    });
  } catch {
    return res.status(500).json({ error: 'Failed to list service logs' });
  }
});

router.post('/', requireService, async (req, res) => {
  const { date, customer, service, km, spares, status, amount } = req.body || {};

  if (!isServiceHead(req) && amountProvidedInBody(amount)) {
    return res.status(403).json({
      error: 'Only service head users can set amount on a service log',
    });
  }

  const parsedDate = parseDate(date);
  if (!parsedDate) {
    return res.status(400).json({ error: 'date is required (YYYY-MM-DD or ISO)' });
  }

  const customerText = normalizeRequiredText(customer);
  if (!customerText) {
    return res.status(400).json({ error: 'customer is required' });
  }

  const serviceText = normalizeRequiredText(service);
  if (!serviceText) {
    return res.status(400).json({ error: 'service is required' });
  }

  const parsedKm = parseKm(km);
  if (parsedKm == null) {
    return res.status(400).json({ error: 'km must be a non-negative number' });
  }

  const statusText = normalizeRequiredText(status);
  if (!statusText) {
    return res.status(400).json({ error: 'status is required' });
  }

  let parsedAmount;
  if (isServiceHead(req)) {
    parsedAmount = parseOptionalAmount(amount);
    if (parsedAmount === null) {
      return res.status(400).json({ error: 'amount must be a non-negative number' });
    }
  }

  try {
    const payload = {
      serviceUserId: req.serviceUser._id,
      date: parsedDate,
      customer: customerText,
      service: serviceText,
      km: parsedKm,
      spares: normalizeOptionalText(spares),
      status: statusText,
    };
    if (isServiceHead(req) && parsedAmount !== undefined) {
      payload.amount = parsedAmount;
    }

    const doc = await ServiceLog.create(payload);
    return res.status(201).json({ serviceLog: logResponseForViewer(doc, req) });
  } catch {
    return res.status(500).json({ error: 'Failed to create service log' });
  }
});

router.get('/:id', requireService, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return badId(res);
  try {
    const doc = await ServiceLog.findById(id);
    if (!doc || String(doc.serviceUserId) !== String(req.serviceUser._id)) {
      return res.status(404).json({ error: 'Service log not found' });
    }
    return res.json({ serviceLog: logResponseForViewer(doc, req) });
  } catch {
    return res.status(500).json({ error: 'Failed to load service log' });
  }
});

router.put('/:id', requireService, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return badId(res);

  try {
    const doc = await ServiceLog.findById(id);
    if (!doc || String(doc.serviceUserId) !== String(req.serviceUser._id)) {
      return res.status(404).json({ error: 'Service log not found' });
    }

    const { date, customer, service, km, spares, status, amount } = req.body || {};

    if (amount !== undefined) {
      if (!isServiceHead(req)) {
        return res.status(403).json({
          error: 'Only service head users can set amount on a service log',
        });
      }
      if (amount === null || amount === '') {
        await ServiceLog.updateOne({ _id: doc._id }, { $unset: { amount: 1 } });
        doc.amount = undefined;
      } else {
        const parsedAmount = parseOptionalAmount(amount);
        if (parsedAmount === null) {
          return res.status(400).json({ error: 'amount must be a non-negative number' });
        }
        if (parsedAmount === undefined) {
          await ServiceLog.updateOne({ _id: doc._id }, { $unset: { amount: 1 } });
          doc.amount = undefined;
        } else {
          doc.amount = parsedAmount;
        }
      }
    }

    if (date !== undefined) {
      const parsedDate = parseDate(date);
      if (!parsedDate) return res.status(400).json({ error: 'Invalid date' });
      doc.date = parsedDate;
    }
    if (customer !== undefined) {
      const customerText = normalizeRequiredText(customer);
      if (!customerText) return res.status(400).json({ error: 'customer cannot be empty' });
      doc.customer = customerText;
    }
    if (service !== undefined) {
      const serviceText = normalizeRequiredText(service);
      if (!serviceText) return res.status(400).json({ error: 'service cannot be empty' });
      doc.service = serviceText;
    }
    if (km !== undefined) {
      const parsedKm = parseKm(km);
      if (parsedKm == null) {
        return res.status(400).json({ error: 'km must be a non-negative number' });
      }
      doc.km = parsedKm;
    }
    if (spares !== undefined) {
      doc.spares = normalizeOptionalText(spares);
    }
    if (status !== undefined) {
      const statusText = normalizeRequiredText(status);
      if (!statusText) return res.status(400).json({ error: 'status cannot be empty' });
      doc.status = statusText;
    }

    await doc.save();
    const fresh = await ServiceLog.findById(id);
    return res.json({ serviceLog: logResponseForViewer(fresh, req) });
  } catch {
    return res.status(500).json({ error: 'Failed to update service log' });
  }
});

router.delete('/:id', requireService, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return badId(res);

  try {
    const doc = await ServiceLog.findOneAndDelete({
      _id: id,
      serviceUserId: req.serviceUser._id,
    });
    if (!doc) return res.status(404).json({ error: 'Service log not found' });
    return res.json({ message: 'Deleted' });
  } catch {
    return res.status(500).json({ error: 'Failed to delete service log' });
  }
});

module.exports = router;
