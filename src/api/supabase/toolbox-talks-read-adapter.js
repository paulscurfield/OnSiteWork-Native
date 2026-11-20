const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TOOLBOX_TALK_ROLES = new Set(['owner', 'admin', 'worker']);
const QUESTION_TYPES = new Set(['yes_no_na', 'selection', 'checkbox', 'short_text']);
const ATTENDEE_KINDS = new Set(['member', 'visitor']);
const QUESTION_SCOPES = new Set(['company', 'job', 'one_off']);

const invalidResponse = field => new Error(`Toolbox Talks response contains an invalid ${field}`);

const requiredUuid = (value, field) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) throw invalidResponse(field);
  return value.trim().toLowerCase();
};

const optionalUuid = (value, field) => value === null ? null : requiredUuid(value, field);

const requiredText = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw invalidResponse(field);
  return value.trim();
};

const optionalText = (value, field) => {
  if (value === null) return null;
  if (typeof value !== 'string') throw invalidResponse(field);
  return value.trim() || null;
};

const requiredTimestamp = (value, field) => {
  const timestamp = requiredText(value, field);
  if (Number.isNaN(Date.parse(timestamp))) throw invalidResponse(field);
  return timestamp;
};

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

const normalizeScope = (scope) => {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('An authenticated Toolbox Talks workspace is required');
  }
  const userId = requiredUuid(scope.userId, 'authenticated user');
  const companyId = requiredUuid(scope.companyId, 'active company');
  const jobId = requiredUuid(scope.jobId, 'verified Job');
  if (!TOOLBOX_TALK_ROLES.has(scope.role)) throw new Error('An authorised Toolbox Talks role is required');
  return { userId, companyId, jobId, role: scope.role };
};

const mapSummary = value => {
  const row = requiredObject(value, 'summary');
  if (row.status !== 'completed') throw invalidResponse('status');
  if (!Number.isInteger(row.attendee_count) || row.attendee_count < 0) {
    throw invalidResponse('attendee count');
  }
  return {
    id: requiredUuid(row.id, 'Toolbox Talk ID'),
    local_date: requiredDate(row.local_date, 'local date'),
    status: 'completed',
    conducted_by_name: optionalText(row.conducted_by_name, 'responsible worker'),
    completed_at: requiredTimestamp(row.completed_at, 'completion timestamp'),
    attendee_count: row.attendee_count,
  };
};

const mapSnapshotQuestions = safetyDetails => {
  if (!Object.hasOwn(safetyDetails, 'base44_question_snapshot')) return [];
  return requiredArray(safetyDetails.base44_question_snapshot, 'recorded safety question snapshot')
    .map(value => {
      const item = requiredObject(value, 'recorded safety question');
      if (!Number.isInteger(item.number) || item.number <= 0) throw invalidResponse('recorded safety question number');
      return {
        number: item.number,
        question: requiredText(item.question, 'recorded safety question'),
        answer: optionalText(item.answer, 'recorded safety answer'),
      };
    });
};

