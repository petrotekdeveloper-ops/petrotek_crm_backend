const mongoose = require('mongoose');
const User = require('../models/users');

const QUOTATION_USER_DESIGNATIONS = ['sales', 'manager', 'service'];

function parseQuotationDate(value) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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

function normalizeRequiredText(value) {
  if (value == null) return null;
  const v = String(value).trim();
  return v === '' ? null : v;
}

function normalizeOptionalText(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

function quotationResponse(doc) {
  return doc.toObject ? doc.toObject() : { ...doc };
}

function parseCustomerDetails(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'customerDetails must be a non-empty array' };
  }
  const customerDetails = [];
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i] || {};
    const name = normalizeRequiredText(row.name);
    if (!name) {
      return { error: `customerDetails[${i}].name is required` };
    }
    customerDetails.push({
      name,
      trn: normalizeOptionalText(row.trn),
      phone: normalizeOptionalText(row.phone),
      mobile: normalizeOptionalText(row.mobile),
      email: normalizeOptionalText(row.email),
      address: normalizeOptionalText(row.address),
    });
  }
  return { customerDetails };
}

function parseQuotationItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'quotationItems must be a non-empty array' };
  }
  const quotationItems = [];
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i] || {};
    const itemCode = normalizeRequiredText(row.itemCode);
    const item = normalizeRequiredText(row.item);
    const itemQuantity = normalizeRequiredText(row.itemQuantity);
    const itemUnitPrice = normalizeRequiredText(row.itemUnitPrice);
    const itemTotalPrice = normalizeRequiredText(row.itemTotalPrice);
    if (!itemCode) {
      return { error: `quotationItems[${i}].itemCode is required` };
    }
    if (!item) {
      return { error: `quotationItems[${i}].item is required` };
    }
    if (!itemQuantity) {
      return { error: `quotationItems[${i}].itemQuantity is required` };
    }
    if (!itemUnitPrice) {
      return { error: `quotationItems[${i}].itemUnitPrice is required` };
    }
    if (!itemTotalPrice) {
      return { error: `quotationItems[${i}].itemTotalPrice is required` };
    }
    quotationItems.push({
      itemCode,
      item,
      itemQuantity,
      itemUnitPrice,
      itemTotalPrice,
    });
  }
  return { quotationItems };
}

function parseQuotationBody(body, { requireSalesUserId = false } = {}) {
  const payload = body || {};
  const date = parseQuotationDate(payload.date);
  if (!date) {
    return { error: 'date is required (YYYY-MM-DD or ISO)' };
  }

  const quoteNo = normalizeRequiredText(payload.quoteNo);
  if (!quoteNo) {
    return { error: 'quoteNo is required' };
  }

  const ref = normalizeRequiredText(payload.ref);
  if (!ref) {
    return { error: 'ref is required' };
  }

  const trn = normalizeRequiredText(payload.trn);
  if (!trn) {
    return { error: 'trn is required' };
  }

  const subTotal = normalizeRequiredText(payload.subTotal);
  if (!subTotal) {
    return { error: 'subTotal is required' };
  }

  const total = normalizeRequiredText(payload.total);
  if (!total) {
    return { error: 'total is required' };
  }

  const totalWords = normalizeRequiredText(payload.totalWords);
  if (!totalWords) {
    return { error: 'totalWords is required' };
  }

  const customerParsed = parseCustomerDetails(payload.customerDetails);
  if (customerParsed.error) {
    return { error: customerParsed.error };
  }

  const itemsParsed = parseQuotationItems(payload.quotationItems);
  if (itemsParsed.error) {
    return { error: itemsParsed.error };
  }

  const data = {
    date,
    quoteNo,
    ref,
    trn,
    customerDetails: customerParsed.customerDetails,
    quotationItems: itemsParsed.quotationItems,
    subTotal,
    total,
    totalWords,
  };

  if (requireSalesUserId) {
    const { salesUserId } = payload;
    if (!salesUserId || !mongoose.isValidObjectId(salesUserId)) {
      return { error: 'salesUserId is required and must be a valid id' };
    }
    data.salesUserId = salesUserId;
  }

  return { data };
}

