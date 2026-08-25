import { supabase } from './client';

const orderQuery = (query, orderBy) => {
  if (!orderBy) return query;
  const descending = orderBy.startsWith('-');
  const column = descending ? orderBy.slice(1) : orderBy;
  return query.order(column, { ascending: !descending });
};

const applyFilters = (query, filters = {}) => {
  return Object.entries(filters).reduce((nextQuery, [key, value]) => {
    if (value === undefined) return nextQuery;
    if (value === null) return nextQuery.is(key, null);
    return nextQuery.eq(key, value);
  }, query);
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const JOB_STATUS_VALUES = new Set(['active', 'completed', 'on_hold']);
const LEAVE_TYPE_VALUES = new Set(['annual', 'sick', 'personal', 'other']);
const LEAVE_REVIEW_STATUS_VALUES = new Set(['approved', 'declined']);
const MESSAGE_TYPE_VALUES = new Set(['direct', 'broadcast']);
const ADMIN_MANAGED_MEMBER_ROLE_VALUES = new Set(['admin', 'supervisor', 'worker']);
const EQUIPMENT_CATEGORY_VALUES = new Set(['machinery', 'tools', 'vehicle', 'safety', 'electrical', 'other']);
const EQUIPMENT_ADMIN_STATUS_VALUES = new Set(['available', 'maintenance']);
const AVATARS_BUCKET = 'avatars';
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const EQUIPMENT_PHOTO_BUCKET = 'equipment-photos';
const EQUIPMENT_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
const EQUIPMENT_PHOTO_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const JOB_PHOTOS_BUCKET = 'job-photos';
const SITE_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
const SITE_PHOTO_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const SITE_PHOTO_CLEANUP_WARNING = 'Site Photo record was deleted, but the storage object may remain.';

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const isLeapYear = (year) => {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
};

const toDateOnly = (value, fieldName) => {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a YYYY-MM-DD date string`);
  }
  const match = value.match(DATE_ONLY_PATTERN);
  if (!match) throw new Error(`${fieldName} must be a YYYY-MM-DD date string`);

  const [year, month, day] = value.split('-').map(Number);
  if (year < 1) {
    throw new Error(`${fieldName} must be a valid calendar date`);
  }

  if (month < 1 || month > 12) {
    throw new Error(`${fieldName} must be a valid calendar date`);
  }

  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  if (day < 1 || day > maxDay) {
    throw new Error(`${fieldName} must be a valid calendar date`);
  }

  return value;
};

const optionalId = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const requiredUuid = (value, fieldName) => {
  const id = optionalId(value);
  if (!id) throw new Error(`${fieldName} is required`);
  if (!UUID_PATTERN.test(id)) throw new Error(`${fieldName} must be a Supabase UUID`);
  return id;
};

const optionalUuid = (value, fieldName) => {
  const id = optionalId(value);
  if (!id) return null;
  if (!UUID_PATTERN.test(id)) throw new Error(`${fieldName} must be a Supabase UUID`);
  return id;
};

const optionalText = (value) => {
  if (value === undefined) return undefined;
  return optionalId(value);
};

const requiredText = (value, fieldName) => {
  const trimmed = optionalId(value);
  if (!trimmed) throw new Error(`${fieldName} is required`);
  return trimmed;
};

const normalizeAuthEmail = (value) => {
  const email = requiredText(value, 'email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid email address is required');
  }
  return email;
};

const normalizeAuthRedirectTo = (value) => {
  const redirectTo = requiredText(value, 'redirectTo');
  let parsed;

  try {
    parsed = new URL(redirectTo);
  } catch (_error) {
    throw new Error('A valid redirect URL is required');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('A valid redirect URL is required');
  }

  if (parsed.username || parsed.password) {
    throw new Error('A valid redirect URL is required');
  }

  if (typeof window !== 'undefined' && parsed.origin !== window.location.origin) {
    throw new Error('Redirect URL must use this app origin');
  }

  return parsed.toString();
};

const optionalNumber = (value, fieldName) => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) throw new Error(`${fieldName} must be a valid number`);
  return numberValue;
};

const optionalTimestamp = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return String(value).trim();
};

const requiredTimestamp = (value, fieldName) => {
  const timestamp = optionalTimestamp(value);
  if (!timestamp) throw new Error(`${fieldName} is required`);
  return timestamp;
};

const nullableNumberParam = (value, fieldName) => optionalNumber(value, fieldName) ?? null;

const lunchBreakParam = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return 0;
  return optionalNumber(value, 'lunch_break_mins');
};

const normalizeJobStatus = (value, fallback) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (fallback !== undefined) return fallback;
    throw new Error('Job status must be active, completed, or on_hold');
  }
  const status = String(value).trim();
  if (!JOB_STATUS_VALUES.has(status)) {
    throw new Error('Job status must be active, completed, or on_hold');
  }
  return status;
};

const normalizeJobsOrderBy = (orderBy) => {
  if (!orderBy) return orderBy;
  const descending = orderBy.startsWith('-');
  const column = descending ? orderBy.slice(1) : orderBy;
  const mappedColumn = column === 'created_date'
    ? 'created_at'
    : column === 'updated_date'
      ? 'updated_at'
      : column;
  return `${descending ? '-' : ''}${mappedColumn}`;
};

const mapJobRow = (job = {}) => ({
  ...job,
  created_date: job.created_date ?? job.created_at,
  updated_date: job.updated_date ?? job.updated_at,
});

const normalizeJobCreateValues = (values = {}) => {
  const companyId = optionalId(values.company_id);
  if (!companyId) throw new Error('company_id is required');

  return {
    company_id: companyId,
    job_name: requiredText(values.job_name, 'job_name'),
    job_number: requiredText(values.job_number, 'job_number'),
    location_address: optionalText(values.location_address) ?? null,
    latitude: optionalNumber(values.latitude, 'latitude') ?? null,
    longitude: optionalNumber(values.longitude, 'longitude') ?? null,
    notes: optionalText(values.notes) ?? null,
    status: normalizeJobStatus(values.status, 'active'),
  };
};

const normalizeJobUpdateValues = (values = {}) => {
  const updateValues = {};

  if (hasOwn(values, 'job_name')) {
    updateValues.job_name = requiredText(values.job_name, 'job_name');
  }
  if (hasOwn(values, 'job_number')) {
    updateValues.job_number = requiredText(values.job_number, 'job_number');
  }
  if (hasOwn(values, 'location_address')) {
    updateValues.location_address = optionalText(values.location_address) ?? null;
  }
  if (hasOwn(values, 'latitude')) {
    updateValues.latitude = optionalNumber(values.latitude, 'latitude') ?? null;
  }
  if (hasOwn(values, 'longitude')) {
    updateValues.longitude = optionalNumber(values.longitude, 'longitude') ?? null;
  }
  if (hasOwn(values, 'notes')) {
    updateValues.notes = optionalText(values.notes) ?? null;
  }
  if (hasOwn(values, 'status')) {
    updateValues.status = normalizeJobStatus(values.status);
  }

  return updateValues;
};

const assignmentUserId = (value) => {
  if (value && typeof value === 'object') {
    return value.user_id ?? value.worker_id;
  }
  return value;
};

const scheduleAssignmentInput = (values = {}) => {
  if (hasOwn(values, 'assigned_user_ids') && values.assigned_user_ids !== undefined) {
    return values.assigned_user_ids;
  }
  if (hasOwn(values, 'assignments') && values.assignments !== undefined) {
    return values.assignments;
  }
  if (hasOwn(values, 'assigned_workers') && values.assigned_workers !== undefined) {
    return values.assigned_workers;
  }
  if (hasOwn(values, 'worker_ids') && values.worker_ids !== undefined) {
    return values.worker_ids;
  }
  return undefined;
};

const hasScheduleAssignmentInput = (values = {}) => {
  return (
    (hasOwn(values, 'assigned_user_ids') && values.assigned_user_ids !== undefined) ||
    (hasOwn(values, 'assignments') && values.assignments !== undefined) ||
    (hasOwn(values, 'assigned_workers') && values.assigned_workers !== undefined) ||
    (hasOwn(values, 'worker_ids') && values.worker_ids !== undefined)
  );
};

const normalizeWorkerIds = (values) => {
  if (values === undefined) return [];
  if (!Array.isArray(values)) {
    throw new Error('Schedule assignment workers must be an array of user UUIDs');
  }
  const rawValues = values;
  const ids = rawValues
    .map((value) => optionalId(assignmentUserId(value)))
    .filter(Boolean);
  const uniqueIds = [...new Set(ids)];
  const invalidIds = uniqueIds.filter((id) => !UUID_PATTERN.test(id));
  if (invalidIds.length > 0) {
    throw new Error('Schedule assignment workers must be user UUIDs; resolve worker emails before calling jobSchedules');
  }
  return uniqueIds;
};

const assertDateRange = (startDate, endDate) => {
  if (endDate < startDate) {
    throw new Error('end_date cannot be before start_date');
  }
};

const normalizeScheduleAssignments = (assignments = []) => {
  if (!Array.isArray(assignments)) return [];
  return [...assignments].sort((a, b) => {
    const createdAt = String(a.created_at || '').localeCompare(String(b.created_at || ''));
    if (createdAt !== 0) return createdAt;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
};

const mapScheduleWithAssignments = (schedule = {}, assignments = []) => {
  const normalizedAssignments = normalizeScheduleAssignments(assignments);
  const assignedUserIds = normalizeWorkerIds(
    normalizedAssignments.map((assignment) => assignment.user_id)
  );

  return {
    ...schedule,
    job_schedule_assignments: normalizedAssignments,
    assignments: normalizedAssignments,
    assigned_user_ids: assignedUserIds,
    assigned_workers: assignedUserIds,
  };
};

const mapRpcScheduleResult = (result) => {
  if (!result?.schedule) return result;
  return mapScheduleWithAssignments(result.schedule, result.assignments);
};

const mapRpcTimeEntryResult = (result) => {
  return result?.time_entry ?? null;
};

const mapRpcTeamMapEntries = (result) => {
  return Array.isArray(result?.entries) ? result.entries : [];
};

const mapRpcPreStartResult = (result) => {
  const preStart = result?.pre_start;
  if (!preStart || typeof preStart !== 'object' || Array.isArray(preStart)) {
    throw new Error('create_pre_start returned an invalid response');
  }
  return preStart;
};

const mapRpcLeaveRequestResult = (result, rpcName) => {
  const leaveRequest = result?.leave_request;
  if (!leaveRequest || typeof leaveRequest !== 'object' || Array.isArray(leaveRequest)) {
    throw new Error(`${rpcName} returned an invalid response`);
  }
  return leaveRequest;
};

const mapRpcMessageResult = (result, rpcName) => {
  const message = result?.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new Error(`${rpcName} returned an invalid response`);
  }
  return message;
};

const mapRpcMailboxResult = (result) => {
  if (!Array.isArray(result?.messages)) {
    throw new Error('get_message_mailbox returned an invalid response');
  }
  return result.messages;
};

const mapRpcMessageReadResult = (result) => {
  const messageRead = result?.message_read;
  if (!messageRead || typeof messageRead !== 'object' || Array.isArray(messageRead)) {
    throw new Error('mark_message_read returned an invalid response');
  }
  return messageRead;
};

const mapRpcUnreadCountResult = (result) => {
  const unreadCount = Number(result?.unread_count);
  if (!Number.isInteger(unreadCount) || unreadCount < 0) {
    throw new Error('get_unread_message_count returned an invalid response');
  }
  return unreadCount;
};

const normalizeAdminManagedMemberRole = (value, fieldName = 'role') => {
  const role = requiredText(value, fieldName);
  if (!ADMIN_MANAGED_MEMBER_ROLE_VALUES.has(role)) {
    throw new Error(`${fieldName} must be admin, supervisor, or worker`);
  }
  return role;
};

const normalizeInvitationEmail = (value) => {
  const email = requiredText(value, 'email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('email must be a valid email address');
  }
  return email;
};

const mapRpcMembershipResult = (result, rpcName, expected = {}) => {
  const membership = result?.membership;
  if (!membership || typeof membership !== 'object' || Array.isArray(membership)) {
    throw new Error(`${rpcName} returned an invalid response`);
  }
  if (
    expected.companyId &&
    normalizeLowercaseUuid(membership.company_id, 'membership.company_id') !== expected.companyId
  ) {
    throw new Error(`${rpcName} returned a membership for the wrong company`);
  }
  if (
    expected.userId &&
    normalizeLowercaseUuid(membership.user_id, 'membership.user_id') !== expected.userId
  ) {
    throw new Error(`${rpcName} returned a membership for the wrong user`);
  }
  if (expected.role && membership.role !== expected.role) {
    throw new Error(`${rpcName} returned a membership with the wrong role`);
  }
  return membership;
};

const mapRpcInvitationResult = (result, rpcName, expected = {}) => {
  const invitation = result?.invitation;
  if (!invitation || typeof invitation !== 'object' || Array.isArray(invitation)) {
    throw new Error(`${rpcName} returned an invalid response`);
  }
  if (
    expected.companyId &&
    normalizeLowercaseUuid(invitation.company_id, 'invitation.company_id') !== expected.companyId
  ) {
    throw new Error(`${rpcName} returned an invitation for the wrong company`);
  }
  if (expected.email && String(invitation.email || '').toLowerCase() !== expected.email) {
    throw new Error(`${rpcName} returned an invitation for the wrong email`);
  }
  if (expected.role && invitation.role !== expected.role) {
    throw new Error(`${rpcName} returned an invitation with the wrong role`);
  }
  if (expected.status && invitation.status !== expected.status) {
    throw new Error(`${rpcName} returned an invitation with the wrong status`);
  }
  return invitation;
};

const companyMemberChangeRoleAdminParams = (values = {}) => {
  assertOnlyKeys(values, ['company_id', 'user_id', 'role'], 'companyMembers.changeRoleAdmin');
  return {
    p_company_id: normalizeLowercaseUuid(values.company_id, 'company_id'),
    p_user_id: normalizeLowercaseUuid(values.user_id, 'user_id'),
    p_role: normalizeAdminManagedMemberRole(values.role),
  };
};

const companyMemberRemoveAdminParams = (values = {}) => {
  assertOnlyKeys(values, ['company_id', 'user_id'], 'companyMembers.removeAdmin');
  return {
    p_company_id: normalizeLowercaseUuid(values.company_id, 'company_id'),
    p_user_id: normalizeLowercaseUuid(values.user_id, 'user_id'),
  };
};

const invitationCreatePendingAdminParams = (values = {}) => {
  assertOnlyKeys(values, ['company_id', 'email', 'role'], 'invitations.createPendingAdmin');
  return {
    p_company_id: normalizeLowercaseUuid(values.company_id, 'company_id'),
    p_email: normalizeInvitationEmail(values.email),
    p_role: normalizeAdminManagedMemberRole(values.role),
  };
};

const invitationRevokeAdminParams = (values = {}) => {
  assertOnlyKeys(values, ['company_id', 'invitation_id'], 'invitations.revokeAdmin');
  return {
    p_company_id: normalizeLowercaseUuid(values.company_id, 'company_id'),
    p_invitation_id: normalizeLowercaseUuid(values.invitation_id, 'invitation_id'),
  };
};

const mapRpcEquipmentTransitionResult = (result) => {
  const equipment = result?.equipment;
  const log = result?.log;
  if (
    !equipment ||
    typeof equipment !== 'object' ||
    Array.isArray(equipment) ||
    !log ||
    typeof log !== 'object' ||
    Array.isArray(log)
  ) {
    throw new Error('equipment transition RPC returned an invalid response');
  }
  return { equipment, log };
};

const requiredJson = (value, fieldName) => {
  if (value === undefined || value === null) {
    throw new Error(`${fieldName} is required`);
  }

  try {
    JSON.stringify(value);
  } catch {
    throw new Error(`${fieldName} must be JSON-compatible`);
  }

  return value;
};

const requiredBoolean = (value, fieldName) => {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }
  return value;
};

const preStartCreateParams = (values = {}) => ({
  p_company_id: requiredUuid(values.company_id, 'company_id'),
  p_job_id: requiredUuid(values.job_id, 'job_id'),
  p_equipment_id: optionalUuid(values.equipment_id, 'equipment_id'),
  p_date: toDateOnly(values.date, 'date'),
  p_answers: requiredJson(values.answers, 'answers'),
  p_general_comments: optionalText(values.general_comments) ?? null,
  p_has_faults: requiredBoolean(values.has_faults, 'has_faults'),
});

const normalizeLeaveType = (value) => {
  const leaveType = requiredText(value, 'leave_type');
  if (!LEAVE_TYPE_VALUES.has(leaveType)) {
    throw new Error('leave_type must be annual, sick, personal, or other');
  }
  return leaveType;
};

const normalizeLeaveReviewStatus = (value) => {
  const status = requiredText(value, 'status');
  if (!LEAVE_REVIEW_STATUS_VALUES.has(status)) {
    throw new Error('review status must be approved or declined');
  }
  return status;
};

const ensureDateRange = (startDate, endDate) => {
  if (endDate < startDate) {
    throw new Error('end_date cannot be before start_date');
  }
};

const leaveCreateWorkerParams = (values = {}) => {
  const startDate = toDateOnly(values.start_date, 'start_date');
  const endDate = toDateOnly(values.end_date, 'end_date');
  ensureDateRange(startDate, endDate);

  return {
    p_company_id: requiredUuid(values.company_id, 'company_id'),
    p_leave_type: normalizeLeaveType(values.leave_type),
    p_start_date: startDate,
    p_end_date: endDate,
    p_notes: optionalText(values.notes) ?? null,
  };
};

const leaveReviewAdminParams = (id, values = {}) => ({
  p_company_id: requiredUuid(values.company_id, 'company_id'),
  p_leave_request_id: requiredUuid(id, 'leave_request_id'),
  p_status: normalizeLeaveReviewStatus(values.status),
});

const normalizeMessageType = (value) => {
  const messageType = requiredText(value, 'message_type');
  if (!MESSAGE_TYPE_VALUES.has(messageType)) {
    throw new Error('message_type must be direct or broadcast');
  }
  return messageType;
};

const messageSendMemberParams = (values = {}) => {
  const messageType = normalizeMessageType(values.message_type);
  const recipientId = optionalUuid(values.recipient_id, 'recipient_id');

  if (messageType === 'direct' && !recipientId) {
    throw new Error('recipient_id is required for direct messages');
  }
  if (messageType === 'broadcast' && recipientId) {
    throw new Error('recipient_id must be empty for broadcast messages');
  }

  return {
    p_company_id: requiredUuid(values.company_id, 'company_id'),
    p_message_type: messageType,
    p_recipient_id: messageType === 'direct' ? recipientId : null,
    p_subject: optionalText(values.subject) ?? null,
    p_body: requiredText(values.body, 'body'),
  };
};

const messageMarkReadParams = (id, values = {}) => ({
  p_company_id: requiredUuid(values.company_id, 'company_id'),
  p_message_id: requiredUuid(id, 'message_id'),
});

const normalizeEquipmentCategory = (value) => {
  const category = requiredText(value, 'category');
  if (!EQUIPMENT_CATEGORY_VALUES.has(category)) {
    throw new Error('category must be machinery, tools, vehicle, safety, electrical, or other');
  }
  return category;
};

const normalizeEquipmentAdminStatus = (value, fallback) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (fallback !== undefined) return fallback;
    throw new Error('status must be available or maintenance');
  }
  const status = String(value).trim();
  if (!EQUIPMENT_ADMIN_STATUS_VALUES.has(status)) {
    throw new Error('status must be available or maintenance');
  }
  return status;
};

const normalizeEquipmentCreateValues = (values = {}) => ({
  company_id: requiredUuid(values.company_id, 'company_id'),
  name: requiredText(values.name, 'name'),
  equipment_id: requiredText(values.equipment_id, 'equipment_id'),
  category: normalizeEquipmentCategory(values.category ?? 'tools'),
  status: normalizeEquipmentAdminStatus(values.status, 'available'),
  notes: optionalText(values.notes) ?? null,
});

const normalizeEquipmentUpdateValues = (values = {}) => {
  const updateValues = {};

  if (hasOwn(values, 'name')) {
    updateValues.name = requiredText(values.name, 'name');
  }
  if (hasOwn(values, 'equipment_id')) {
    updateValues.equipment_id = requiredText(values.equipment_id, 'equipment_id');
  }
  if (hasOwn(values, 'category')) {
    updateValues.category = normalizeEquipmentCategory(values.category);
  }
  if (hasOwn(values, 'status')) {
    updateValues.status = normalizeEquipmentAdminStatus(values.status);
  }
  if (hasOwn(values, 'notes')) {
    updateValues.notes = optionalText(values.notes) ?? null;
  }

  return updateValues;
};

const equipmentTransitionParams = (id, companyId) => ({
  p_company_id: requiredUuid(companyId, 'company_id'),
  p_equipment_id: requiredUuid(id, 'equipment_id'),
});

const equipmentPhotoPathPrefix = (companyId, equipmentId) => (
  `company/${companyId}/equipment/${equipmentId}/`
);

const requiredEquipmentPhotoPath = (photoPath, companyId, equipmentId) => {
  const path = requiredText(photoPath, 'photo_path');
  const prefix = equipmentPhotoPathPrefix(companyId, equipmentId);
  if (!path.startsWith(prefix)) {
    throw new Error('photo_path must match the Equipment photo path');
  }

  const filename = path.slice(prefix.length);
  if (!filename || filename.includes('/')) {
    throw new Error('photo_path must include a single Equipment photo filename');
  }

  return path;
};

const normalizeEquipmentPhotoIds = ({ companyId, equipmentId }) => ({
  companyId: requiredUuid(companyId, 'company_id').toLowerCase(),
  equipmentId: requiredUuid(equipmentId, 'equipment_id').toLowerCase(),
});

const normalizeSignedUrlExpiry = (expiresIn) => {
  if (expiresIn === undefined || expiresIn === null) return 3600;
  const seconds = Number(expiresIn);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
    throw new Error('expiresIn must be an integer between 1 and 3600 seconds');
  }
  return seconds;
};

const validateEquipmentPhotoFile = (file) => {
  if (!file || typeof file !== 'object') {
    throw new Error('photo file is required');
  }

  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('photo file must not be empty');
  }
  if (size > EQUIPMENT_PHOTO_MAX_BYTES) {
    throw new Error('photo file must be 20 MB or smaller');
  }

  const mimeType = typeof file.type === 'string' ? file.type.trim() : '';
  const extension = EQUIPMENT_PHOTO_EXTENSIONS.get(mimeType);
  if (!extension) {
    throw new Error('photo file must be JPEG, PNG, or WebP');
  }

  return { mimeType, extension };
};

const randomEquipmentPhotoFilename = (extension) => {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (typeof randomUUID !== 'function') {
    throw new Error('Secure UUID generation is not available');
  }
  return `${randomUUID()}.${extension}`;
};

const equipmentPhotoPath = (companyId, equipmentId, extension) => (
  `${equipmentPhotoPathPrefix(companyId, equipmentId)}${randomEquipmentPhotoFilename(extension)}`
);

const normalizeLowercaseUuid = (value, fieldName) => requiredUuid(value, fieldName).toLowerCase();

const secureRandomUuid = () => {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (typeof randomUUID !== 'function') {
    throw new Error('Secure UUID generation is not available');
  }
  return randomUUID().toLowerCase();
};

const normalizeAvatarSignedUrlExpiry = (expiresIn = 3600) => {
  const seconds = Number(expiresIn);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400) {
    throw new Error('expiresIn must be an integer between 1 and 86400 seconds');
  }
  return seconds;
};

const assertOnlyKeys = (values, allowedKeys, methodName) => {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error(`${methodName} values are required`);
  }
  const unexpectedKeys = Object.keys(values).filter((key) => !allowedKeys.includes(key));
  if (unexpectedKeys.length > 0) {
    throw new Error(`${methodName} received unsupported field: ${unexpectedKeys[0]}`);
  }
};

const validateAvatarFile = (file) => {
  if (!file || typeof file !== 'object') {
    throw new Error('avatar file is required');
  }

  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('avatar file must not be empty');
  }
  if (size > AVATAR_MAX_BYTES) {
    throw new Error('avatar file must be 5 MB or smaller');
  }

  const mimeType = typeof file.type === 'string' ? file.type.trim() : '';
  const extension = AVATAR_EXTENSIONS.get(mimeType);
  if (!extension) {
    throw new Error('avatar file must be JPEG, PNG, or WebP');
  }

  return { mimeType, extension };
};

const parseAvatarPath = (avatarPath, expectedUserId) => {
  const path = requiredText(avatarPath, 'avatar_path');
  if (path !== avatarPath || path !== path.toLowerCase()) {
    throw new Error('avatar_path must be a lowercase canonical avatar path');
  }

  const segments = path.split('/');
  if (segments.length !== 3) {
    throw new Error('avatar_path must use the canonical avatar path format');
  }

  const [userLiteral, userIdValue, filename] = segments;
  if (userLiteral !== 'user') {
    throw new Error('avatar_path must use the canonical avatar path format');
  }
  if (!filename || filename.includes('/')) {
    throw new Error('avatar_path must include a single avatar filename');
  }

  const filenameParts = filename.split('.');
  if (filenameParts.length !== 2) {
    throw new Error('avatar_path filename must be a UUID with jpg, png, or webp extension');
  }
  const [avatarIdValue, extension] = filenameParts;
  if (!['jpg', 'png', 'webp'].includes(extension)) {
    throw new Error('avatar_path extension must be jpg, png, or webp');
  }

  const userId = normalizeLowercaseUuid(userIdValue, 'avatar_path user_id');
  const avatarId = normalizeLowercaseUuid(avatarIdValue, 'avatar_path file UUID');
  if (expectedUserId && userId !== expectedUserId) {
    throw new Error('avatar_path must belong to the authenticated user');
  }

  const canonicalPath = `user/${userId}/${avatarId}.${extension}`;
  if (path !== canonicalPath) {
    throw new Error('avatar_path must be a lowercase canonical avatar path');
  }

  return {
    path,
    userId,
    avatarId,
    extension,
  };
};

const isOwnAvatarPath = (avatarPath, userId) => {
  try {
    parseAvatarPath(avatarPath, userId);
    return true;
  } catch {
    return false;
  }
};

const avatarPath = (userId, extension) => (
  `user/${userId}/${secureRandomUuid()}.${extension}`
);

const mapProfileRpcResult = (result, expectedUserId) => {
  const profile = result?.profile;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('Profile RPC returned an invalid response');
  }
  if (expectedUserId && normalizeLowercaseUuid(profile.id, 'profile.id') !== expectedUserId) {
    throw new Error('Profile RPC returned mismatched profile data');
  }
  return profile;
};

const uploadAvatarObject = async ({ path, file, mimeType }) => {
  const { data, error } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(path, file, { upsert: false, contentType: mimeType });
  if (error) throw error;
  if (!data || data.path !== path) {
    throw new Error('avatar upload returned an invalid path');
  }
  return data;
};

const removeAvatarObject = async (path) => {
  const { error } = await supabase.storage
    .from(AVATARS_BUCKET)
    .remove([path]);
  if (error) throw error;
  return true;
};

const validateSitePhotoFile = (file) => {
  if (!file || typeof file !== 'object') {
    throw new Error('Site Photo file is required');
  }

  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('Site Photo file must not be empty');
  }
  if (size > SITE_PHOTO_MAX_BYTES) {
    throw new Error('Site Photo file must be 20 MB or smaller');
  }

  const mimeType = typeof file.type === 'string' ? file.type.trim() : '';
  const extension = SITE_PHOTO_EXTENSIONS.get(mimeType);
  if (!extension) {
    throw new Error('Site Photo file must be JPEG, PNG, or WebP');
  }

  return { mimeType, extension };
};

const parseSitePhotoPath = (photoPath) => {
  const path = requiredText(photoPath, 'photo_path');
  if (path !== photoPath || path !== path.toLowerCase()) {
    throw new Error('photo_path must be a lowercase canonical Site Photo path');
  }

  const segments = path.split('/');
  if (segments.length !== 7) {
    throw new Error('photo_path must use the canonical Site Photo path format');
  }

  const [companyLiteral, companyIdValue, jobsLiteral, jobIdValue, workersLiteral, workerIdValue, filename] = segments;
  if (companyLiteral !== 'company' || jobsLiteral !== 'jobs' || workersLiteral !== 'workers') {
    throw new Error('photo_path must use the canonical Site Photo path format');
  }
  if (!filename || filename.includes('/')) {
    throw new Error('photo_path must include a single Site Photo filename');
  }

  const filenameParts = filename.split('.');
  if (filenameParts.length !== 2) {
    throw new Error('photo_path filename must be a UUID with jpg, png, or webp extension');
  }
  const [photoIdValue, extension] = filenameParts;
  if (!['jpg', 'png', 'webp'].includes(extension)) {
    throw new Error('photo_path extension must be jpg, png, or webp');
  }

  const companyId = normalizeLowercaseUuid(companyIdValue, 'photo_path company_id');
  const jobId = normalizeLowercaseUuid(jobIdValue, 'photo_path job_id');
  const workerId = normalizeLowercaseUuid(workerIdValue, 'photo_path worker_id');
  const photoId = normalizeLowercaseUuid(photoIdValue, 'photo_path file UUID');
  const canonicalPath = `company/${companyId}/jobs/${jobId}/workers/${workerId}/${photoId}.${extension}`;
  if (path !== canonicalPath) {
    throw new Error('photo_path must be a lowercase canonical Site Photo path');
  }

  return {
    path,
    companyId,
    jobId,
    workerId,
    photoId,
    extension,
  };
};

const sitePhotoPath = ({ companyId, jobId, workerId, extension }) => (
  `company/${companyId}/jobs/${jobId}/workers/${workerId}/${secureRandomUuid()}.${extension}`
);

const getAuthenticatedUserId = async () => {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const userId = data?.user?.id;
  if (!userId) throw new Error('Not authenticated');
  return normalizeLowercaseUuid(userId, 'authenticated user id');
};

const mapCreateJobPhotoResult = (result, { companyId, jobId, workerId, photoPath, date }) => {
  const jobPhoto = result?.job_photo;
  if (!jobPhoto || typeof jobPhoto !== 'object' || Array.isArray(jobPhoto)) {
    throw new Error('create_job_photo returned an invalid response');
  }

  const returnedCompanyId = normalizeLowercaseUuid(jobPhoto.company_id, 'job_photo.company_id');
  const returnedJobId = normalizeLowercaseUuid(jobPhoto.job_id, 'job_photo.job_id');
  const returnedWorkerId = normalizeLowercaseUuid(jobPhoto.worker_id, 'job_photo.worker_id');
  if (
    returnedCompanyId !== companyId ||
    returnedJobId !== jobId ||
    returnedWorkerId !== workerId ||
    jobPhoto.photo_path !== photoPath ||
    jobPhoto.date !== date
  ) {
    throw new Error('create_job_photo returned mismatched Site Photo data');
  }

  return jobPhoto;
};

const mapDeleteJobPhotoResult = (result, requestedId) => {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('delete_job_photo_admin returned an invalid response');
  }

  const id = normalizeLowercaseUuid(result.id, 'job_photo.id');
  const companyId = normalizeLowercaseUuid(result.company_id, 'job_photo.company_id');
  const jobId = optionalUuid(result.job_id, 'job_photo.job_id')?.toLowerCase() ?? null;
  const parsedPath = parseSitePhotoPath(result.photo_path);
  if (result.deleted !== true || id !== requestedId || parsedPath.companyId !== companyId) {
    throw new Error('delete_job_photo_admin returned mismatched Site Photo data');
  }

  return {
    deleted: true,
    id,
    company_id: companyId,
    job_id: jobId,
    photo_path: parsedPath.path,
  };
};

const uploadSitePhotoObject = async ({ photoPath, file, mimeType }) => {
  const { data, error } = await supabase.storage
    .from(JOB_PHOTOS_BUCKET)
    .upload(photoPath, file, { upsert: false, contentType: mimeType });
  if (error) throw error;
  if (!data || data.path !== photoPath) {
    throw new Error('Site Photo upload returned an invalid path');
  }
  return data;
};

const removeEquipmentPhotoObject = async ({ companyId, equipmentId, photoPath }) => {
  const ids = normalizeEquipmentPhotoIds({ companyId, equipmentId });
  const path = requiredEquipmentPhotoPath(photoPath, ids.companyId, ids.equipmentId);
  const { error } = await supabase.storage
    .from(EQUIPMENT_PHOTO_BUCKET)
    .remove([path]);
  if (error) throw error;
  return true;
};

const cleanupEquipmentPhotoObject = async ({ companyId, equipmentId, photoPath, currentPhotoPath }) => {
  if (!photoPath || photoPath === currentPhotoPath) return null;

  try {
    await removeEquipmentPhotoObject({ companyId, equipmentId, photoPath });
    return null;
  } catch {
    return 'Photo cleanup failed; the old storage object may remain.';
  }
};

const cleanupUploadedEquipmentPhoto = async ({ companyId, equipmentId, photoPath }) => {
  try {
    await removeEquipmentPhotoObject({ companyId, equipmentId, photoPath });
  } catch {
    // Best-effort cleanup must not hide the original attach failure.
  }
};

const setEquipmentPhotoAdmin = async ({ companyId, equipmentId, photoPath }) => {
  const { data, error } = await supabase.rpc('set_equipment_photo_admin', {
    p_company_id: companyId,
    p_equipment_id: equipmentId,
    p_photo_path: photoPath,
  });
  if (error) throw error;
  return data;
};

const mapEquipmentPhotoRpcResult = (result, { companyId, equipmentId, expectedPhotoPath }) => {
  const equipment = result?.equipment;
  const previousPhotoPath = result?.previous_photo_path;
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    !equipment ||
    typeof equipment !== 'object' ||
    Array.isArray(equipment) ||
    equipment.id !== equipmentId ||
    equipment.company_id !== companyId ||
    equipment.photo_path !== expectedPhotoPath ||
    !(previousPhotoPath === null || typeof previousPhotoPath === 'string')
  ) {
    throw new Error('equipment photo RPC returned an invalid response');
  }

  return {
    equipment,
    previous_photo_path: previousPhotoPath,
  };
};

const uploadEquipmentPhotoObject = async ({ photoPath, file, mimeType }) => {
  const { data, error } = await supabase.storage
    .from(EQUIPMENT_PHOTO_BUCKET)
    .upload(photoPath, file, { upsert: false, contentType: mimeType });
  if (error) throw error;
  if (!data || data.path !== photoPath) {
    throw new Error('equipment photo upload returned an invalid path');
  }
  return data;
};

const timeEntryClockInParams = (values = {}) => ({
  p_company_id: requiredUuid(values.company_id, 'company_id'),
  p_job_id: requiredUuid(values.job_id, 'job_id'),
  p_date: toDateOnly(values.date, 'date'),
  p_start_time: requiredTimestamp(values.start_time, 'start_time'),
  p_worker_lat: nullableNumberParam(values.worker_lat, 'worker_lat'),
  p_worker_lng: nullableNumberParam(values.worker_lng, 'worker_lng'),
  p_notes: optionalText(values.notes) ?? null,
});

const timeEntryClockOutParams = (id, values = {}) => ({
  p_time_entry_id: requiredUuid(id, 'time_entry_id'),
  p_finish_time: requiredTimestamp(values.finish_time, 'finish_time'),
  p_lunch_break_mins: lunchBreakParam(values.lunch_break_mins),
});

const timeEntryManualJobParams = (values = {}) => {
  const jobId = optionalUuid(values.job_id, 'job_id');

  return {
    p_job_id: jobId,
    p_date: toDateOnly(values.date, 'date'),
    p_start_time: requiredTimestamp(values.start_time, 'start_time'),
    p_finish_time: optionalTimestamp(values.finish_time),
    p_lunch_break_mins: lunchBreakParam(values.lunch_break_mins),
    p_job_name: jobId ? null : optionalText(values.job_name) ?? null,
    p_job_number: jobId ? null : optionalText(values.job_number) ?? null,
    p_notes: optionalText(values.notes) ?? null,
  };
};

const timeEntryManualParams = (values = {}) => ({
  p_company_id: requiredUuid(values.company_id, 'company_id'),
  p_worker_id: requiredUuid(values.worker_id, 'worker_id'),
  ...timeEntryManualJobParams(values),
});

const timeEntryManualUpdateParams = (id, values = {}) => {
  return {
    p_time_entry_id: requiredUuid(id, 'time_entry_id'),
    ...timeEntryManualJobParams(values),
  };
};

const scheduleRpcParams = (values = {}) => {
  const startDate = toDateOnly(values.start_date, 'start_date');
  const endDate = toDateOnly(values.end_date, 'end_date');
  assertDateRange(startDate, endDate);

  return {
    p_title: values.title,
    p_start_date: startDate,
    p_end_date: endDate,
    p_job_id: optionalId(values.job_id),
    p_leave_request_id: optionalId(values.leave_request_id),
    p_job_name: values.job_name ?? null,
    p_job_number: values.job_number ?? null,
    p_color: values.color ?? null,
    p_notes: values.notes ?? null,
    p_source_type: values.source_type ?? null,
    p_legacy_base44_id: values.legacy_base44_id ?? null,
    p_assigned_user_ids: normalizeWorkerIds(scheduleAssignmentInput(values)),
  };
};

const mergeScheduleUpdateValues = (existing, values = {}) => {
  const merged = {
    title: existing.title,
    start_date: existing.start_date,
    end_date: existing.end_date,
    job_id: existing.job_id,
    leave_request_id: existing.leave_request_id,
    job_name: existing.job_name,
    job_number: existing.job_number,
    color: existing.color,
    notes: existing.notes,
    source_type: existing.source_type,
    legacy_base44_id: existing.legacy_base44_id,
  };

  Object.keys(merged).forEach((key) => {
    if (hasOwn(values, key) && values[key] !== undefined) {
      merged[key] = values[key];
    }
  });

  merged.assigned_user_ids = hasScheduleAssignmentInput(values)
    ? normalizeWorkerIds(scheduleAssignmentInput(values))
    : existing.assigned_user_ids;

  return merged;
};

const createTableAdapter = (tableName) => ({
  async list(orderBy, limit) {
    let query = supabase.from(tableName).select('*');
    query = orderQuery(query, orderBy);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async filter(filters = {}, orderBy, limit) {
    let query = supabase.from(tableName).select('*');
    query = applyFilters(query, filters);
    query = orderQuery(query, orderBy);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async create(values) {
    const { data, error } = await supabase
      .from(tableName)
      .insert(values)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, values) {
    const { data, error } = await supabase
      .from(tableName)
      .update(values)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase.from(tableName).delete().eq('id', id);
    if (error) throw error;
    return true;
  },
});

const normalizeWorkerDirectoryName = (value) => {
  const trimmed = optionalId(value);
  return trimmed || null;
};

const mapCompanyWorkerDirectoryEntry = (entry = {}) => {
  const fullName = normalizeWorkerDirectoryName(entry.full_name);
  const email = normalizeWorkerDirectoryName(entry.email);
  const userId = entry.user_id;

  return {
    user_id: userId,
    role: entry.role,
    full_name: fullName,
    email,
    display_name:
      normalizeWorkerDirectoryName(entry.display_name) ||
      fullName ||
      email ||
      `Worker • ${String(userId || 'unknown').slice(0, 8)}`,
  };
};

const createCompanyMembersAdapter = () => ({
  ...createTableAdapter('company_members'),

  async create() {
    throw new Error('Direct company member writes are unsupported; use dedicated admin methods');
  },

  async update() {
    throw new Error('Direct company member writes are unsupported; use dedicated admin methods');
  },

  async delete() {
    throw new Error('Direct company member writes are unsupported; use dedicated admin methods');
  },

  async directory(companyId) {
    const normalizedCompanyId = optionalId(companyId);
    if (!normalizedCompanyId) throw new Error('companyId is required');
    if (!UUID_PATTERN.test(normalizedCompanyId)) throw new Error('companyId must be a company UUID');

    const { data, error } = await supabase.rpc('list_company_worker_directory', {
      p_company_id: normalizedCompanyId,
    });
    if (error) throw error;
    return (data || []).map(mapCompanyWorkerDirectoryEntry);
  },

  async changeRoleAdmin(values) {
    const params = companyMemberChangeRoleAdminParams(values);
    const { data, error } = await supabase.rpc('change_company_member_role_admin', params);
    if (error) throw error;
    return mapRpcMembershipResult(data, 'change_company_member_role_admin', {
      companyId: params.p_company_id,
      userId: params.p_user_id,
      role: params.p_role,
    });
  },

  async removeAdmin(values) {
    const params = companyMemberRemoveAdminParams(values);
    const { data, error } = await supabase.rpc('remove_company_member_admin', params);
    if (error) throw error;
    return mapRpcMembershipResult(data, 'remove_company_member_admin', {
      companyId: params.p_company_id,
      userId: params.p_user_id,
    });
  },
});

const createJobsAdapter = () => ({
  async list() {
    throw new Error('Use jobs.filter({ company_id }) so jobs remain company-scoped');
  },

  async filter(filters = {}, orderBy = '-created_date', limit) {
    const companyId = optionalId(filters.company_id);
    if (!companyId) throw new Error('company_id is required when reading jobs');

    let query = supabase.from('jobs').select('*');
    query = applyFilters(query, { ...filters, company_id: companyId });
    query = orderQuery(query, normalizeJobsOrderBy(orderBy));
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapJobRow);
  },

  async create(values) {
    const { data, error } = await supabase
      .from('jobs')
      .insert(normalizeJobCreateValues(values))
      .select()
      .single();
    if (error) throw error;
    return mapJobRow(data);
  },

  async update(id, values) {
    const updateValues = normalizeJobUpdateValues(values);
    if (Object.keys(updateValues).length === 0) {
      throw new Error('No editable job fields supplied');
    }

    const { data, error } = await supabase
      .from('jobs')
      .update(updateValues)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return mapJobRow(data);
  },

  async delete(id) {
    const { error } = await supabase.from('jobs').delete().eq('id', id);
    if (error) throw error;
    return true;
  },
});

const createTimeEntriesAdapter = () => {
  const baseAdapter = createTableAdapter('time_entries');

  return {
    ...baseAdapter,

    async create() {
      throw new Error('Use timeEntries.clockIn() or timeEntries.createManual() so TimeEntry writes use secure RPCs');
    },

    async update() {
      throw new Error('Use timeEntries.clockOut() or timeEntries.updateManual() so TimeEntry writes use secure RPCs');
    },

    async getMyActive(companyId) {
      const { data, error } = await supabase.rpc('get_my_active_time_entry', {
        p_company_id: requiredUuid(companyId, 'company_id'),
      });
      if (error) throw error;
      return mapRpcTimeEntryResult(data);
    },

    async clockIn(values) {
      const { data, error } = await supabase.rpc('clock_in_time_entry', timeEntryClockInParams(values));
      if (error) throw error;
      return mapRpcTimeEntryResult(data);
    },

    async clockOut(id, values) {
      const { data, error } = await supabase.rpc('clock_out_time_entry', timeEntryClockOutParams(id, values));
      if (error) throw error;
      return mapRpcTimeEntryResult(data);
    },

    async createManual(values) {
      const { data, error } = await supabase.rpc('create_manual_time_entry', timeEntryManualParams(values));
      if (error) throw error;
      return mapRpcTimeEntryResult(data);
    },

    async updateManual(id, values) {
      const { data, error } = await supabase.rpc('update_manual_time_entry', timeEntryManualUpdateParams(id, values));
      if (error) throw error;
      return mapRpcTimeEntryResult(data);
    },

    async delete(id) {
      const timeEntryId = requiredUuid(id, 'time_entry_id');
      const { data, error } = await supabase.rpc('delete_time_entry', {
        p_time_entry_id: timeEntryId,
      });
      if (error) throw error;
      return {
        deleted: Boolean(data?.deleted),
        id: data?.id ?? timeEntryId,
      };
    },
  };
};

const createPreStartsAdapter = () => ({
  async list(orderBy, limit) {
    let query = supabase.from('pre_starts').select('*');
    query = orderQuery(query, orderBy);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async filter(filters = {}, orderBy, limit) {
    let query = supabase.from('pre_starts').select('*');
    query = applyFilters(query, filters);
    query = orderQuery(query, orderBy);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async createWorker(values) {
    const { data, error } = await supabase.rpc('create_pre_start', preStartCreateParams(values));
    if (error) throw error;
    return mapRpcPreStartResult(data);
  },
});

const createLeaveRequestsAdapter = () => ({
  async list(orderBy, limit) {
    let query = supabase.from('leave_requests').select('*');
    query = orderQuery(query, orderBy);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async filter(filters = {}, orderBy, limit) {
    let query = supabase.from('leave_requests').select('*');
    query = applyFilters(query, filters);
    query = orderQuery(query, orderBy);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async create() {
    throw new Error('Use leaveRequests.createWorker() so LeaveRequest creation uses the secure RPC');
  },

  async update() {
    throw new Error('Use leaveRequests.reviewAdmin() so LeaveRequest reviews use the secure RPC');
  },

  async createWorker(values) {
    const { data, error } = await supabase.rpc('create_leave_request_worker', leaveCreateWorkerParams(values));
    if (error) throw error;
    return mapRpcLeaveRequestResult(data, 'create_leave_request_worker');
  },

  async reviewAdmin(id, values) {
    const { data, error } = await supabase.rpc('review_leave_request_admin', leaveReviewAdminParams(id, values));
    if (error) throw error;
    return mapRpcLeaveRequestResult(data, 'review_leave_request_admin');
  },

  async delete(id) {
    const leaveRequestId = requiredUuid(id, 'leave_request_id');
    const { error } = await supabase.from('leave_requests').delete().eq('id', leaveRequestId);
    if (error) throw error;
    return true;
  },
});

const createMessagesAdapter = () => ({
  async list() {
    throw new Error('Use messages.mailbox(companyId) so Messages are resolved through the secure RPC');
  },

  async filter() {
    throw new Error('Use messages.mailbox(companyId) so Messages are resolved through the secure RPC');
  },

  async create() {
    throw new Error('Use messages.sendMember() so Messages are created through the secure RPC');
  },

  async update() {
    throw new Error('Use messages.markRead() so Message read state is written through the secure RPC');
  },

  async delete() {
    throw new Error('Message deletion is not supported by the secure Messages adapter');
  },

  async mailbox(companyId) {
    const { data, error } = await supabase.rpc('get_message_mailbox', {
      p_company_id: requiredUuid(companyId, 'company_id'),
    });
    if (error) throw error;
    return mapRpcMailboxResult(data);
  },

  async sendMember(values) {
    const { data, error } = await supabase.rpc('create_message_member', messageSendMemberParams(values));
    if (error) throw error;
    return mapRpcMessageResult(data, 'create_message_member');
  },

  async markRead(id, values = {}) {
    const { data, error } = await supabase.rpc('mark_message_read', messageMarkReadParams(id, values));
    if (error) throw error;
    return mapRpcMessageReadResult(data);
  },

  async unreadCount(companyId) {
    const { data, error } = await supabase.rpc('get_unread_message_count', {
      p_company_id: requiredUuid(companyId, 'company_id'),
    });
    if (error) throw error;
    return mapRpcUnreadCountResult(data);
  },
});

const createMessageReadsAdapter = () => ({
  async list() {
    throw new Error('Direct messageReads access is unsupported; use messages.mailbox() or messages.markRead()');
  },

  async filter() {
    throw new Error('Direct messageReads access is unsupported; use messages.mailbox() or messages.markRead()');
  },

  async create() {
    throw new Error('Use messages.markRead() so Message read receipts use the secure RPC');
  },

  async update() {
    throw new Error('Message read receipt updates are unsupported');
  },

  async delete() {
    throw new Error('Message read receipt deletion is unsupported');
  },
});

const createInvitationsAdapter = () => ({
  ...createTableAdapter('invitations'),

  async create() {
    throw new Error('Direct invitation writes are unsupported; use invitations.createPendingAdmin()');
  },

  async update() {
    throw new Error('Direct invitation writes are unsupported; use invitations.revokeAdmin()');
  },

  async delete() {
    throw new Error('Direct invitation writes are unsupported; use invitations.revokeAdmin()');
  },

  async createPendingAdmin(values) {
    const params = invitationCreatePendingAdminParams(values);
    const { data, error } = await supabase.rpc('create_company_invitation_admin', params);
    if (error) throw error;
    return mapRpcInvitationResult(data, 'create_company_invitation_admin', {
      companyId: params.p_company_id,
      email: params.p_email,
      role: params.p_role,
      status: 'pending',
    });
  },

  async revokeAdmin(values) {
    const params = invitationRevokeAdminParams(values);
    const { data, error } = await supabase.rpc('revoke_company_invitation_admin', params);
    if (error) throw error;
    return mapRpcInvitationResult(data, 'revoke_company_invitation_admin', {
      companyId: params.p_company_id,
      status: 'revoked',
    });
  },
});

const createJobPhotosAdapter = () => ({
  async list() {
    throw new Error('Use jobPhotos.filter({ company_id }) so Site Photos remain company-scoped');
  },

  async filter(filters = {}, orderBy = '-created_at', limit) {
    const companyId = normalizeLowercaseUuid(filters.company_id, 'company_id');

    let query = supabase.from('job_photos').select('*');
    query = applyFilters(query, { ...filters, company_id: companyId });
    query = orderQuery(query, orderBy);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async create() {
    throw new Error('Use jobPhotos.createWorker() so Site Photo writes use the secure RPC');
  },

  async update() {
    throw new Error('Site Photo updates are not supported');
  },

  async delete() {
    throw new Error('Use jobPhotos.deleteAdmin() so Site Photo deletes use the secure RPC');
  },

  async createWorker(values = {}) {
    const companyId = normalizeLowercaseUuid(values.company_id, 'company_id');
    const jobId = normalizeLowercaseUuid(values.job_id, 'job_id');
    const workerId = await getAuthenticatedUserId();
    const date = toDateOnly(values.date, 'date');
    const notes = optionalText(values.notes) ?? null;
    const { mimeType, extension } = validateSitePhotoFile(values.file);
    const photoPath = sitePhotoPath({ companyId, jobId, workerId, extension });

    await uploadSitePhotoObject({
      photoPath,
      file: values.file,
      mimeType,
    });

    const { data, error } = await supabase.rpc('create_job_photo', {
      p_company_id: companyId,
      p_job_id: jobId,
      p_photo_path: photoPath,
      p_date: date,
      p_notes: notes,
    });
    if (error) throw error;

    return mapCreateJobPhotoResult(data, {
      companyId,
      jobId,
      workerId,
      photoPath,
      date,
    });
  },

  async getSignedUrl(values = {}) {
    const companyId = normalizeLowercaseUuid(values.companyId, 'companyId');
    const parsedPath = parseSitePhotoPath(values.photoPath);
    if (parsedPath.companyId !== companyId) {
      throw new Error('photoPath must belong to companyId');
    }

    const { data, error } = await supabase.storage
      .from(JOB_PHOTOS_BUCKET)
      .createSignedUrl(parsedPath.path, normalizeSignedUrlExpiry(values.expiresIn));
    if (error) throw error;
    if (!data?.signedUrl) {
      throw new Error('Site Photo signed URL response was invalid');
    }
    return data.signedUrl;
  },

  async deleteAdmin(id) {
    const jobPhotoId = normalizeLowercaseUuid(id, 'job_photo_id');
    const { data, error } = await supabase.rpc('delete_job_photo_admin', {
      p_job_photo_id: jobPhotoId,
    });
    if (error) throw error;

    const result = mapDeleteJobPhotoResult(data, jobPhotoId);
    let cleanupWarning = null;
    const { error: cleanupError } = await supabase.storage
      .from(JOB_PHOTOS_BUCKET)
      .remove([result.photo_path]);
    if (cleanupError) {
      cleanupWarning = SITE_PHOTO_CLEANUP_WARNING;
    }

    return {
      ...result,
      cleanup_warning: cleanupWarning,
    };
  },
});

const createEquipmentAdapter = () => ({
  async list(orderBy, limit) {
    let query = supabase.from('equipment').select('*');
    query = orderQuery(query, orderBy);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async filter(filters = {}, orderBy, limit) {
    let query = supabase.from('equipment').select('*');
    query = applyFilters(query, filters);
    query = orderQuery(query, orderBy);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async createAdmin(values) {
    const { data, error } = await supabase
      .from('equipment')
      .insert(normalizeEquipmentCreateValues(values))
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateAdmin(id, values) {
    const updateValues = normalizeEquipmentUpdateValues(values);
    if (Object.keys(updateValues).length === 0) {
      throw new Error('No editable equipment fields supplied');
    }

    const { data, error } = await supabase
      .from('equipment')
      .update(updateValues)
      .eq('id', requiredUuid(id, 'equipment_id'))
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteAdmin(id) {
    const { error } = await supabase
      .from('equipment')
      .delete()
      .eq('id', requiredUuid(id, 'equipment_id'));
    if (error) throw error;
    return true;
  },

  async checkout(id, companyId) {
    const { data, error } = await supabase.rpc('checkout_equipment', equipmentTransitionParams(id, companyId));
    if (error) throw error;
    return mapRpcEquipmentTransitionResult(data);
  },

  async returnEquipment(id, companyId) {
    const { data, error } = await supabase.rpc('return_equipment', equipmentTransitionParams(id, companyId));
    if (error) throw error;
    return mapRpcEquipmentTransitionResult(data);
  },

  async getPhotoSignedUrl(values = {}) {
    const { companyId, equipmentId, photoPath, expiresIn } = values;
    const ids = normalizeEquipmentPhotoIds({ companyId, equipmentId });
    const path = requiredEquipmentPhotoPath(photoPath, ids.companyId, ids.equipmentId);
    const { data, error } = await supabase.storage
      .from(EQUIPMENT_PHOTO_BUCKET)
      .createSignedUrl(path, normalizeSignedUrlExpiry(expiresIn));
    if (error) throw error;
    if (!data?.signedUrl) {
      throw new Error('equipment photo signed URL response was invalid');
    }
    return data.signedUrl;
  },

  async replacePhotoAdmin(values = {}) {
    const { companyId, equipmentId, file } = values;
    const ids = normalizeEquipmentPhotoIds({ companyId, equipmentId });
    const { mimeType, extension } = validateEquipmentPhotoFile(file);
    const photoPath = equipmentPhotoPath(ids.companyId, ids.equipmentId, extension);

    try {
      await uploadEquipmentPhotoObject({ photoPath, file, mimeType });
    } catch (error) {
      await cleanupUploadedEquipmentPhoto({
        companyId: ids.companyId,
        equipmentId: ids.equipmentId,
        photoPath,
      });
      throw error;
    }

    let rpcResult;
    try {
      rpcResult = await setEquipmentPhotoAdmin({
        companyId: ids.companyId,
        equipmentId: ids.equipmentId,
        photoPath,
      });
    } catch (error) {
      await cleanupUploadedEquipmentPhoto({
        companyId: ids.companyId,
        equipmentId: ids.equipmentId,
        photoPath,
      });
      throw error;
    }

    const result = mapEquipmentPhotoRpcResult(rpcResult, {
      companyId: ids.companyId,
      equipmentId: ids.equipmentId,
      expectedPhotoPath: photoPath,
    });

    const cleanupWarning = await cleanupEquipmentPhotoObject({
      companyId: ids.companyId,
      equipmentId: ids.equipmentId,
      photoPath: result.previous_photo_path,
      currentPhotoPath: result.equipment.photo_path,
    });

    return {
      ...result,
      cleanup_warning: cleanupWarning,
    };
  },

  async clearPhotoAdmin(values = {}) {
    const { companyId, equipmentId } = values;
    const ids = normalizeEquipmentPhotoIds({ companyId, equipmentId });
    const rpcResult = await setEquipmentPhotoAdmin({
      companyId: ids.companyId,
      equipmentId: ids.equipmentId,
      photoPath: null,
    });
    const result = mapEquipmentPhotoRpcResult(rpcResult, {
      companyId: ids.companyId,
      equipmentId: ids.equipmentId,
      expectedPhotoPath: null,
    });
    const cleanupWarning = await cleanupEquipmentPhotoObject({
      companyId: ids.companyId,
      equipmentId: ids.equipmentId,
      photoPath: result.previous_photo_path,
      currentPhotoPath: result.equipment.photo_path,
    });

    return {
      ...result,
      cleanup_warning: cleanupWarning,
    };
  },
});

const createEquipmentLogsAdapter = () => ({
  async list(orderBy, limit) {
    let query = supabase.from('equipment_logs').select('*');
    query = orderQuery(query, orderBy);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async filter(filters = {}, orderBy, limit) {
    let query = supabase.from('equipment_logs').select('*');
    query = applyFilters(query, filters);
    query = orderQuery(query, orderBy);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },
});

const createJobSchedulesAdapter = () => ({
  async list(orderBy = 'start_date', limit) {
    let query = supabase
      .from('job_schedules')
      .select('*, job_schedule_assignments(*)');
    query = orderQuery(query, orderBy);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((schedule) =>
      mapScheduleWithAssignments(schedule, schedule.job_schedule_assignments)
    );
  },

  async filter(filters = {}, orderBy = 'start_date', limit) {
    let query = supabase
      .from('job_schedules')
      .select('*, job_schedule_assignments(*)');
    query = applyFilters(query, filters);
    query = orderQuery(query, orderBy);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((schedule) =>
      mapScheduleWithAssignments(schedule, schedule.job_schedule_assignments)
    );
  },

  /**
   * @param {{ company_id?: string, start_date?: string, end_date?: string }} [range]
   * @param {string} [orderBy]
   */
  async forDateRange({ company_id, start_date, end_date } = {}, orderBy = 'start_date') {
    const startDate = toDateOnly(start_date, 'start_date');
    const endDate = toDateOnly(end_date, 'end_date');
    assertDateRange(startDate, endDate);
    let query = supabase
      .from('job_schedules')
      .select('*, job_schedule_assignments(*)')
      .lte('start_date', endDate)
      .gte('end_date', startDate);
    if (company_id !== undefined) query = query.eq('company_id', company_id);
    query = orderQuery(query, orderBy);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((schedule) =>
      mapScheduleWithAssignments(schedule, schedule.job_schedule_assignments)
    );
  },

  async create(values) {
    const { data, error } = await supabase.rpc('create_job_schedule_with_assignments', {
      p_company_id: values.company_id,
      ...scheduleRpcParams(values),
    });
    if (error) throw error;
    return mapRpcScheduleResult(data);
  },

  async update(id, values) {
    const { data: existingRows, error: existingError } = await supabase
      .from('job_schedules')
      .select('*, job_schedule_assignments(*)')
      .eq('id', id)
      .limit(1);
    if (existingError) throw existingError;

    const existingSchedule = existingRows?.[0];
    if (!existingSchedule) {
      throw new Error('Job schedule not found or inaccessible');
    }

    const mergedValues = mergeScheduleUpdateValues(
      mapScheduleWithAssignments(existingSchedule, existingSchedule.job_schedule_assignments),
      values
    );

    const { data, error } = await supabase.rpc('update_job_schedule_with_assignments', {
      p_schedule_id: id,
      ...scheduleRpcParams(mergedValues),
    });
    if (error) throw error;
    return mapRpcScheduleResult(data);
  },

  async delete(id) {
    const { error } = await supabase.from('job_schedules').delete().eq('id', id);
    if (error) throw error;
    return true;
  },
});

const createTeamMapAdapter = () => ({
  async getTeamMapEntries(companyId) {
    const { data, error } = await supabase.rpc('get_team_map_entries', {
      p_company_id: requiredUuid(companyId, 'company_id'),
    });
    if (error) throw error;
    return mapRpcTeamMapEntries(data);
  },
});

export const onsiteApi = {
  auth: {
    async getSession() {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data?.session ?? null;
    },

    onAuthStateChange(callback) {
      if (typeof callback !== 'function') {
        throw new Error('onAuthStateChange callback is required');
      }

      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        callback(event, session ?? null);
      });

      return () => {
        data?.subscription?.unsubscribe?.();
      };
    },

    async signInWithOtp(values = {}) {
      assertOnlyKeys(values, ['email', 'redirectTo'], 'auth.signInWithOtp');
      const email = normalizeAuthEmail(values.email);
      const redirectTo = normalizeAuthRedirectTo(values.redirectTo);

      const { data, error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: false,
        },
      });
      if (error) throw error;
      return data;
    },

    async me() {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) return null;

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userData.user.id)
        .single();
      if (error) throw error;
      return data;
    },

    async updateMe() {
      throw new Error('Direct profile updates are unsupported; use auth.updateMyProfile() or auth.replaceMyAvatar()');
    },

    async updateMyProfile(values = {}) {
      assertOnlyKeys(values, ['full_name', 'phone'], 'auth.updateMyProfile');
      if (!hasOwn(values, 'full_name') || !hasOwn(values, 'phone')) {
        throw new Error('auth.updateMyProfile requires full_name and phone');
      }

      const { data, error } = await supabase.rpc('update_my_profile', {
        p_full_name: values.full_name,
        p_phone: values.phone,
      });
      if (error) throw error;
      return mapProfileRpcResult(data);
    },

    async replaceMyAvatar(file) {
      const { mimeType, extension } = validateAvatarFile(file);
      const userId = await getAuthenticatedUserId();

      const { data: currentProfile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (profileError) throw profileError;

      const previousAvatarPath = currentProfile?.avatar_path;
      const nextAvatarPath = avatarPath(userId, extension);
      let uploaded = false;
      let attached = false;

      try {
        await uploadAvatarObject({ path: nextAvatarPath, file, mimeType });
        uploaded = true;

        const { data, error } = await supabase.rpc('set_my_avatar_path', {
          p_avatar_path: nextAvatarPath,
        });
        if (error) throw error;
        attached = true;

        const profile = mapProfileRpcResult(data, userId);
        if (
          previousAvatarPath &&
          previousAvatarPath !== nextAvatarPath &&
          isOwnAvatarPath(previousAvatarPath, userId)
        ) {
          try {
            await removeAvatarObject(previousAvatarPath);
          } catch {
            // The new avatar is already attached; stale-object cleanup is non-fatal.
          }
        }
        return profile;
      } catch (error) {
        if (uploaded && !attached) {
          try {
            await removeAvatarObject(nextAvatarPath);
          } catch {
            // Best-effort cleanup must not hide the original attach failure.
          }
        }
        throw error;
      }
    },

    async getMyAvatarSignedUrl(avatarPathValue, expiresIn = 3600) {
      const trimmedPath = optionalId(avatarPathValue);
      if (!trimmedPath) return null;

      const userId = await getAuthenticatedUserId();
      const parsedPath = parseAvatarPath(trimmedPath, userId);
      const { data, error } = await supabase.storage
        .from(AVATARS_BUCKET)
        .createSignedUrl(parsedPath.path, normalizeAvatarSignedUrlExpiry(expiresIn));
      if (error) throw error;
      if (!data?.signedUrl) {
        throw new Error('avatar signed URL response was invalid');
      }
      return data.signedUrl;
    },

    async logout() {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
  },

  tables: {
    companies: createTableAdapter('companies'),
    companyMembers: createCompanyMembersAdapter(),
    jobs: createJobsAdapter(),
    timeEntries: createTimeEntriesAdapter(),
    equipment: createEquipmentAdapter(),
    equipmentLogs: createEquipmentLogsAdapter(),
    preStarts: createPreStartsAdapter(),
    jobPhotos: createJobPhotosAdapter(),
    leaveRequests: createLeaveRequestsAdapter(),
    jobSchedules: createJobSchedulesAdapter(),
    messages: createMessagesAdapter(),
    messageReads: createMessageReadsAdapter(),
    invitations: createInvitationsAdapter(),
  },

  teamMap: createTeamMapAdapter(),

  storage: {
    async upload(bucket, path, file, options = {}) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, file, { upsert: false, ...options });
      if (error) throw error;
      return data;
    },

    async signedUrl(bucket, path, expiresIn = 3600) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, expiresIn);
      if (error) throw error;
      return data.signedUrl;
    },
  },
};
