const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPROVED_ROLES = new Set(['owner', 'admin', 'worker']);
const ELIGIBLE_CATEGORIES = new Set(['machinery', 'vehicle']);

export const resolvePreStartEquipmentScope = ({ equipmentScope, equipment }) => {
  if (
    !equipmentScope
    || typeof equipmentScope.userId !== 'string'
    || !UUID_PATTERN.test(equipmentScope.userId)
    || typeof equipmentScope.companyId !== 'string'
    || !UUID_PATTERN.test(equipmentScope.companyId)
    || !APPROVED_ROLES.has(equipmentScope.role)
    || !equipment
    || typeof equipment.id !== 'string'
    || !UUID_PATTERN.test(equipment.id)
    || typeof equipment.company_id !== 'string'
    || equipment.company_id.toLowerCase() !== equipmentScope.companyId.toLowerCase()
    || equipment.requires_pre_start !== true
    || !ELIGIBLE_CATEGORIES.has(equipment.category)
  ) return null;

  return {
    userId: equipmentScope.userId.toLowerCase(),
    companyId: equipmentScope.companyId.toLowerCase(),
    companyName: typeof equipmentScope.companyName === 'string' ? equipmentScope.companyName : '',
    role: equipmentScope.role,
    equipmentId: equipment.id.toLowerCase(),
    equipmentName: typeof equipment.name === 'string' ? equipment.name : '',
    equipmentIdentifier: typeof equipment.equipment_id === 'string' ? equipment.equipment_id : '',
    equipmentCategory: equipment.category,
    canReadCompanyHistory: equipmentScope.role === 'owner' || equipmentScope.role === 'admin',
  };
};

export const createPreStartEquipmentScopeKey = scope => (
  scope
    ? `${scope.userId}:${scope.companyId}:${scope.role}:${scope.equipmentId}`
    : null
);

export const createPreStartDetailRequestKey = (scope, inspectionId) => {
  const scopeKey = createPreStartEquipmentScopeKey(scope);
  if (!scopeKey || typeof inspectionId !== 'string' || !UUID_PATTERN.test(inspectionId)) return null;
  return `${scopeKey}:${inspectionId.toLowerCase()}`;
};

export const resolvePreStartJobScope = ({ jobScope, job }) => {
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
    role: jobScope.role,
    jobId: job.id.toLowerCase(),
    jobName: typeof job.job_name === 'string' ? job.job_name : '',
  };
};

export const isPreStartPermissionError = error => (
  error?.code === '28000'
  || error?.code === '42501'
  || /authentication|permission|not authorized|active company|membership/i.test(error?.message || '')
);
