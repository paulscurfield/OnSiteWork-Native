const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SITE_DIARY_ROLES = new Set(['owner', 'admin', 'worker']);
const SITE_DIARY_STATUSES = new Set(['draft', 'completed']);
const WORKER_KINDS = new Set(['manual', 'member', 'visitor']);

const invalidResponse = field => new Error(`Site Diaries response contains an invalid ${field}`);

const requiredUuid = (value, field) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) throw invalidResponse(field);
  return value.trim().toLowerCase();
};

const optionalUuid = (value, field) => value === null ? null : requiredUuid(value, field);

const requiredText = (value, field, { allowEmpty = false } = {}) => {
  if (typeof value !== 'string') throw invalidResponse(field);
  const text = value.trim();
  if (!allowEmpty && !text) throw invalidResponse(field);
  return text;
};

const optionalText = (value, field) => {
  if (value === null) return null;
  return requiredText(value, field, { allowEmpty: true }) || null;
};

const requiredTimestamp = (value, field) => {
  const timestamp = requiredText(value, field);
  if (Number.isNaN(Date.parse(timestamp))) throw invalidResponse(field);
  return timestamp;
};

const optionalTimestamp = (value, field) => value === null ? null : requiredTimestamp(value, field);

const isDateKey = (value) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

const requiredDate = (value, field) => {
  if (!isDateKey(value)) throw invalidResponse(field);
  return value;
};

const requiredObject = (value, field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse(field);
  return value;
};

const requiredArray = (value, field) => {
  if (!Array.isArray(value)) throw invalidResponse(field);
  return value;
};

const nonnegativeInteger = (value, field) => {
  if (!Number.isInteger(value) || value < 0) throw invalidResponse(field);
  return value;
};

const strictBoolean = (value, field) => {
  if (typeof value !== 'boolean') throw invalidResponse(field);
  return value;
};

const normalizeScope = scope => {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('An authenticated Site Diaries workspace is required');
  }
  const userId = requiredUuid(scope.userId, 'authenticated user');
  const companyId = requiredUuid(scope.companyId, 'active company');
  const jobId = requiredUuid(scope.jobId, 'verified Job');
  if (!SITE_DIARY_ROLES.has(scope.role)) throw new Error('An authorised Site Diaries role is required');
  return { userId, companyId, jobId, role: scope.role };
};

const mapStatusLifecycle = row => {
  const status = requiredText(row.status, 'status');
  if (!SITE_DIARY_STATUSES.has(status)) throw invalidResponse('status');
  const submittedById = optionalUuid(row.submitted_by_id, 'submitter ID');
  const completedAt = optionalTimestamp(row.completed_at, 'completion timestamp');
  if (
    (status === 'draft' && (submittedById !== null || completedAt !== null))
    || (status === 'completed' && (submittedById === null || completedAt === null))
  ) throw invalidResponse('status lifecycle');
  return { status, submittedById, completedAt };
};

const mapSummary = value => {
  const row = requiredObject(value, 'summary');
  const status = requiredText(row.status, 'status');
  if (!SITE_DIARY_STATUSES.has(status)) throw invalidResponse('status');
  const completedAt = optionalTimestamp(row.completed_at, 'completion timestamp');
  if (
    (status === 'draft' && completedAt !== null)
    || (status === 'completed' && completedAt === null)
  ) throw invalidResponse('status lifecycle');
  return {
    id: requiredUuid(row.id, 'Site Diary ID'),
    local_date: requiredDate(row.local_date, 'local date'),
    status,
    is_primary: strictBoolean(row.is_primary, 'primary flag'),
    owner_id: requiredUuid(row.owner_id, 'owner ID'),
    completed_at: completedAt,
    revision: nonnegativeInteger(row.revision, 'revision'),
    updated_at: requiredTimestamp(row.updated_at, 'updated timestamp'),
  };
};

const mapSourceTalkIds = (value, field) => {
  if (value === undefined) return [];
  const ids = requiredArray(value, field).map(item => requiredUuid(item, field));
  if (new Set(ids).size !== ids.length) throw invalidResponse(field);
  return ids;
};

