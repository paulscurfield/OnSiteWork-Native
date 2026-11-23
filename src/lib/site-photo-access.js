const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPROVED_ROLES = new Set(['owner', 'admin', 'worker']);

export const resolveSitePhotoReadScope = ({ jobScope, job }) => {
  if (
    !jobScope
    || typeof jobScope.userId !== 'string'
    || !UUID_PATTERN.test(jobScope.userId)
    || typeof jobScope.companyId !== 'string'
    || !UUID_PATTERN.test(jobScope.companyId)
    || !APPROVED_ROLES.has(jobScope.role)
    || !job
    || typeof job.id !== 'string'
    || !UUID_PATTERN.test(job.id)
    || typeof job.company_id !== 'string'
    || job.company_id.toLowerCase() !== jobScope.companyId.toLowerCase()
  ) return null;

  return {
    userId: jobScope.userId.toLowerCase(),
    companyId: jobScope.companyId.toLowerCase(),
    companyName: typeof jobScope.companyName === 'string' ? jobScope.companyName : '',
    role: jobScope.role,
    jobId: job.id.toLowerCase(),
    jobName: typeof job.job_name === 'string' ? job.job_name : '',
    jobNumber: typeof job.job_number === 'string' ? job.job_number : '',
  };
};

export const createSitePhotoScopeKey = scope => (
  scope
    ? `${scope.userId}:${scope.companyId}:${scope.role}:${scope.jobId}`
    : null
);

export const createSitePhotoDetailKey = (scope, photoId) => {
  const scopeKey = createSitePhotoScopeKey(scope);
  const normalizedPhotoId = String(photoId || '').trim().toLowerCase();
  return scopeKey && UUID_PATTERN.test(normalizedPhotoId)
    ? `${scopeKey}:${normalizedPhotoId}`
    : null;
};

export const isSitePhotoPermissionError = error => (
  error?.code === '42501' || error?.code === '28000'
);
