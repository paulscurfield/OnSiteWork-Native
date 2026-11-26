import {
  hoursToHundredths,
  parsePayrollExportResponse,
} from '../../lib/payroll-export-contract.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const ADMIN_ROLES = new Set(['owner', 'admin']);
const HISTORY_KEYS = ['exports', 'next_before_version', 'period_end', 'period_start', 'state'];
const HISTORY_EXPORT_KEYS = [
  'created_at',
  'export_id',
  'has_newer_version',
  'period_timezone',
  'row_count',
  'snapshot_hash',
  'total_hours',
  'version',
  'worker_count',
];

const safeError = (message, code) => Object.assign(new Error(message), { code });
const invalidInput = message => safeError(message, '22023');
const permissionDenied = () => safeError(
  'Owner or Admin access to the active company is required.',
  '42501',
);
const staleContext = () => safeError(
  'The active payroll workspace or pay week changed. Discard this result.',
  'STALE_CONTEXT',
);
const invalidResponse = () => safeError('Payroll export response was invalid', 'INVALID_RESPONSE');
const duplicateCreate = () => safeError(
  'This payroll export request has already been submitted. Use an explicit retry with the same request token.',
  'DUPLICATE_REQUEST',
);
const createInFlight = () => safeError(
  'This payroll export request is already in progress.',
  'REQUEST_IN_FLIGHT',
);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value, expectedKeys) => {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
};

const requiredUuid = (value, field) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw invalidInput(`${field} must be a Supabase UUID.`);
  }
  return value.trim().toLowerCase();
};

const isDateKey = (value) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const requiredDate = (value, field) => {
  if (!isDateKey(value)) {
    throw invalidInput(`${field} must be a valid calendar date.`);
  }
  return value;
};

const addUtcDays = (value, days) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const isTimezone = (value) => {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return false;
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
};

const isTimestamp = value => typeof value === 'string'
  && TIMESTAMP_PATTERN.test(value)
  && isDateKey(value.slice(0, 10))
  && !Number.isNaN(Date.parse(value));

const normalizeContext = (value) => {
  if (!isRecord(value)) throw permissionDenied();
  const userId = requiredUuid(value.userId, 'Authenticated user');
  const companyId = requiredUuid(value.companyId, 'Active company');
  const periodStart = requiredDate(value.periodStart, 'Period start');
  const periodEnd = requiredDate(value.periodEnd, 'Period end');
  if (periodEnd !== addUtcDays(periodStart, 6)) {
    throw invalidInput('The payroll pay week must contain exactly seven days.');
  }
  if (!ADMIN_ROLES.has(value.role) || !Number.isSafeInteger(value.contextVersion) || value.contextVersion < 0) {
    throw permissionDenied();
  }
  return Object.freeze({
    userId,
    companyId,
    role: value.role,
    periodStart,
    periodEnd,
    contextVersion: value.contextVersion,
  });
};

const contextMatches = (expected, candidate) => {
  try {
    const current = normalizeContext(candidate);
    return current.userId === expected.userId
      && current.companyId === expected.companyId
      && current.role === expected.role
      && current.periodStart === expected.periodStart
      && current.periodEnd === expected.periodEnd
      && current.contextVersion === expected.contextVersion;
  } catch {
    return false;
  }
};

const authenticatedUserId = (result) => {
  if (!isRecord(result) || result.error) throw permissionDenied();
  const user = result.data?.user;
  if (!user) throw permissionDenied();
  try {
    return requiredUuid(user.id, 'Authenticated user');
  } catch {
    throw permissionDenied();
  }
};

const normalizeWorkspace = (workspace) => {
  if (!isRecord(workspace) || !ADMIN_ROLES.has(workspace.role)) throw permissionDenied();
  try {
    return {
      companyId: requiredUuid(workspace.companyId, 'Active company'),
      role: workspace.role,
    };
  } catch {
    throw permissionDenied();
  }
};

const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

const parseHistoryExport = (value) => {
  if (
    !isRecord(value)
    || !hasExactKeys(value, HISTORY_EXPORT_KEYS)
    || typeof value.export_id !== 'string'
    || !UUID_PATTERN.test(value.export_id)
    || !positiveInteger(value.version)
    || !isTimestamp(value.created_at)
    || !isTimezone(value.period_timezone)
    || !positiveInteger(value.worker_count)
    || !positiveInteger(value.row_count)
    || typeof value.snapshot_hash !== 'string'
    || !HASH_PATTERN.test(value.snapshot_hash)
    || typeof value.has_newer_version !== 'boolean'
  ) throw invalidResponse();

  let totalHoursHundredths;
  try {
    totalHoursHundredths = hoursToHundredths(value.total_hours);
  } catch {
    throw invalidResponse();
  }

  return Object.freeze({
    exportId: value.export_id.toLowerCase(),
    version: value.version,
    createdAt: value.created_at,
    periodTimezone: value.period_timezone,
    workerCount: value.worker_count,
    rowCount: value.row_count,
    totalHours: value.total_hours,
    totalHoursHundredths,
    snapshotHash: value.snapshot_hash,
    hasNewerVersion: value.has_newer_version,
  });
};