export const mapToolboxTalkRecord = (value, expectedScope, expectedTalkId) => {
  const response = requiredObject(value, 'record');
  const talk = requiredObject(response.toolbox_talk, 'record header');
  const id = requiredUuid(talk.id, 'Toolbox Talk ID');
  const companyId = requiredUuid(talk.company_id, 'company ID');
  const jobId = requiredUuid(talk.job_id, 'Job ID');
  if (id !== expectedTalkId || companyId !== expectedScope.companyId || jobId !== expectedScope.jobId) {
    throw new Error('Toolbox Talks response crossed the authorised company, Job, or record scope');
  }
  if (talk.status !== 'completed') throw invalidResponse('completed status');

  const safetyDetails = requiredObject(talk.safety_details, 'safety details');
  const attendees = requiredArray(response.attendees, 'attendees').map(value => {
    const row = requiredObject(value, 'attendee');
    const kind = requiredText(row.kind, 'attendee kind');
    if (!ATTENDEE_KINDS.has(kind)) throw invalidResponse('attendee kind');
    return {
      id: requiredUuid(row.id, 'attendee ID'),
      member_user_id: optionalUuid(row.member_user_id, 'attendee member ID'),
      name: requiredText(row.name, 'attendee name'),
      kind,
    };
  });
  const equipment = requiredArray(response.equipment, 'planned equipment').map(value => {
    const row = requiredObject(value, 'planned equipment');
    return {
      id: requiredUuid(row.id, 'planned equipment row ID'),
      equipment_id: optionalUuid(row.equipment_id, 'equipment ID'),
      name: requiredText(row.name, 'equipment name'),
      identifier: requiredText(row.identifier, 'equipment identifier'),
      category: optionalText(row.category, 'equipment category'),
      operator_user_id: optionalUuid(row.operator_user_id, 'operator ID'),
      operator_name: optionalText(row.operator_name, 'operator name'),
    };
  });
  const questions = requiredArray(response.questions, 'questions').map(value => {
    const row = requiredObject(value, 'question');
    const sourceScope = requiredText(row.source_scope, 'question source');
    const questionType = requiredText(row.question_type, 'question type');
    if (!QUESTION_SCOPES.has(sourceScope) || !QUESTION_TYPES.has(questionType)) {
      throw invalidResponse('question contract');
    }
    return {
      id: requiredUuid(row.id, 'question ID'),
      source_scope: sourceScope,
      question_text: requiredText(row.question_text, 'question text'),
      question_type: questionType,
      is_required: row.is_required === true,
      answer: row.answer ?? null,
    };
  });

  return {
    id,
    company_id: companyId,
    job_id: jobId,
    local_date: requiredDate(talk.local_date, 'local date'),
    local_timezone: requiredText(talk.local_timezone, 'local timezone'),
    status: 'completed',
    job_name: requiredText(talk.job_name_snapshot, 'Job name'),
    job_number: requiredText(talk.job_number_snapshot, 'Job number'),
    job_address: optionalText(talk.job_address_snapshot, 'Job address'),
    conducted_by_name: optionalText(talk.conducted_by_name, 'responsible worker'),
    completed_at: requiredTimestamp(talk.completed_at, 'completion timestamp'),
    safety_questions: mapSnapshotQuestions(safetyDetails),
    attendees,
    equipment,
    questions,
  };
};

const mapListResponse = value => {
  const response = requiredObject(value, 'list');
  if (response.page_size !== 20) throw invalidResponse('page size');
  const talks = requiredArray(response.toolbox_talks, 'list').map(mapSummary);
  for (let index = 1; index < talks.length; index += 1) {
    if (Date.parse(talks[index].completed_at) > Date.parse(talks[index - 1].completed_at)) {
      throw invalidResponse('newest-first ordering');
    }
  }
  return talks;
};

export const createToolboxTalksReadAdapter = (rpc) => {
  if (typeof rpc !== 'function') throw new Error('A Supabase RPC client is required');

  return {
    async list(scope) {
      const normalized = normalizeScope(scope);
      const { data, error } = await rpc('list_job_toolbox_talks', {
        p_company_id: normalized.companyId,
        p_job_id: normalized.jobId,
        p_before_completed_at: null,
        p_before_id: null,
      });
      if (error) throw error;
      return mapListResponse(data);
    },

    async get(scope, toolboxTalkId) {
      const normalized = normalizeScope(scope);
      const normalizedTalkId = requiredUuid(toolboxTalkId, 'Toolbox Talk ID');
      const { data, error } = await rpc('get_toolbox_talk', {
        p_company_id: normalized.companyId,
        p_toolbox_talk_id: normalizedTalkId,
      });
      if (error) throw error;
      return mapToolboxTalkRecord(data, normalized, normalizedTalkId);
    },
  };
};
