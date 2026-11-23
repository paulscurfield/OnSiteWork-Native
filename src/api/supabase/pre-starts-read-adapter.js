const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRE_START_STATUSES = new Set(['draft', 'submitted']);
const SAFETY_STATUSES = new Set(['pending', 'safe', 'attention_required', 'stood_down']);
const RESPONSE_TYPES = new Set(['whole_number', 'single_choice', 'long_text']);
const FAULT_SEVERITIES = new Set(['minor', 'serious']);
const FAULT_STATUSES = new Set(['awaiting_assessment', 'acknowledged', 'under_repair', 'awaiting_clearance', 'cleared']);
const NOTIFICATION_TARGETS = new Set(['management', 'mechanic_or_supervisor']);
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PHOTO_STATUSES = new Set(['pending', 'available']);

const invalidResponse = field => new Error(`Pre-Start response contains an invalid ${field}`);
const requiredObject = (value, field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse(field);
  return value;
};
const requiredArray = (value, field) => {
  if (!Array.isArray(value)) throw invalidResponse(field);
  return value;
};
const requiredText = (value, field, { allowEmpty = false } = {}) => {
  if (typeof value !== 'string') throw invalidResponse(field);
  const text = value.trim();
  if (!allowEmpty && !text) throw invalidResponse(field);
  return text;
};
const optionalText = (value, field) => value === null ? null : requiredText(value, field, { allowEmpty: true }) || null;
const requiredUuid = (value, field) => {
  const id = requiredText(value, field);
  if (!UUID_PATTERN.test(id)) throw invalidResponse(field);
  return id.toLowerCase();
};
const optionalUuid = (value, field) => value === null ? null : requiredUuid(value, field);
const requiredTimestamp = (value, field) => {
  const timestamp = requiredText(value, field);
  if (Number.isNaN(Date.parse(timestamp))) throw invalidResponse(field);
  return timestamp;
};
const optionalTimestamp = (value, field) => value === null ? null : requiredTimestamp(value, field);
const requiredDate = (value, field) => {
  const date = requiredText(value, field);
  if (!DATE_PATTERN.test(date)) throw invalidResponse(field);
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw invalidResponse(field);
  }
  return date;
};
const nonnegativeInteger = (value, field) => {
  if (!Number.isInteger(value) || value < 0) throw invalidResponse(field);
  return value;
};
const strictBoolean = (value, field) => {
  if (typeof value !== 'boolean') throw invalidResponse(field);
  return value;
};
const enumValue = (value, values, field) => {
  const result = requiredText(value, field);
  if (!values.has(result)) throw invalidResponse(field);
  return result;
};

const normalizeScope = scope => {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('An authenticated Pre-Start workspace is required');
  }
  const userId = requiredUuid(scope.userId, 'authenticated user');
  const companyId = requiredUuid(scope.companyId, 'active company');
  const equipmentId = requiredUuid(scope.equipmentId, 'selected equipment');
  if (scope.role !== 'owner' && scope.role !== 'admin') {
    throw Object.assign(new Error('Only an active Owner or Admin can read company Pre-Start history'), { code: '42501' });
  }
  return { userId, companyId, equipmentId, role: scope.role };
};

const mapSummary = (value, scope) => {
  const row = requiredObject(value, 'history item');
  const companyId = requiredUuid(row.company_id, 'company ID');
  const equipmentId = requiredUuid(row.equipment_id, 'equipment ID');
  if (companyId !== scope.companyId || equipmentId !== scope.equipmentId) {
    throw new Error('Pre-Start history crossed the authorised company or Equipment scope');
  }
  const category = requiredText(row.equipment_category, 'equipment category');
  if (category !== 'machinery' && category !== 'vehicle') throw invalidResponse('equipment category');
  const status = enumValue(row.status, PRE_START_STATUSES, 'inspection status');
  const submittedAt = optionalTimestamp(row.submitted_at, 'submission timestamp');
  if ((status === 'draft' && submittedAt !== null) || (status === 'submitted' && submittedAt === null)) {
    throw invalidResponse('inspection lifecycle');
  }
  return {
    id: requiredUuid(row.id, 'inspection ID'),
    company_id: companyId,
    equipment_id: equipmentId,
    equipment_name: requiredText(row.equipment_name, 'equipment name'),
    equipment_identifier: requiredText(row.equipment_identifier, 'equipment identifier'),
    equipment_category: category,
    inspector_display_name: requiredText(row.inspector_display_name, 'inspector name'),
    local_date: requiredDate(row.local_date, 'inspection date'),
    status,
    safety_status: enumValue(row.safety_status, SAFETY_STATUSES, 'safety status'),
    is_primary: strictBoolean(row.is_primary, 'primary flag'),
    job_id: optionalUuid(row.job_id, 'Job ID'),
    submitted_at: submittedAt,
    updated_at: requiredTimestamp(row.updated_at, 'updated timestamp'),
    fault_count: nonnegativeInteger(row.fault_count, 'fault count'),
    open_fault_count: nonnegativeInteger(row.open_fault_count, 'open fault count'),
  };
};