export const parsePayrollExportHistoryResponse = (
  value,
  expectedPeriodStart,
  beforeVersion = null,
  limit = 20,
) => {
  const periodStart = requiredDate(expectedPeriodStart, 'Period start');
  if (
    (beforeVersion !== null && !positiveInteger(beforeVersion))
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 50
    || !isRecord(value)
    || !hasExactKeys(value, HISTORY_KEYS)
    || value.state !== 'ready'
    || value.period_start !== periodStart
    || value.period_end !== addUtcDays(periodStart, 6)
    || !Array.isArray(value.exports)
    || value.exports.length > limit
    || (value.next_before_version !== null && !positiveInteger(value.next_before_version))
  ) throw invalidResponse();

  const exports = Object.freeze(value.exports.map(parseHistoryExport));
  const exportIds = new Set();
  const versions = new Set();

  for (let index = 0; index < exports.length; index += 1) {
    const item = exports[index];
    if (
      exportIds.has(item.exportId)
      || versions.has(item.version)
      || (index > 0 && exports[index - 1].version <= item.version)
      || (beforeVersion !== null && item.version >= beforeVersion)
      || (beforeVersion === null && item.hasNewerVersion !== (index > 0))
      || (beforeVersion !== null && !item.hasNewerVersion)
    ) throw invalidResponse();
    exportIds.add(item.exportId);
    versions.add(item.version);
  }

  if (
    (exports.length === 0 && value.next_before_version !== null)
    || (
      value.next_before_version !== null
      && (
        exports.length !== limit
        || value.next_before_version !== exports.at(-1).version
        || (beforeVersion !== null && value.next_before_version >= beforeVersion)
      )
    )
  ) throw invalidResponse();

  return Object.freeze({
    state: 'ready',
    periodStart: value.period_start,
    periodEnd: value.period_end,
    exports,
    nextBeforeVersion: value.next_before_version,
  });
};

const requestScopeKey = scope => [
  scope.userId,
  scope.companyId,
  scope.periodStart,
  scope.periodEnd,
].join(':');

export const createPayrollExportRequestManager = (generateRequestId = () => globalThis.crypto.randomUUID()) => {
  if (typeof generateRequestId !== 'function') throw new Error('A payroll request UUID generator is required.');
  // This deliberately stores only scoped request UUID metadata in memory. A
  // page reload loses recovery state; durable browser persistence is deferred
  // until a separately reviewed storage lifecycle is approved.
  const requests = new Map();

  return Object.freeze({
    getOrCreate(scopeInput) {
      const scope = normalizeContext(scopeInput);
      const key = requestScopeKey(scope);
      const existing = requests.get(key);
      if (existing) return existing;
      const requestId = requiredUuid(generateRequestId(), 'Payroll request ID');
      const request = Object.freeze({
        requestId,
        userId: scope.userId,
        companyId: scope.companyId,
        periodStart: scope.periodStart,
        periodEnd: scope.periodEnd,
      });
      requests.set(key, request);
      return request;
    },

    clear(scopeInput, expectedRequestId) {
      const scope = normalizeContext(scopeInput);
      const key = requestScopeKey(scope);
      const existing = requests.get(key);
      if (!existing) return false;
      if (expectedRequestId !== undefined && existing.requestId !== expectedRequestId) return false;
      requests.delete(key);
      return true;
    },

    owns(scopeInput, request) {
      if (!isRecord(request)) return false;
      const scope = normalizeContext(scopeInput);
      return requests.get(requestScopeKey(scope)) === request
        && request.userId === scope.userId
        && request.companyId === scope.companyId
        && request.periodStart === scope.periodStart
        && request.periodEnd === scope.periodEnd
        && typeof request.requestId === 'string'
        && UUID_PATTERN.test(request.requestId);
    },
  });
};

const isAuthorizationError = error => (
  error?.code === '28000'
  || error?.code === '42501'
  || /authentication|owner or admin|permission|not authorized|active company/iu.test(error?.message ?? '')
);

const rpcFailure = (error, { create = false } = {}) => {
  if (isAuthorizationError(error)) return permissionDenied();
  if (create && !error?.code) {
    return safeError(
      'The payroll export outcome is uncertain. Retry only with the same request token.',
      'NETWORK_UNCERTAIN',
    );
  }
  if (error?.code === 'P0002') {
    return safeError('The payroll export is unavailable in the active company.', 'P0002');
  }
  if (['22023', '23502', '23505', '23514'].includes(error?.code)) {
    return safeError('The payroll export request was rejected by the server.', error.code);
  }
  return safeError('The payroll export request could not be completed.', 'RPC_FAILED');
};

const rpcData = async (rpc, name, params, options) => {
  let response;
  try {
    response = await rpc(name, params);
  } catch (error) {
    throw rpcFailure(error, options);
  }
  if (!isRecord(response)) throw rpcFailure(null, options);
  if (response.error) throw rpcFailure(response.error, options);
  if (!Object.prototype.hasOwnProperty.call(response, 'data')) throw invalidResponse();
  return response.data;
};

