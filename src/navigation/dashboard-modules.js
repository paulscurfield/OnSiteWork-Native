const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DASHBOARD_MODULES = Object.freeze([
  {
    key: 'timesheets',
    label: 'Timesheets',
    description: 'Review hours, approvals and payroll-ready records.',
    path: '/timesheets',
    icon: 'clock',
  },
  {
    key: 'jobs',
    label: 'Jobs',
    description: 'Open active job sites and project details.',
    path: '/jobs',
    icon: 'briefcase',
  },
  {
    key: 'equipment',
    label: 'Equipment',
    description: 'Manage plant, vehicles and equipment records.',
    path: '/equipment',
    icon: 'wrench',
  },
  {
    key: 'pre-starts',
    label: 'Pre-Starts',
    description: 'Choose a job before reviewing pre-start records.',
    path: '/work/pre-starts/jobs',
    icon: 'clipboard-check',
    jobFirst: true,
  },
  {
    key: 'toolbox-talks',
    label: 'Toolbox Talks',
    description: 'Choose a job before opening toolbox talks.',
    path: '/work/toolbox-talks/jobs',
    icon: 'hard-hat',
    jobFirst: true,
  },
  {
    key: 'site-diaries',
    label: 'Site Diaries',
    description: 'Choose a job before opening site diary records.',
    path: '/work/site-diaries/jobs',
    icon: 'notebook',
    jobFirst: true,
  },
  {
    key: 'site-photos',
    label: 'Site Photos',
    description: 'Choose a job before reviewing site photos.',
    path: '/work/site-photos/jobs',
    icon: 'camera',
    jobFirst: true,
  },
  {
    key: 'purchase-orders',
    label: 'Purchase Orders',
    description: 'Choose a job before opening purchase orders.',
    path: '/work/purchase-orders/jobs',
    icon: 'shopping-cart',
    jobFirst: true,
  },
  {
    key: 'leave',
    label: 'Leave',
    description: 'Review leave requests and availability.',
    path: '/leave',
    icon: 'calendar-off',
  },
  {
    key: 'team',
    label: 'Team',
    description: 'Open the company team workspace.',
    path: '/team',
    icon: 'users',
  },
  {
    key: 'calendar',
    label: 'Calendar',
    description: 'Coordinate schedules, jobs and upcoming work.',
    path: '/calendar',
    icon: 'calendar',
  },
  {
    key: 'profile',
    label: 'Profile',
    description: 'Manage your details and account settings.',
    path: '/profile',
    icon: 'user',
  },
]);

export const JOB_FIRST_MODULES = Object.freeze(
  Object.fromEntries(
    DASHBOARD_MODULES
      .filter(module => module.jobFirst)
      .map(module => [module.key, module])
  )
);

export const getJobFirstModule = moduleKey => JOB_FIRST_MODULES[moduleKey] || null;

export const isValidJobIdentifier = value => UUID_PATTERN.test(String(value || '').trim());

export const getJobSelectorPath = moduleKey => {
  if (!getJobFirstModule(moduleKey)) {
    throw new Error('Unknown job-first module.');
  }
  return `/work/${moduleKey}/jobs`;
};

export const getJobRecordsPath = (moduleKey, jobId) => {
  if (!isValidJobIdentifier(jobId)) {
    throw new Error('A valid job identifier is required.');
  }
  return `${getJobSelectorPath(moduleKey)}/${String(jobId).trim().toLowerCase()}`;
};

export const createWorkspaceJobContextKey = (companyId, moduleKey, jobId) => {
  const safeCompanyId = String(companyId || '').trim().toLowerCase();
  if (!isValidJobIdentifier(safeCompanyId) || !isValidJobIdentifier(jobId)) {
    return null;
  }
  if (!getJobFirstModule(moduleKey)) {
    return null;
  }
  return `${safeCompanyId}:${moduleKey}:${String(jobId).trim().toLowerCase()}`;
};