const mapDraftAnswers = value => {
  const answers = requiredObject(value, 'draft answers');
  return Object.fromEntries(Object.entries(answers).map(([questionId, entry]) => {
    const normalizedQuestionId = requiredUuid(questionId, 'draft question ID');
    const row = requiredObject(entry, 'draft answer');
    const answer = requiredText(row.answer ?? '', 'draft answer value', { allowEmpty: true });
    const naReason = row.naReason === undefined
      ? row.na_reason === undefined ? null : optionalText(row.na_reason, 'draft N/A reason')
      : optionalText(row.naReason, 'draft N/A reason');
    const faultDescription = row.faultDescription === undefined
      ? row.fault_description === undefined ? null : optionalText(row.fault_description, 'draft fault description')
      : optionalText(row.faultDescription, 'draft fault description');
    const notified = row.notified === undefined || row.notified === null
      ? null
      : strictBoolean(row.notified, 'draft notification answer');
    return [normalizedQuestionId, { answer, na_reason: naReason, fault_description: faultDescription, notified }];
  }));
};

const mapQuestion = (value, field = 'template question') => {
  const row = requiredObject(value, field);
  const options = requiredArray(row.options, `${field} options`).map(option => requiredText(option, `${field} option`));
  if (new Set(options).size !== options.length) throw invalidResponse(`${field} options`);
  return {
    id: requiredUuid(row.id, `${field} ID`),
    stable_key: requiredText(row.stable_key, `${field} stable key`),
    display_order: nonnegativeInteger(row.display_order, `${field} display order`),
    prompt: requiredText(row.prompt, `${field} prompt`),
    response_type: enumValue(row.response_type, RESPONSE_TYPES, `${field} response type`),
    options,
    is_required: strictBoolean(row.is_required, `${field} required flag`),
    allows_na: strictBoolean(row.allows_na, `${field} N/A flag`),
  };
};

const mapSubmittedAnswer = value => {
  const row = requiredObject(value, 'submitted answer');
  const snapshot = requiredObject(row.question, 'submitted question snapshot');
  const responseType = enumValue(snapshot.response_type, RESPONSE_TYPES, 'submitted response type');
  const answerPayload = row.answer && typeof row.answer === 'object' && !Array.isArray(row.answer)
    ? requiredObject(row.answer, 'submitted answer value').answer
    : row.answer;
  return {
    question_id: requiredUuid(row.question_id, 'submitted question ID'),
    display_order: nonnegativeInteger(snapshot.display_order, 'submitted question order'),
    prompt: requiredText(snapshot.prompt, 'submitted question prompt'),
    response_type: responseType,
    answer: requiredText(answerPayload ?? '', 'submitted answer value', { allowEmpty: true }),
    na_reason: optionalText(row.na_reason, 'submitted N/A reason'),
  };
};

const mapFault = value => {
  const row = requiredObject(value, 'fault');
  return {
    id: requiredUuid(row.id, 'fault ID'),
    question_id: requiredUuid(row.question_id, 'fault question ID'),
    severity: enumValue(row.severity, FAULT_SEVERITIES, 'fault severity'),
    status: enumValue(row.status, FAULT_STATUSES, 'fault status'),
    description: requiredText(row.description, 'fault description'),
    notification_target: enumValue(row.notification_target, NOTIFICATION_TARGETS, 'fault notification target'),
    notified: strictBoolean(row.notified, 'fault notification flag'),
    created_at: requiredTimestamp(row.created_at, 'fault creation timestamp'),
  };
};

