const ServiceHeadTarget = require('../models/serviceHeadTarget');
const MonthlyServiceHeadTarget = require('../models/monthlyServiceHeadTarget');

/**
 * Resolve the amount target for a service head.
 * Prefers the global default; falls back to the most recently updated legacy per-month row.
 */
async function resolveServiceHeadTarget(serviceHeadUserId) {
  const defaultDoc = await ServiceHeadTarget.findOne({ serviceHeadUserId }).lean();
  if (defaultDoc) {
    return {
      targetAmount: Number(defaultDoc.targetAmount),
      hasTarget: true,
    };
  }

  const legacyDoc = await MonthlyServiceHeadTarget.findOne({ serviceHeadUserId })
    .sort({ updatedAt: -1 })
    .lean();
  if (legacyDoc) {
    return {
      targetAmount: Number(legacyDoc.targetAmount),
      hasTarget: true,
    };
  }

  return { targetAmount: null, hasTarget: false };
}

/** Load default targets for many service heads in one round trip. */
async function resolveServiceHeadTargets(serviceHeadUserIds) {
  const ids = [...serviceHeadUserIds];
  const result = new Map();
  if (ids.length === 0) return result;

  const [defaultDocs, legacyDocs] = await Promise.all([
    ServiceHeadTarget.find({ serviceHeadUserId: { $in: ids } }).lean(),
    MonthlyServiceHeadTarget.find({ serviceHeadUserId: { $in: ids } })
      .sort({ updatedAt: -1 })
      .lean(),
  ]);

  for (const doc of defaultDocs) {
    result.set(String(doc.serviceHeadUserId), {
      targetAmount: Number(doc.targetAmount),
      hasTarget: true,
    });
  }

  for (const doc of legacyDocs) {
    const key = String(doc.serviceHeadUserId);
    if (!result.has(key)) {
      result.set(key, {
        targetAmount: Number(doc.targetAmount),
        hasTarget: true,
      });
    }
  }

  return result;
}

async function clearLegacyMonthlyTargets(serviceHeadUserId) {
  await MonthlyServiceHeadTarget.deleteMany({ serviceHeadUserId });
}

module.exports = {
  resolveServiceHeadTarget,
  resolveServiceHeadTargets,
  clearLegacyMonthlyTargets,
};
