const express = require('express');
const mongoose = require('mongoose');
const Enquiry = require('../models/enquiry');
const { requireSales } = require('../middleware/salesAuth');
const { requireManager } = require('../middleware/managerAuth');
const {
  applyEnquiryUpdates,
  buildEnquiryQueryFilters,
  enquiryResponse,
  filterDueTodayRows,
  generateSerialNo,
  isCreatorInTeam,
  managerTeamCreatorIds,
  parseEnquiryBody,
  parseListLimit,
} = require('../utils/enquiryHelpers');

const CREATED_BY_POPULATE = 'name phone designation company';

function badId(res) {
  return res.status(400).json({ error: 'Invalid enquiry id' });
}

function createOwnerEnquiryRouter(getOwnerUser) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const owner = getOwnerUser(req);
    const { filter } = buildEnquiryQueryFilters(req.query);
    const ym = req.query?.year && req.query?.month;
    const limit = parseListLimit(req.query, { monthScoped: Boolean(ym) });

    try {
      let rows = await Enquiry.find({
        createdBy: owner._id,
        ...filter,
      })
        .sort({ dateReceived: -1, createdAt: -1 })
        .populate('createdBy', CREATED_BY_POPULATE)
        .limit(limit)
        .lean();

      if (req.query?.dueToday === 'true') {
        rows = filterDueTodayRows(rows);
      }

      return res.json({
        enquiries: rows.map((row) => enquiryResponse(row)),
      });
    } catch {
      return res.status(500).json({ error: 'Failed to list enquiries' });
    }
  });

  router.post('/', async (req, res) => {
    const owner = getOwnerUser(req);
    const parsed = parseEnquiryBody(req.body);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    try {
      const serialNo = await generateSerialNo({
        company: owner.company,
        dateReceived: parsed.data.dateReceived,
      });
      const doc = await Enquiry.create({
        ...parsed.data,
        serialNo,
        createdBy: owner._id,
      });
      await doc.populate('createdBy', CREATED_BY_POPULATE);
      return res.status(201).json({ enquiry: enquiryResponse(doc) });
    } catch (err) {
      if (err?.code === 11000) {
        return res.status(409).json({ error: 'Serial number conflict, please retry' });
      }
      return res.status(500).json({ error: 'Failed to create enquiry' });
    }
  });

  router.get('/:id', async (req, res) => {
    const owner = getOwnerUser(req);
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return badId(res);

    try {
      const doc = await Enquiry.findById(id).populate('createdBy', CREATED_BY_POPULATE);
      if (!doc || String(doc.createdBy?._id || doc.createdBy) !== String(owner._id)) {
        return res.status(404).json({ error: 'Enquiry not found' });
      }
      return res.json({ enquiry: enquiryResponse(doc) });
    } catch {
      return res.status(500).json({ error: 'Failed to load enquiry' });
    }
  });

  router.put('/:id', async (req, res) => {
    const owner = getOwnerUser(req);
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return badId(res);

    try {
      const doc = await Enquiry.findById(id);
      if (!doc || String(doc.createdBy) !== String(owner._id)) {
        return res.status(404).json({ error: 'Enquiry not found' });
      }

      const updated = applyEnquiryUpdates(doc, req.body);
      if (updated.error) {
        return res.status(400).json({ error: updated.error });
      }

      await doc.save();
      await doc.populate('createdBy', CREATED_BY_POPULATE);
      return res.json({ enquiry: enquiryResponse(doc) });
    } catch {
      return res.status(500).json({ error: 'Failed to update enquiry' });
    }
  });

  router.delete('/:id', async (req, res) => {
    const owner = getOwnerUser(req);
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return badId(res);

    try {
      const doc = await Enquiry.findOneAndDelete({
        _id: id,
        createdBy: owner._id,
      });
      if (!doc) {
        return res.status(404).json({ error: 'Enquiry not found' });
      }
      return res.json({ message: 'Deleted' });
    } catch {
      return res.status(500).json({ error: 'Failed to delete enquiry' });
    }
  });

  return router;
}

function createManagerEnquiryRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const manager = req.manager;
    const { filter } = buildEnquiryQueryFilters(req.query);
    const ym = req.query?.year && req.query?.month;
    const limit = parseListLimit(req.query, { monthScoped: Boolean(ym) });

    try {
      const teamCreatorIds = await managerTeamCreatorIds(manager._id);
      let rows = await Enquiry.find({
        createdBy: { $in: teamCreatorIds },
        ...filter,
      })
        .sort({ dateReceived: -1, createdAt: -1 })
        .populate('createdBy', CREATED_BY_POPULATE)
        .limit(limit)
        .lean();

      if (req.query?.dueToday === 'true') {
        rows = filterDueTodayRows(rows);
      }

      return res.json({
        enquiries: rows.map((row) => enquiryResponse(row)),
      });
    } catch {
      return res.status(500).json({ error: 'Failed to list enquiries' });
    }
  });

  router.post('/', async (req, res) => {
    const manager = req.manager;
    const parsed = parseEnquiryBody(req.body);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    try {
      const serialNo = await generateSerialNo({
        company: manager.company,
        dateReceived: parsed.data.dateReceived,
      });
      const doc = await Enquiry.create({
        ...parsed.data,
        serialNo,
        createdBy: manager._id,
      });
      await doc.populate('createdBy', CREATED_BY_POPULATE);
      return res.status(201).json({ enquiry: enquiryResponse(doc) });
    } catch (err) {
      if (err?.code === 11000) {
        return res.status(409).json({ error: 'Serial number conflict, please retry' });
      }
      return res.status(500).json({ error: 'Failed to create enquiry' });
    }
  });

  router.get('/:id', async (req, res) => {
    const manager = req.manager;
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return badId(res);

    try {
      const teamCreatorIds = await managerTeamCreatorIds(manager._id);
      const doc = await Enquiry.findById(id).populate('createdBy', CREATED_BY_POPULATE);
      if (!doc || !isCreatorInTeam(doc.createdBy, teamCreatorIds)) {
        return res.status(404).json({ error: 'Enquiry not found' });
      }
      return res.json({ enquiry: enquiryResponse(doc) });
    } catch {
      return res.status(500).json({ error: 'Failed to load enquiry' });
    }
  });

  router.put('/:id', async (req, res) => {
    const manager = req.manager;
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return badId(res);

    try {
      const teamCreatorIds = await managerTeamCreatorIds(manager._id);
      const doc = await Enquiry.findById(id);
      if (!doc || !isCreatorInTeam(doc.createdBy, teamCreatorIds)) {
        return res.status(404).json({ error: 'Enquiry not found' });
      }

      const updated = applyEnquiryUpdates(doc, req.body);
      if (updated.error) {
        return res.status(400).json({ error: updated.error });
      }

      await doc.save();
      await doc.populate('createdBy', CREATED_BY_POPULATE);
      return res.json({ enquiry: enquiryResponse(doc) });
    } catch {
      return res.status(500).json({ error: 'Failed to update enquiry' });
    }
  });

  router.delete('/:id', async (req, res) => {
    const manager = req.manager;
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return badId(res);

    try {
      const doc = await Enquiry.findOneAndDelete({
        _id: id,
        createdBy: manager._id,
      });
      if (!doc) {
        return res.status(404).json({ error: 'Enquiry not found' });
      }
      return res.json({ message: 'Deleted' });
    } catch {
      return res.status(500).json({ error: 'Failed to delete enquiry' });
    }
  });

  return router;
}

const salesEnquiryRoutes = express.Router();
salesEnquiryRoutes.use(requireSales);
salesEnquiryRoutes.use(createOwnerEnquiryRouter((req) => req.salesUser));

const managerEnquiryRoutes = express.Router();
managerEnquiryRoutes.use(requireManager);
managerEnquiryRoutes.use(createManagerEnquiryRouter());

module.exports = {
  salesEnquiryRoutes,
  managerEnquiryRoutes,
};