const mapWorkerEntry = value => {
  const row = requiredObject(value, 'worker entry');
  const kind = requiredText(row.kind, 'worker kind');
  if (!WORKER_KINDS.has(kind)) throw invalidResponse('worker kind');
  const memberUserId = row.member_user_id === undefined || row.member_user_id === null
    ? null
    : requiredUuid(row.member_user_id, 'worker member ID');
  if ((kind === 'member' && memberUserId === null) || (kind !== 'member' && memberUserId !== null)) {
    throw invalidResponse('worker membership');
  }
  return {
    kind,
    member_user_id: memberUserId,
    display_name: requiredText(row.display_name, 'worker display name'),
    source_toolbox_talk_ids: mapSourceTalkIds(row.source_toolbox_talk_ids, 'worker Toolbox Talk references'),
  };
};

const mapEquipmentEntry = value => {
  const row = requiredObject(value, 'equipment entry');
  return {
    equipment_id: row.equipment_id === undefined || row.equipment_id === null
      ? null
      : requiredUuid(row.equipment_id, 'equipment ID'),
    name: requiredText(row.name, 'equipment name'),
    identifier: requiredText(row.identifier, 'equipment identifier'),
    category: row.category === undefined ? null : optionalText(row.category, 'equipment category'),
    source_toolbox_talk_ids: mapSourceTalkIds(row.source_toolbox_talk_ids, 'equipment Toolbox Talk references'),
  };
};

export const mapSiteDiaryRecord = (value, expectedScope, expectedDiaryId, expectedLocalDate) => {
  const response = requiredObject(value, 'record');
  const row = requiredObject(response.site_diary, 'record header');
  const id = requiredUuid(row.id, 'Site Diary ID');
  const companyId = requiredUuid(row.company_id, 'company ID');
  const jobId = requiredUuid(row.job_id, 'Job ID');
  const localDate = requiredDate(row.local_date, 'local date');
  if (
    id !== expectedDiaryId
    || companyId !== expectedScope.companyId
    || jobId !== expectedScope.jobId
    || localDate !== expectedLocalDate
  ) throw new Error('Site Diaries response crossed the authorised company, Job, date, or record scope');
  if (row.local_timezone !== 'Australia/Sydney') throw invalidResponse('local timezone');

  const lifecycle = mapStatusLifecycle(row);
  const workCompletedToday = requiredText(row.work_completed_today, 'work completed', { allowEmpty: true });
  if (lifecycle.status === 'completed' && workCompletedToday.length < 2) {
    throw invalidResponse('completed work summary');
  }
  const correctedAt = optionalTimestamp(row.corrected_at, 'correction timestamp');
  const correctedById = optionalUuid(row.corrected_by_id, 'corrector ID');
  if ((correctedAt === null) !== (correctedById === null)) throw invalidResponse('correction lifecycle');

  const workers = requiredArray(row.workers_on_site, 'workers on site');
  const equipment = requiredArray(row.equipment_used, 'equipment used');
  if (workers.length > 250 || equipment.length > 250) throw invalidResponse('record entry count');

  return {
    id,
    company_id: companyId,
    job_id: jobId,
    local_date: localDate,
    local_timezone: 'Australia/Sydney',
    status: lifecycle.status,
    is_primary: strictBoolean(row.is_primary, 'primary flag'),
    owner_id: requiredUuid(row.owner_id, 'owner ID'),
    submitted_by_id: lifecycle.submittedById,
    work_completed_today: workCompletedToday,
    weather_conditions: requiredText(row.weather_conditions, 'weather conditions', { allowEmpty: true }),
    workers_on_site: workers.map(mapWorkerEntry),
    equipment_used: equipment.map(mapEquipmentEntry),
    materials_used: requiredText(row.materials_used, 'materials used', { allowEmpty: true }),
    visitors_inspections: requiredText(row.visitors_inspections, 'visitors and inspections', { allowEmpty: true }),
    incidents_near_misses: requiredText(row.incidents_near_misses, 'incidents and near misses', { allowEmpty: true }),
    delays_issues: requiredText(row.delays_issues, 'delays and issues', { allowEmpty: true }),
    general_notes: requiredText(row.general_notes, 'general notes', { allowEmpty: true }),
    toolbox_imported_at: optionalTimestamp(row.toolbox_imported_at, 'Toolbox Talk import timestamp'),
    revision: nonnegativeInteger(row.revision, 'revision'),
    completed_at: lifecycle.completedAt,
    corrected_at: correctedAt,
    corrected_by_id: correctedById,
    created_at: requiredTimestamp(row.created_at, 'created timestamp'),
    updated_at: requiredTimestamp(row.updated_at, 'updated timestamp'),
  };
};