const parseSnapshot = (value, expectedRequestId) => {
  try {
    return parsePayrollExportResponse(value, expectedRequestId);
  } catch {
    throw invalidResponse();
  }
};

export const createPayrollExportAdapter = (
  getUser,
  getWorkspace,
  rpc,
  { requestManager = createPayrollExportRequestManager() } = {},
) => {
  if (
    typeof getUser !== 'function'
    || typeof getWorkspace !== 'function'
    || typeof rpc !== 'function'
    || !requestManager
  ) throw new Error('Supabase payroll authentication, workspace and RPC clients are required.');

  const authorize = async (scope, getCurrentContext) => {
    if (!contextMatches(scope, getCurrentContext())) throw staleContext();
    let workspace;
    let userResult;
    try {
      workspace = normalizeWorkspace(await getWorkspace());
      userResult = await getUser();
    } catch (error) {
      throw rpcFailure(error);
    }
    const userId = authenticatedUserId(userResult);
    if (
      userId !== scope.userId
      || workspace.companyId !== scope.companyId
      || workspace.role !== scope.role
      || !contextMatches(scope, getCurrentContext())
    ) throw permissionDenied();
  };

  const attemptedCreates = new WeakSet();
  const activeCreates = new WeakSet();
  const requestSequences = new Map();

  const sequenceKey = (scope, channel) => [
    requestScopeKey(scope),
    scope.role,
    scope.contextVersion,
    channel,
  ].join(':');

  const nextSequence = (scope, channel) => {
    const key = sequenceKey(scope, channel);
    const sequence = (requestSequences.get(key) ?? 0) + 1;
    requestSequences.set(key, sequence);
    return { key, sequence };
  };

  return Object.freeze({
    forContext(scopeInput, getCurrentContext) {
      const scope = normalizeContext(scopeInput);
      if (typeof getCurrentContext !== 'function') {
        throw new Error('A current payroll context reader is required.');
      }
      const assertCurrentSequence = ({ key, sequence }) => {
        if (requestSequences.get(key) !== sequence || !contextMatches(scope, getCurrentContext())) {
          throw staleContext();
        }
      };

      return Object.freeze({
        prepareCreate() {
          if (!contextMatches(scope, getCurrentContext())) throw staleContext();
          return requestManager.getOrCreate(scope);
        },

        clearCreateRequest(request) {
          if (!requestManager.owns(scope, request)) throw invalidInput('Payroll request token was invalid.');
          return requestManager.clear(scope, request.requestId);
        },

        async create(request, { retry = false } = {}) {
          if (!requestManager.owns(scope, request)) throw invalidInput('Payroll request token was invalid.');
          if (activeCreates.has(request)) throw createInFlight();
          if (attemptedCreates.has(request) && retry !== true) throw duplicateCreate();
          if (retry !== true && retry !== false) throw invalidInput('Payroll retry must be a boolean.');

          activeCreates.add(request);
          attemptedCreates.add(request);
          try {
            await authorize(scope, getCurrentContext);
            const data = await rpcData(rpc, 'create_payroll_export_admin', {
              p_period_date: scope.periodStart,
              p_request_id: request.requestId,
            }, { create: true });
            if (!contextMatches(scope, getCurrentContext())) throw staleContext();
            await authorize(scope, getCurrentContext);
            const response = parseSnapshot(data, request.requestId);
            if (response.periodStart !== scope.periodStart || response.periodEnd !== scope.periodEnd) {
              throw invalidResponse();
            }
            return response;
          } finally {
            activeCreates.delete(request);
          }
        },

        async list({ beforeVersion = null, limit = 20 } = {}) {
          if (beforeVersion !== null && !positiveInteger(beforeVersion)) {
            throw invalidInput('Before version must be a positive integer or null.');
          }
          if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
            throw invalidInput('Payroll history page size must be from 1 through 50.');
          }
          const requestSequence = nextSequence(scope, 'list');
          await authorize(scope, getCurrentContext);
          const data = await rpcData(rpc, 'list_payroll_exports_admin', {
            p_period_start: scope.periodStart,
            p_before_version: beforeVersion,
            p_limit: limit,
          });
          assertCurrentSequence(requestSequence);
          await authorize(scope, getCurrentContext);
          assertCurrentSequence(requestSequence);
          return parsePayrollExportHistoryResponse(data, scope.periodStart, beforeVersion, limit);
        },

        async get(exportIdInput) {
          const exportId = requiredUuid(exportIdInput, 'Payroll export ID');
          const requestSequence = nextSequence(scope, 'get');
          await authorize(scope, getCurrentContext);
          const data = await rpcData(rpc, 'get_payroll_export_admin', {
            p_export_id: exportId,
          });
          assertCurrentSequence(requestSequence);
          await authorize(scope, getCurrentContext);
          assertCurrentSequence(requestSequence);
          const response = parseSnapshot(data);
          if (
            response.state !== 'ready'
            || response.exportId !== exportId
            || response.periodStart !== scope.periodStart
            || response.periodEnd !== scope.periodEnd
          ) throw invalidResponse();
          return response;
        },
      });
    },
  });
};
