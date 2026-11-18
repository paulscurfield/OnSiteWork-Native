const JOB_STATUS_LABELS = Object.freeze({
  active: 'ACTIVE',
  completed: 'COMPLETED',
  on_hold: 'On hold',
});

export const formatJobStatusLabel = status => (
  JOB_STATUS_LABELS[status] ?? String(status ?? '')
);