const mapInspection = (value, scope, inspectionId) => {
  const row = requiredObject(value, 'inspection');
  const id = requiredUuid(row.id, 'inspection ID');
  const companyId = requiredUuid(row.company_id, 'company ID');
  const equipmentId = requiredUuid(row.equipment_id, 'equipment ID');
  if (id !== inspectionId || companyId !== scope.companyId || equipmentId !== scope.equipmentId) {
    throw new Error('Pre-Start detail crossed the authorised company, Equipment, or inspection scope');
  }
  const status = enumValue(row.status, PRE_START_STATUSES, 'inspection status');
  const submittedAt = optionalTimestamp(row.submitted_at, 'submission timestamp');
  if ((status === 'draft' && submittedAt !== null) || (status === 'submitted' && submittedAt === null)) {
    throw invalidResponse('inspection lifecycle');
  }
  const answers = requiredArray(row.answers, 'submitted answers').map(mapSubmittedAnswer)
    .sort((left, right) => left.display_order - right.display_order);
  const faults = requiredArray(row.faults, 'faults').map(mapFault);
  const questionIds = new Set(answers.map(answer => answer.question_id));
  if (status === 'submitted' && faults.some(fault => !questionIds.has(fault.question_id))) {
    throw invalidResponse('fault question association');
  }
  return {
    id,
    company_id: companyId,
    equipment_id: equipmentId,
    inspector_id: requiredUuid(row.inspector_id, 'inspector ID'),
    job_id: optionalUuid(row.job_id, 'Job ID'),
    local_date: requiredDate(row.local_date, 'inspection date'),
    inspected_at: requiredTimestamp(row.inspected_at, 'inspection timestamp'),
    is_primary: strictBoolean(row.is_primary, 'primary flag'),
    exceptional_reinspection_reason: optionalText(row.exceptional_reinspection_reason, 'reinspection reason'),
    status,
    safety_status: enumValue(row.safety_status, SAFETY_STATUSES, 'safety status'),
    revision: nonnegativeInteger(row.revision, 'revision'),
    draft_answers: status === 'draft' ? mapDraftAnswers(row.draft_answers) : {},
    submitted_at: submittedAt,
    submitted_by_id: optionalUuid(row.submitted_by_id, 'submitter ID'),
    answers,
    faults,
  };
};

export const mapPreStartDetail = (value, scope, expectedInspectionId) => {
  const response = requiredObject(value, 'detail');
  const inspection = mapInspection(response.inspection, scope, expectedInspectionId);
  const equipment = requiredObject(response.equipment, 'detail equipment');
  const equipmentId = requiredUuid(equipment.id, 'detail equipment ID');
  if (equipmentId !== scope.equipmentId) throw new Error('Pre-Start detail contained mismatched Equipment');
  const category = requiredText(equipment.category, 'detail equipment category');
  if (category !== 'machinery' && category !== 'vehicle') throw invalidResponse('detail equipment category');
  const questions = requiredArray(response.template_questions, 'template questions').map(entry => mapQuestion(entry))
    .sort((left, right) => left.display_order - right.display_order);
  const questionIds = new Set(questions.map(question => question.id));
  if (new Set(questions.map(question => question.display_order)).size !== questions.length) {
    throw invalidResponse('template question ordering');
  }
  if (inspection.status === 'draft' && Object.keys(inspection.draft_answers).some(id => !questionIds.has(id))) {
    throw invalidResponse('draft question association');
  }
  return {
    inspection,
    equipment: {
      id: equipmentId,
      name: requiredText(equipment.name, 'detail equipment name'),
      identifier: requiredText(equipment.identifier, 'detail equipment identifier'),
      category,
    },
    inspector_display_name: requiredText(response.inspector_display_name, 'inspector name'),
    submitted_by_display_name: optionalText(response.submitted_by_display_name, 'submitter name'),
    template_questions: questions,
  };
};

