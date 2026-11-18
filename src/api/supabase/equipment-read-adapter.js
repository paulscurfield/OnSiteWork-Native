const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EQUIPMENT_CATEGORIES = new Set(['machinery', 'tools', 'vehicle', 'safety', 'electrical', 'other']);
const EQUIPMENT_STATUSES = new Set(['available', 'checked_out', 'maintenance']);
const EQUIPMENT_HISTORY_ACTIONS = new Set(['checked_out', 'returned', 'force_returned']);

export const EQUIPMENT_REGISTER_FIELDS = [
  'id',
  'company_id',
  'name',
  'equipment_id',
  'category',
  'status',
  'checked_out_by_id',
  'checked_out_by_name',
  'checked_out_at',
  'notes',
  'requires_pre_start',
  'retired_at',
].join(',');

export const EQUIPMENT_HISTORY_FIELDS = [
  'id',
  'company_id',
  'equipment_id',
  'equipment_name',
  'worker_id',
  'worker_name',
  'action',
  'timestamp',
  'notes',
].join(',');

const invalidEquipment = field => new Error(`Equipment query returned an invalid ${field}`);
const invalidHistory = field => new Error(`Equipment history returned an invalid ${field}`);

const requiredUuid = (value, fieldName) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new Error(`${fieldName} must be a Supabase UUID`);
  }
  return value.trim().toLowerCase();
};

const optionalUuid = (value, fieldName, invalid) => {
  if (value === null) return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) throw invalid(fieldName);
  return value.trim().toLowerCase();
};

const requiredText = (value, fieldName, invalid) => {
  if (typeof value !== 'string' || !value.trim()) throw invalid(fieldName);
  return value.trim();
};

const optionalText = (value, fieldName, invalid) => {
  if (value === null) return null;
  if (typeof value !== 'string') throw invalid(fieldName);
  return value.trim() || null;
};

const optionalTimestamp = (value, fieldName, invalid) => {
  const timestamp = optionalText(value, fieldName, invalid);
  if (timestamp !== null && Number.isNaN(Date.parse(timestamp))) throw invalid(fieldName);
  return timestamp;
};

const requiredTimestamp = (value, fieldName, invalid) => {
  const timestamp = requiredText(value, fieldName, invalid);
  if (Number.isNaN(Date.parse(timestamp))) throw invalid(fieldName);
  return timestamp;
};

export const mapEquipmentRegisterRow = (row, expectedCompanyId) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalidEquipment('item');
  if (row.retired_at !== null) {
    if (typeof row.retired_at !== 'string' || Number.isNaN(Date.parse(row.retired_at))) {
      throw invalidEquipment('retirement time');
    }
    return null;
  }
  if (!EQUIPMENT_CATEGORIES.has(row.category)) throw invalidEquipment('category');
  if (!EQUIPMENT_STATUSES.has(row.status)) throw invalidEquipment('status');
  if (typeof row.requires_pre_start !== 'boolean') throw invalidEquipment('pre-start setting');

  const companyId = requiredUuid(row.company_id, 'company_id');
  if (companyId !== expectedCompanyId) throw new Error('Equipment query returned an item outside the active company');

  return {
    id: requiredUuid(row.id, 'equipment id'),
    company_id: companyId,
    name: requiredText(row.name, 'name', invalidEquipment),
    equipment_id: requiredText(row.equipment_id, 'Equipment ID', invalidEquipment),
    category: row.category,
    status: row.status,
    checked_out_by_id: optionalUuid(row.checked_out_by_id, 'holder ID', invalidEquipment),
    checked_out_by_name: optionalText(row.checked_out_by_name, 'holder', invalidEquipment),
    checked_out_at: optionalTimestamp(row.checked_out_at, 'checkout time', invalidEquipment),
    notes: optionalText(row.notes, 'notes', invalidEquipment),
    requires_pre_start: row.requires_pre_start,
    retired_at: null,
  };
};

export const mapEquipmentHistoryRow = (row, expectedCompanyId) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalidHistory('movement');
  if (!EQUIPMENT_HISTORY_ACTIONS.has(row.action)) throw invalidHistory('action');

  const companyId = requiredUuid(row.company_id, 'company_id');
  if (companyId !== expectedCompanyId) throw new Error('Equipment history returned a movement outside the active company');

  return {
    id: requiredUuid(row.id, 'movement id'),
    company_id: companyId,
    equipment_id: optionalUuid(row.equipment_id, 'Equipment reference ID', invalidHistory),
    equipment_name: optionalText(row.equipment_name, 'Equipment name', invalidHistory),
    worker_id: optionalUuid(row.worker_id, 'worker reference ID', invalidHistory),
    worker_name: optionalText(row.worker_name, 'worker name', invalidHistory),
    action: row.action,
    timestamp: requiredTimestamp(row.timestamp, 'timestamp', invalidHistory),
    notes: optionalText(row.notes, 'notes', invalidHistory),
  };
};

export const createEquipmentReadAdapter = (from) => {
  if (typeof from !== 'function') throw new Error('A Supabase table client is required');

  return {
    async list(companyId) {
      const normalizedCompanyId = requiredUuid(companyId, 'companyId');
      const { data, error } = await from('equipment')
        .select(EQUIPMENT_REGISTER_FIELDS)
        .eq('company_id', normalizedCompanyId)
        .is('retired_at', null)
        .order('name', { ascending: true })
        .order('equipment_id', { ascending: true });

      if (error) throw error;
      if (data !== null && !Array.isArray(data)) throw invalidEquipment('response');
      return (data ?? [])
        .map(row => mapEquipmentRegisterRow(row, normalizedCompanyId))
        .filter(Boolean);
    },

    async get(companyId, equipmentId) {
      const normalizedCompanyId = requiredUuid(companyId, 'companyId');
      const normalizedEquipmentId = requiredUuid(equipmentId, 'equipmentId');
      const { data, error } = await from('equipment')
        .select(EQUIPMENT_REGISTER_FIELDS)
        .eq('company_id', normalizedCompanyId)
        .eq('id', normalizedEquipmentId)
        .is('retired_at', null)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      const item = mapEquipmentRegisterRow(data, normalizedCompanyId);
      if (!item || item.id !== normalizedEquipmentId) throw invalidEquipment('item');
      return item;
    },

    async history({ companyId, userId, role }) {
      const normalizedCompanyId = requiredUuid(companyId, 'companyId');
      const normalizedUserId = requiredUuid(userId, 'userId');
      const normalizedRole = role === 'supervisor' ? 'worker' : role;
      if (!['owner', 'admin', 'worker'].includes(normalizedRole)) {
        throw new Error('role must be owner, admin, or worker');
      }

      let query = from('equipment_logs')
        .select(EQUIPMENT_HISTORY_FIELDS)
        .eq('company_id', normalizedCompanyId);
      if (normalizedRole === 'worker') query = query.eq('worker_id', normalizedUserId);

      const { data, error } = await query
        .order('timestamp', { ascending: false })
        .order('id', { ascending: false })
        .range(0, 24);

      if (error) throw error;
      if (data !== null && !Array.isArray(data)) throw invalidHistory('response');
      const rows = data ?? [];
      return {
        has_more: rows.length === 25,
        items: rows.map(row => mapEquipmentHistoryRow(row, normalizedCompanyId)),
      };
    },
  };
};
