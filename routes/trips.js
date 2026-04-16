const express = require('express');
const mongoose = require('mongoose');
const Trip = require('../models/trip');
const User = require('../models/users');
const { requireDriver } = require('../middleware/driverAuth');
const { requireManager } = require('../middleware/managerAuth');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

function parseTripDate(value) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDistance(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function normalizeLocation(value) {
  if (value == null) return null;
  const v = String(value).trim();
  return v === '' ? null : v;
}

function normalizeNotes(value) {
  if (value == null || value === '') return '';
  return String(value).trim().slice(0, 2000);
}

function tripResponse(doc) {
  const o = doc.toObject ? doc.toObject() : { ...doc };
  return o;
}

function badTripId(res) {
  return res.status(400).json({ error: 'Invalid trip id' });
}

function parsePaging(query) {
  const limitRaw = Number(query?.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(100, Math.trunc(limitRaw)))
    : 100;
  return { limit };
}

router.get('/', requireDriver, async (req, res) => {
  const { limit } = parsePaging(req.query);
  try {
    const trips = await Trip.find({ driverId: req.driverUser._id })
      .sort({ tripDate: -1, createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json({ trips });
  } catch {
    return res.status(500).json({ error: 'Failed to list trips' });
  }
});

router.post('/', requireDriver, async (req, res) => {
  const { tripDate, pickupLocation, dropLocation, distance, notes } = req.body || {};
  const date = parseTripDate(tripDate);
  if (!date) {
    return res.status(400).json({ error: 'tripDate is required (YYYY-MM-DD or ISO)' });
  }
  const pickup = normalizeLocation(pickupLocation);
  if (!pickup) {
    return res.status(400).json({ error: 'pickupLocation is required' });
  }
  const drop = normalizeLocation(dropLocation);
  if (!drop) {
    return res.status(400).json({ error: 'dropLocation is required' });
  }
  const km = parseDistance(distance);
  if (km == null) {
    return res.status(400).json({ error: 'distance must be a non-negative number' });
  }
  try {
    const doc = await Trip.create({
      driverId: req.driverUser._id,
      tripDate: date,
      pickupLocation: pickup,
      dropLocation: drop,
      distance: km,
      notes: normalizeNotes(notes),
    });
    return res.status(201).json({ trip: tripResponse(doc) });
  } catch {
    return res.status(500).json({ error: 'Failed to create trip' });
  }
});

router.put('/:id', requireDriver, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return badTripId(res);

  try {
    const trip = await Trip.findById(id);
    if (!trip || String(trip.driverId) !== String(req.driverUser._id)) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    const { tripDate, pickupLocation, dropLocation, distance, notes } = req.body || {};
    if (tripDate !== undefined) {
      const date = parseTripDate(tripDate);
      if (!date) return res.status(400).json({ error: 'Invalid tripDate' });
      trip.tripDate = date;
    }
    if (pickupLocation !== undefined) {
      const pickup = normalizeLocation(pickupLocation);
      if (!pickup) return res.status(400).json({ error: 'pickupLocation cannot be empty' });
      trip.pickupLocation = pickup;
    }
    if (dropLocation !== undefined) {
      const drop = normalizeLocation(dropLocation);
      if (!drop) return res.status(400).json({ error: 'dropLocation cannot be empty' });
      trip.dropLocation = drop;
    }
    if (distance !== undefined) {
      const km = parseDistance(distance);
      if (km == null) {
        return res.status(400).json({ error: 'distance must be a non-negative number' });
      }
      trip.distance = km;
    }
    if (notes !== undefined) {
      trip.notes = normalizeNotes(notes);
    }

    await trip.save();
    return res.json({ trip: tripResponse(trip) });
  } catch {
    return res.status(500).json({ error: 'Failed to update trip' });
  }
});

router.delete('/:id', requireDriver, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return badTripId(res);

  try {
    const doc = await Trip.findOneAndDelete({
      _id: id,
      driverId: req.driverUser._id,
    });
    if (!doc) return res.status(404).json({ error: 'Trip not found' });
    return res.json({ message: 'Deleted' });
  } catch {
    return res.status(500).json({ error: 'Failed to delete trip' });
  }
});

router.get('/manager', requireManager, async (req, res) => {
  const { limit } = parsePaging(req.query);
  try {
    const approvedDrivers = await User.find({
      designation: 'driver',
      approvalStatus: 'approved',
    })
      .select('_id name phone vehicleNumber')
      .lean();

    const driverIds = approvedDrivers.map((d) => d._id);
    const driverMap = new Map(
      approvedDrivers.map((d) => [
        String(d._id),
        { name: d.name, phone: d.phone, vehicleNumber: d.vehicleNumber || '' },
      ])
    );

    const rows = await Trip.find({ driverId: { $in: driverIds } })
      .sort({ tripDate: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    const trips = rows.map((row) => {
      const driver = driverMap.get(String(row.driverId));
      return {
        ...row,
        driverName: driver?.name ?? '—',
        driverPhone: driver?.phone ?? '—',
        driverVehicleNumber: driver?.vehicleNumber ?? '',
      };
    });

    return res.json({ trips });
  } catch {
    return res.status(500).json({ error: 'Failed to list trips' });
  }
});

router.get('/admin', requireAdmin, async (req, res) => {
  const { limit } = parsePaging(req.query);
  try {
    const rows = await Trip.find()
      .sort({ tripDate: -1, createdAt: -1 })
      .limit(limit)
      .populate('driverId', 'name phone vehicleNumber')
      .lean();
    const trips = rows.map((row) => ({
      ...row,
      driverName: row.driverId?.name ?? '—',
      driverPhone: row.driverId?.phone ?? '—',
      driverVehicleNumber: row.driverId?.vehicleNumber ?? '',
    }));
    return res.json({ trips });
  } catch {
    return res.status(500).json({ error: 'Failed to list trips' });
  }
});

router.get('/manager/:id', requireManager, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return badTripId(res);

  try {
    const trip = await Trip.findById(id)
      .populate('driverId', 'name phone vehicleNumber approvalStatus designation')
      .lean();
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    if (trip.driverId?.designation !== 'driver') {
      return res.status(404).json({ error: 'Trip not found' });
    }
    return res.json({ trip });
  } catch {
    return res.status(500).json({ error: 'Failed to load trip' });
  }
});

router.get('/admin/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return badTripId(res);
  try {
    const trip = await Trip.findById(id)
      .populate('driverId', 'name phone vehicleNumber approvalStatus designation')
      .lean();
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    return res.json({ trip });
  } catch {
    return res.status(500).json({ error: 'Failed to load trip' });
  }
});

module.exports = router;
