const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MEDIA_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const PAGE_SIZE = 20;
const SIGNED_URL_SECONDS = 60;

const invalidResponse = field => new Error(`Site Photos response contains an invalid ${field}`);

const requiredObject = (value, field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse(field);
  return value;
};

const requiredText = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw invalidResponse(field);
  return value.trim();
};

const optionalText = (value, field) => {
  if (value === null) return null;
  return requiredText(value, field);
};

const requiredUuid = (value, field) => {
  const id = requiredText(value, field).toLowerCase();
  if (!UUID_PATTERN.test(id)) throw invalidResponse(field);
  return id;
};

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

const optionalDimension = (value, field) => {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 1 || value > 100000) throw invalidResponse(field);
  return value;
};

const normalizeScope = scope => {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('An authenticated Site Photos workspace is required');
  }
  const role = requiredText(scope.role, 'workspace role');
  if (!['owner', 'admin', 'worker'].includes(role)) {
    throw Object.assign(new Error('Site Photos access requires an active company role'), { code: '42501' });
  }
  return {
    userId: requiredUuid(scope.userId, 'authenticated user'),
    companyId: requiredUuid(scope.companyId, 'company ID'),
    jobId: requiredUuid(scope.jobId, 'Job ID'),
    role,
  };
};

const normalizeFilters = filters => {
  const workerId = filters?.workerId === null || filters?.workerId === undefined
    ? null
    : requiredUuid(filters.workerId, 'worker filter');
  const dateFrom = filters?.dateFrom ? requiredDate(filters.dateFrom, 'start date') : null;
  const dateTo = filters?.dateTo ? requiredDate(filters.dateTo, 'end date') : null;
  if (dateFrom && dateTo && dateTo < dateFrom) throw new Error('Site Photos end date cannot be before start date');
  return { workerId, dateFrom, dateTo };
};

const canonicalPath = (value, scope, workerId, mediaType) => {
  const path = requiredText(value, 'private object path');
  const match = path.match(/^company\/([0-9a-f-]{36})\/jobs\/([0-9a-f-]{36})\/workers\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|png|webp)$/);
  if (
    !match
    || !UUID_PATTERN.test(match[1])
    || !UUID_PATTERN.test(match[2])
    || !UUID_PATTERN.test(match[3])
    || !UUID_PATTERN.test(match[4])
    || match[1] !== scope.companyId
    || match[2] !== scope.jobId
    || match[3] !== workerId
    || match[5] !== MEDIA_EXTENSIONS.get(mediaType)
  ) throw invalidResponse('private object path');
  return path;
};

export const mapSitePhoto = (value, scope, expectedPhotoId = null) => {
  const row = requiredObject(value, 'photo');
  const id = requiredUuid(row.id, 'photo ID');
  const companyId = requiredUuid(row.company_id, 'company ID');
  const jobId = requiredUuid(row.job_id, 'Job ID');
  const workerId = requiredUuid(row.worker_id, 'uploader ID');
  if (
    companyId !== scope.companyId
    || jobId !== scope.jobId
    || (expectedPhotoId && id !== expectedPhotoId)
  ) throw new Error('Site Photos response crossed the authorised company, Job, or photo scope');

  const mediaType = requiredText(row.media_type, 'media type').toLowerCase();
  if (!MEDIA_TYPES.has(mediaType)) throw invalidResponse('media type');
  if (!Number.isInteger(row.file_size_bytes) || row.file_size_bytes < 1 || row.file_size_bytes > 20971520) {
    throw invalidResponse('file size');
  }
  const width = optionalDimension(row.image_width, 'image width');
  const height = optionalDimension(row.image_height, 'image height');
  if ((width === null) !== (height === null)) throw invalidResponse('image dimensions');

  return {
    id,
    company_id: companyId,
    job_id: jobId,
    worker_id: workerId,
    worker_name: requiredText(row.worker_name, 'uploader name'),
    job_name: requiredText(row.job_name, 'Job name'),
    job_number: requiredText(row.job_number, 'Job number'),
    photo_path: canonicalPath(row.photo_path, scope, workerId, mediaType),
    date: requiredDate(row.date, 'recorded date'),
    notes: optionalText(row.notes, 'notes'),
    media_type: mediaType,
    file_size_bytes: row.file_size_bytes,
    image_width: width,
    image_height: height,
    captured_at: optionalTimestamp(row.captured_at, 'capture timestamp'),
    uploaded_at: requiredTimestamp(row.uploaded_at, 'upload timestamp'),
    created_at: requiredTimestamp(row.created_at, 'creation timestamp'),
  };
};

export const createSitePhotosReadAdapter = (rpc, createSignedUrl) => {
  if (typeof rpc !== 'function') throw new Error('A Supabase RPC client is required');
  if (typeof createSignedUrl !== 'function') throw new Error('A Supabase Storage client is required');

  return {
    async list(scope, { cursor = null, workerId = null, dateFrom = null, dateTo = null } = {}) {
      const normalized = normalizeScope(scope);
      const filters = normalizeFilters({ workerId, dateFrom, dateTo });
      const normalizedCursor = cursor === null ? null : {
        createdAt: requiredTimestamp(requiredObject(cursor, 'cursor').createdAt, 'cursor timestamp'),
        id: requiredUuid(cursor.id, 'cursor photo ID'),
      };
      const { data, error } = await rpc('list_job_photos', {
        p_company_id: normalized.companyId,
        p_job_id: normalized.jobId,
        p_before_created_at: normalizedCursor?.createdAt ?? null,
        p_before_id: normalizedCursor?.id ?? null,
        p_worker_id: filters.workerId,
        p_date_from: filters.dateFrom,
        p_date_to: filters.dateTo,
      });
      if (error) throw error;
      const payload = requiredObject(data, 'list envelope');
      if (payload.page_size !== PAGE_SIZE || !Array.isArray(payload.photos)) throw invalidResponse('list envelope');
      const items = payload.photos.map(photo => mapSitePhoto(photo, normalized));
      for (let index = 1; index < items.length; index += 1) {
        const previous = items[index - 1];
        const current = items[index];
        if (
          Date.parse(current.created_at) > Date.parse(previous.created_at)
          || (current.created_at === previous.created_at && current.id > previous.id)
        ) throw invalidResponse('newest-first ordering');
      }
      return {
        items,
        has_more: items.length === PAGE_SIZE,
        next_cursor: items.length ? { createdAt: items.at(-1).created_at, id: items.at(-1).id } : null,
      };
    },

    async get(scope, photoId) {
      const normalized = normalizeScope(scope);
      const normalizedPhotoId = requiredUuid(photoId, 'photo ID');
      const { data, error } = await rpc('get_job_photo', {
        p_company_id: normalized.companyId,
        p_job_photo_id: normalizedPhotoId,
      });
      if (error) throw error;
      const payload = requiredObject(data, 'detail envelope');
      return mapSitePhoto(payload.job_photo, normalized, normalizedPhotoId);
    },

    async createImageUrl(scope, photo) {
      const normalized = normalizeScope(scope);
      const normalizedPhoto = mapSitePhoto(photo, normalized, requiredUuid(photo?.id, 'photo ID'));
      const { data, error } = await createSignedUrl('job-photos', normalizedPhoto.photo_path, SIGNED_URL_SECONDS);
      if (error) throw error;
      const signedUrl = requiredText(data?.signedUrl, 'signed image URL');
      let parsed;
      try { parsed = new URL(signedUrl); } catch { throw invalidResponse('signed image URL'); }
      if (parsed.protocol !== 'https:') throw invalidResponse('signed image URL');
      return signedUrl;
    },
  };
};