const sydneyDateKey = timestamp => {
  const parts = new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Australia/Sydney',
    year: 'numeric',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const mapDelivery = (value, expectedLocalDate) => {
  const row = requiredObject(value, 'delivery');
  const localDate = requiredDate(row.local_date, 'delivery local date');
  const deliveredAt = requiredTimestamp(row.delivered_at, 'delivery timestamp');
  if (localDate !== expectedLocalDate || sydneyDateKey(deliveredAt) !== expectedLocalDate) {
    throw new Error('Site Diary delivery crossed the selected Australian local date');
  }
  const photoIds = requiredArray(row.photo_ids, 'delivery photo metadata')
    .map(item => requiredUuid(item, 'delivery photo ID'));
  if (new Set(photoIds).size !== photoIds.length) throw invalidResponse('delivery photo metadata');
  return {
    id: requiredUuid(row.id, 'delivery ID'),
    local_date: localDate,
    delivered_at: deliveredAt,
    created_by_id: requiredUuid(row.created_by_id, 'delivery recorder ID'),
    created_by_display_name: requiredText(row.created_by_display_name, 'delivery recorder'),
    item_description: requiredText(row.item_description, 'delivery item'),
    quantity: requiredText(row.quantity, 'delivery quantity'),
    supplier: optionalText(row.supplier, 'delivery supplier'),
    notes: optionalText(row.notes, 'delivery notes'),
    photo_ids: photoIds,
  };
};

export const mapSiteDiaryDeliveries = (value, expectedLocalDate) => {
  const response = requiredObject(value, 'deliveries');
  const deliveries = requiredArray(response.deliveries, 'deliveries')
    .map(item => mapDelivery(item, expectedLocalDate));
  for (let index = 1; index < deliveries.length; index += 1) {
    const previousTime = Date.parse(deliveries[index - 1].delivered_at);
    const currentTime = Date.parse(deliveries[index].delivered_at);
    if (
      currentTime > previousTime
      || (currentTime === previousTime && deliveries[index].id > deliveries[index - 1].id)
    ) {
      throw invalidResponse('delivery ordering');
    }
  }
  return deliveries;
};

const mapListResponse = value => {
  const response = requiredObject(value, 'list');
  if (response.page_size !== 20) throw invalidResponse('page size');
  const diaries = requiredArray(response.site_diaries, 'list').map(mapSummary);
  for (let index = 1; index < diaries.length; index += 1) {
    if (
      diaries[index].local_date > diaries[index - 1].local_date
      || (diaries[index].local_date === diaries[index - 1].local_date && diaries[index].id > diaries[index - 1].id)
    ) throw invalidResponse('newest-first ordering');
  }
  return diaries;
};

export const createSiteDiariesReadAdapter = rpc => {
  if (typeof rpc !== 'function') throw new Error('A Supabase RPC client is required');

  return {
    async list(scope) {
      const normalized = normalizeScope(scope);
      const { data, error } = await rpc('list_job_site_diaries', {
        p_company_id: normalized.companyId,
        p_job_id: normalized.jobId,
        p_before_local_date: null,
        p_before_id: null,
      });
      if (error) throw error;
      return mapListResponse(data);
    },

    async get(scope, siteDiaryId, localDate) {
      const normalized = normalizeScope(scope);
      const normalizedDiaryId = requiredUuid(siteDiaryId, 'Site Diary ID');
      const normalizedLocalDate = requiredDate(localDate, 'Site Diary local date');
      const [recordResult, deliveriesResult] = await Promise.all([
        rpc('get_site_diary', {
          p_company_id: normalized.companyId,
          p_site_diary_id: normalizedDiaryId,
        }),
        rpc('list_site_diary_deliveries_v2', {
          p_company_id: normalized.companyId,
          p_job_id: normalized.jobId,
          p_local_date: normalizedLocalDate,
        }),
      ]);
      if (recordResult.error) throw recordResult.error;
      if (deliveriesResult.error) throw deliveriesResult.error;
      return {
        diary: mapSiteDiaryRecord(recordResult.data, normalized, normalizedDiaryId, normalizedLocalDate),
        deliveries: mapSiteDiaryDeliveries(deliveriesResult.data, normalizedLocalDate),
      };
    },
  };
};