export const mapPreStartPhotoMetadata = (value, detail) => {
  const response = requiredObject(value, 'photo metadata');
  const faultIds = new Set(detail.inspection.faults.map(fault => fault.id));
  return requiredArray(response.photos, 'photo metadata list').map(entry => {
    const row = requiredObject(entry, 'photo metadata item');
    const faultId = requiredUuid(row.fault_id, 'photo fault ID');
    if (!faultIds.has(faultId)) throw new Error('Pre-Start photo metadata crossed the selected inspection fault scope');
    return {
      photo_id: requiredUuid(row.photo_id, 'photo ID'),
      fault_id: faultId,
      media_type: enumValue(row.media_type, MEDIA_TYPES, 'photo media type'),
      file_size_bytes: (() => {
        const size = nonnegativeInteger(row.file_size_bytes, 'photo size');
        if (size < 1) throw invalidResponse('photo size');
        return size;
      })(),
      upload_status: enumValue(row.upload_status, PHOTO_STATUSES, 'photo upload status'),
      created_at: requiredTimestamp(row.created_at, 'photo creation timestamp'),
      uploaded_at: optionalTimestamp(row.uploaded_at, 'photo upload timestamp'),
    };
  });
};

export const createPreStartsReadAdapter = rpc => {
  if (typeof rpc !== 'function') throw new Error('A Supabase RPC client is required');

  return {
    async listEquipmentHistory(scope, { cursor = null, status = null, dateFrom = null, dateTo = null } = {}) {
      const normalized = normalizeScope(scope);
      if (status !== null && !PRE_START_STATUSES.has(status)) throw new Error('Pre-Start status filter is invalid');
      const normalizedDateFrom = dateFrom === null ? null : requiredDate(dateFrom, 'start date');
      const normalizedDateTo = dateTo === null ? null : requiredDate(dateTo, 'end date');
      if (normalizedDateFrom && normalizedDateTo && normalizedDateTo < normalizedDateFrom) {
        throw new Error('Pre-Start end date cannot be before start date');
      }
      let normalizedCursor = null;
      if (cursor !== null) {
        const value = requiredObject(cursor, 'history cursor');
        normalizedCursor = {
          localDate: requiredDate(value.localDate, 'cursor date'),
          updatedAt: requiredTimestamp(value.updatedAt, 'cursor timestamp'),
          id: requiredUuid(value.id, 'cursor ID'),
        };
      }
      const { data, error } = await rpc('list_company_pre_start_history_admin_v2', {
        p_company_id: normalized.companyId,
        p_before_date: normalizedCursor?.localDate ?? null,
        p_before_updated_at: normalizedCursor?.updatedAt ?? null,
        p_before_id: normalizedCursor?.id ?? null,
        p_equipment_id: normalized.equipmentId,
        p_status: status,
        p_date_from: normalizedDateFrom,
        p_date_to: normalizedDateTo,
      });
      if (error) throw error;
      const response = requiredObject(data, 'history');
      if (response.page_size !== 20) throw invalidResponse('history page size');
      const items = requiredArray(response.inspections, 'history list').map(item => mapSummary(item, normalized));
      for (let index = 1; index < items.length; index += 1) {
        const previous = items[index - 1];
        const current = items[index];
        if (
          current.local_date > previous.local_date
          || (current.local_date === previous.local_date && current.updated_at > previous.updated_at)
          || (current.local_date === previous.local_date && current.updated_at === previous.updated_at && current.id > previous.id)
        ) throw invalidResponse('history ordering');
      }
      return { items, has_more: items.length === 20 };
    },

    async getEquipmentInspection(scope, inspectionId) {
      const normalized = normalizeScope(scope);
      const normalizedInspectionId = requiredUuid(inspectionId, 'inspection ID');
      const detailResult = await rpc('get_pre_start_inspection_admin', {
        p_company_id: normalized.companyId,
        p_inspection_id: normalizedInspectionId,
      });
      if (detailResult.error) throw detailResult.error;
      const detail = mapPreStartDetail(detailResult.data, normalized, normalizedInspectionId);
      const photoResult = await rpc('list_pre_start_fault_photos', {
        p_company_id: normalized.companyId,
        p_inspection_id: normalizedInspectionId,
      });
      if (photoResult.error) throw photoResult.error;
      return { ...detail, photos: mapPreStartPhotoMetadata(photoResult.data, detail) };
    },
  };
};
