const Enquiry = require('../models/enquiry');
const User = require('../models/users');
const { parseListLimit, parseYearMonth, monthUtcRange } = require('./quotationHelpers');

const ENQUIRY_ENUMS = {
  leadSource: [
    'Email',
    'WhatsApp',
    'Walk-in',
    'Referral',
    'Website',
    'Chatbot',
    'Phone',
    'Existing Customer',
  ],
  leadType: ['New', 'Repeat', 'Existing', 'Project'],
  status: [
    'Open',
    'Follow Up',
    'Quoted',
    'Negotiation',
    'Offer Sent',
    'Won',
    'Lost',
    'Hold',
    'Closed-No Business',
  ],
  priority: ['High', 'Medium', 'Low'],
};

const CLOSED_STATUSES = ['Won', 'Lost', 'Closed-No Business'];

function companyToSerialPrefix(company) {
  return String(company || '').trim().toLowerCase() === 'seltec' ? 'ST' : 'PT';
}

/** DDMM from enquiry date, e.g. 29 June → "2906". */
function formatSerialDateKey(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${day}${month}`;
}

async function generateSerialNo({ company, dateReceived }) {
  const prefix = companyToSerialPrefix(company);
  const dateKey = formatSerialDateKey(dateReceived);
  if (!dateKey) {
    throw new Error('Invalid dateReceived for serial number');
  }

  const pattern = new RegExp(`^${prefix}-${dateKey}-(\\d{3})$`);
  const rows = await Enquiry.find({ serialNo: { $regex: `^${prefix}-${dateKey}-` } })
    .select('serialNo')
    .lean();

  let max = 0;
  for (const row of rows) {
    const match = String(row.serialNo || '').match(pattern);
    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }

  return `${prefix}-${dateKey}-${String(max + 1).padStart(3, '0')}`;
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

function parseDate(value) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseOptionalNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseBoolean(value) {
  if (value === true || value === 'true' || value === 'yes' || value === 'Yes') return true;
  if (value === false || value === 'false' || value === 'no' || value === 'No') return false;
  return null;
}

function isClosedStatus(status) {
  return CLOSED_STATUSES.includes(status);
}

function validateEnumField(field, value, { required = false } = {}) {
  const allowed = ENQUIRY_ENUMS[field] || [];
  if (value == null || value === '') {
    return required ? { error: `${field} is required` } : { value: '' };
  }
  if (!allowed.includes(value)) {
    return { error: `Invalid ${field}` };
  }
  return { value };
}

function computeDaysOpen(dateReceived, closedDate) {
  if (!dateReceived) return null;
  const start = new Date(dateReceived);
  const end = closedDate ? new Date(closedDate) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function enquiryResponse(doc) {
  const o = doc.toObject ? doc.toObject() : { ...doc };
  o.daysOpen = computeDaysOpen(o.dateReceived, o.closedDate);
  return o;
}

function validateConditionalFields(data, { isUpdate = false } = {}) {
  const { status } = data;

  if (status === 'Quoted' || status === 'Offer Sent') {
    if (!data.offerNo) return { error: 'offerNo is required when status is Quoted or Offer Sent' };
    if (data.offeredValueAed == null) {
      return { error: 'offeredValueAed is required when status is Quoted or Offer Sent' };
    }
  }

  if (status === 'Won' && data.orderValueAed == null) {
    return { error: 'orderValueAed is required when status is Won' };
  }

  if ((status === 'Lost' || status === 'Closed-No Business') && !data.reasonLostPending) {
    return { error: 'reasonLostPending is required when status is Lost or Closed-No Business' };
  }

  if (!isUpdate && !data.actionTaken) {
    return { error: 'actionTaken is required' };
  }

  if (!isClosedStatus(status) && !data.nextActionDate) {
    return { error: 'nextActionDate is required for open enquiries' };
  }

  return { ok: true };
}

function parseEnquiryBody(body) {
  const payload = body || {};

  const dateReceived = parseDate(payload.dateReceived);
  if (!dateReceived) {
    return { error: 'dateReceived is required (YYYY-MM-DD or ISO)' };
  }

  const customerCompany = normalizeRequiredText(payload.customerCompany);
  if (!customerCompany) {
    return { error: 'customerCompany is required' };
  }

  const subject = normalizeRequiredText(payload.subject);
  if (!subject) {
    return { error: 'subject is required' };
  }

  const leadSourceCheck = validateEnumField(
    'leadSource',
    normalizeRequiredText(payload.leadSource),
    { required: true }
  );
  if (leadSourceCheck.error) return leadSourceCheck;

  const leadTypeCheck = validateEnumField('leadType', normalizeOptionalText(payload.leadType) || null);
  if (leadTypeCheck.error) return leadTypeCheck;

  const priorityCheck = validateEnumField('priority', normalizeOptionalText(payload.priority) || null);
  if (priorityCheck.error) return priorityCheck;

  const statusCheck = validateEnumField('status', normalizeRequiredText(payload.status), {
    required: true,
  });
  if (statusCheck.error) return statusCheck;

  const nextActionDate = parseDate(payload.nextActionDate);
  const actionTaken = normalizeRequiredText(payload.actionTaken);
  const closedDate = parseDate(payload.closedDate);
  const offerDate = parseDate(payload.offerDate);
  const expectedClosureDate = parseDate(payload.expectedClosureDate);

  const convertedRaw = parseBoolean(payload.converted);
  const converted = convertedRaw == null ? false : convertedRaw;

  const data = {
    dateReceived,
    customerCompany,
    contactPerson: normalizeOptionalText(payload.contactPerson),
    sourceContact: normalizeOptionalText(payload.sourceContact),
    subject,
    leadSource: leadSourceCheck.value,
    leadType: leadTypeCheck.value,
    priority: priorityCheck.value,
    status: statusCheck.value,
    closedDate: isClosedStatus(statusCheck.value) ? closedDate || new Date() : null,
    itemProduct: normalizeOptionalText(payload.itemProduct),
    qty: parseOptionalNumber(payload.qty),
    unit: normalizeOptionalText(payload.unit),
    stockPosition: normalizeOptionalText(payload.stockPosition),
    avgMonthlyMovement: parseOptionalNumber(payload.avgMonthlyMovement),
    offerNo: normalizeOptionalText(payload.offerNo),
    offerDate,
    offeredValueAed: parseOptionalNumber(payload.offeredValueAed),
    orderValueAed: parseOptionalNumber(payload.orderValueAed),
    expectedClosureDate,
    nextActionDate,
    actionTaken: actionTaken || '',
    reasonLostPending: normalizeOptionalText(payload.reasonLostPending),
    converted: statusCheck.value === 'Won' ? true : converted,
    managerReview: normalizeOptionalText(payload.managerReview),
  };

  const conditional = validateConditionalFields(data);
  if (conditional.error) return conditional;

  return { data };
}

function applyEnquiryUpdates(doc, body) {
  const parsed = parseEnquiryBody({
    dateReceived: body.dateReceived ?? doc.dateReceived,
    customerCompany: body.customerCompany ?? doc.customerCompany,
    contactPerson: body.contactPerson ?? doc.contactPerson,
    sourceContact: body.sourceContact ?? doc.sourceContact,
    subject: body.subject ?? doc.subject,
    leadSource: body.leadSource ?? doc.leadSource,
    leadType: body.leadType ?? doc.leadType,
    priority: body.priority ?? doc.priority,
    status: body.status ?? doc.status,
    closedDate: body.closedDate ?? doc.closedDate,
    itemProduct: body.itemProduct ?? doc.itemProduct,
    qty: body.qty !== undefined ? body.qty : doc.qty,
    unit: body.unit ?? doc.unit,
    stockPosition: body.stockPosition ?? doc.stockPosition,
    avgMonthlyMovement:
      body.avgMonthlyMovement !== undefined ? body.avgMonthlyMovement : doc.avgMonthlyMovement,
    offerNo: body.offerNo ?? doc.offerNo,
    offerDate: body.offerDate ?? doc.offerDate,
    offeredValueAed:
      body.offeredValueAed !== undefined ? body.offeredValueAed : doc.offeredValueAed,
    orderValueAed: body.orderValueAed !== undefined ? body.orderValueAed : doc.orderValueAed,
    expectedClosureDate: body.expectedClosureDate ?? doc.expectedClosureDate,
    nextActionDate: body.nextActionDate ?? doc.nextActionDate,
    actionTaken: body.actionTaken ?? doc.actionTaken,
    reasonLostPending: body.reasonLostPending ?? doc.reasonLostPending,
    converted: body.converted !== undefined ? body.converted : doc.converted,
    managerReview: body.managerReview ?? doc.managerReview,
  });

  if (parsed.error) return parsed;

  Object.assign(doc, parsed.data);
  return { ok: true };
}

function resolveEnquiryListFilter(query) {
  const ym = parseYearMonth(query);
  if (ym) {
    const { start, end } = monthUtcRange(ym.year, ym.month);
    return {
      filter: { dateReceived: { $gte: start, $lt: end } },
      year: ym.year,
      month: ym.month,
    };
  }
  return { filter: {} };
}

function buildEnquiryQueryFilters(query) {
  const resolved = resolveEnquiryListFilter(query);
  const filter = { ...resolved.filter };

  const status = normalizeRequiredText(query?.status);
  if (status) {
    filter.status = status;
  }

  const search = normalizeRequiredText(query?.search);
  if (search) {
    const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { customerCompany: re },
      { itemProduct: re },
      { serialNo: re },
      { subject: re },
    ];
  }

  return { filter, resolved };
}

function filterDueTodayRows(rows) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return rows.filter((row) => {
    if (isClosedStatus(row.status)) return false;
    if (!row.nextActionDate) return false;
    const next = new Date(row.nextActionDate);
    return next >= today && next < tomorrow;
  });
}

/** Manager + approved sales reps reporting to this manager. */
async function managerTeamCreatorIds(managerId) {
  const team = await User.find({
    managerId,
    designation: 'sales',
    approvalStatus: 'approved',
  })
    .select('_id')
    .lean();

  return [managerId, ...team.map((u) => u._id)];
}

function isCreatorInTeam(createdBy, teamCreatorIds) {
  const id = String(createdBy?._id || createdBy);
  return teamCreatorIds.some((teamId) => String(teamId) === id);
}

module.exports = {
  ENQUIRY_ENUMS,
  applyEnquiryUpdates,
  buildEnquiryQueryFilters,
  computeDaysOpen,
  enquiryResponse,
  filterDueTodayRows,
  generateSerialNo,
  companyToSerialPrefix,
  isClosedStatus,
  isCreatorInTeam,
  managerTeamCreatorIds,
  parseEnquiryBody,
  parseListLimit,
};