function applyQuotationUpdates(doc, body) {
  const payload = body || {};

  if (payload.date !== undefined) {
    const date = parseQuotationDate(payload.date);
    if (!date) {
      return { error: 'Invalid date' };
    }
    doc.date = date;
  }

  if (payload.quoteNo !== undefined) {
    const quoteNo = normalizeRequiredText(payload.quoteNo);
    if (!quoteNo) {
      return { error: 'quoteNo is required' };
    }
    doc.quoteNo = quoteNo;
  }

  if (payload.ref !== undefined) {
    const ref = normalizeRequiredText(payload.ref);
    if (!ref) {
      return { error: 'ref is required' };
    }
    doc.ref = ref;
  }

  if (payload.trn !== undefined) {
    const trn = normalizeRequiredText(payload.trn);
    if (!trn) {
      return { error: 'trn is required' };
    }
    doc.trn = trn;
  }

  if (payload.subTotal !== undefined) {
    const subTotal = normalizeRequiredText(payload.subTotal);
    if (!subTotal) {
      return { error: 'subTotal is required' };
    }
    doc.subTotal = subTotal;
  }

  if (payload.total !== undefined) {
    const total = normalizeRequiredText(payload.total);
    if (!total) {
      return { error: 'total is required' };
    }
    doc.total = total;
  }

  if (payload.totalWords !== undefined) {
    const totalWords = normalizeRequiredText(payload.totalWords);
    if (!totalWords) {
      return { error: 'totalWords is required' };
    }
    doc.totalWords = totalWords;
  }

  if (payload.customerDetails !== undefined) {
    const customerParsed = parseCustomerDetails(payload.customerDetails);
    if (customerParsed.error) {
      return { error: customerParsed.error };
    }
    doc.customerDetails = customerParsed.customerDetails;
  }

  if (payload.quotationItems !== undefined) {
    const itemsParsed = parseQuotationItems(payload.quotationItems);
    if (itemsParsed.error) {
      return { error: itemsParsed.error };
    }
    doc.quotationItems = itemsParsed.quotationItems;
  }

  return { ok: true };
}

async function eligibleQuotationUserIds(salesUserId) {
  const q = {
    designation: { $in: QUOTATION_USER_DESIGNATIONS },
    approvalStatus: 'approved',
  };
  if (salesUserId) {
    q._id = salesUserId;
  }
  const users = await User.find(q).select('_id').lean();
  return users.map((u) => u._id);
}

async function assertEligibleQuotationUser(salesUserId) {
  if (!mongoose.isValidObjectId(salesUserId)) {
    return { error: 'Invalid salesUserId' };
  }
  const user = await User.findOne({
    _id: salesUserId,
    designation: { $in: QUOTATION_USER_DESIGNATIONS },
    approvalStatus: 'approved',
  })
    .select('_id designation name phone')
    .lean();
  if (!user) {
    return { error: 'User not found or not eligible for quotations' };
  }
  return { user };
}

function resolveQuotationListFilter(query) {
  const ym = parseYearMonth(query);
  if (ym) {
    const { start, end } = monthUtcRange(ym.year, ym.month);
    return {
      filter: { date: { $gte: start, $lt: end } },
      year: ym.year,
      month: ym.month,
    };
  }
  const date = parseQuotationDate(query?.date);
  if (date) {
    const start = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)
    );
    const end = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0)
    );
    return {
      filter: { date: { $gte: start, $lt: end } },
      date: start,
    };
  }
  return { filter: {} };
}

function parseListLimit(query, { monthScoped = false } = {}) {
  const limitRaw = Number(query?.limit);
  const maxCap = monthScoped ? 500 : 200;
  const fallback = monthScoped ? 500 : 100;
  return Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(maxCap, Math.trunc(limitRaw)))
    : fallback;
}

module.exports = {
  QUOTATION_USER_DESIGNATIONS,
  applyQuotationUpdates,
  assertEligibleQuotationUser,
  eligibleQuotationUserIds,
  monthUtcRange,
  parseListLimit,
  parseQuotationBody,
  parseQuotationDate,
  parseYearMonth,
  quotationResponse,
  resolveQuotationListFilter,
};
