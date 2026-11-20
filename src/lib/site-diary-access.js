const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPROVED_ROLES = new Set(['owner', 'admin', 'worker']);

export const resolveSiteDiaryReadScope = ({ jobScope, job }) => {
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

export const createSiteDiaryScopeKey = scope => (
  scope ? `${scope.userId}:${scope.companyId}:${scope.role}:${scope.jobId}` : null
);

export const createSiteDiaryRequestKey = (scope, siteDiaryId = null, localDate = null) => {
  const scopeKey = createSiteDiaryScopeKey(scope);
  if (!scopeKey) return null;
  if (siteDiaryId === null && localDate === null) return scopeKey;
  if (
    typeof siteDiaryId !== 'string'
    || !UUID_PATTERN.test(siteDiaryId)
    || typeof localDate !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)
  ) return null;
  return `${scopeKey}:${siteDiaryId.toLowerCase()}:${localDate}`;
};

export const isSiteDiaryPermissionError = error => (
  error?.code === '28000'
  || error?.code === '42501'
  || /authentication|permission|not authorized|active company|membership/i.test(error?.message || '')
);
