export const PRODUCTION_SUPABASE_PROJECT_REF = 'eyrqcahewcgxvggblbho';

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

export const shouldValidateSupabaseDevelopmentConfig = ({ command, isPreview } = {}) => (
  command === 'serve' && !isPreview
);

export const getSupabaseProjectRef = (supabaseUrl) => {
  if (typeof supabaseUrl !== 'string' || !supabaseUrl.trim()) return null;

  try {
    const parsed = new URL(supabaseUrl);
    const match = parsed.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
    if (parsed.protocol !== 'https:' || !match) return null;
    return match[1];
  } catch {
    return null;
  }
};

/**
 * @param {{
 *   supabaseUrl?: string,
 *   expectedProjectRef?: string,
 *   productionProjectRef?: string
 * }} config
 */
export const assertSafeDevelopmentSupabaseConfig = ({
  supabaseUrl,
  expectedProjectRef,
  productionProjectRef = PRODUCTION_SUPABASE_PROJECT_REF,
} = {}) => {
  const actualProjectRef = getSupabaseProjectRef(supabaseUrl);

  if (!actualProjectRef) {
    throw new Error('Development Supabase URL is missing or invalid. No connection was attempted.');
  }

  if (actualProjectRef === productionProjectRef) {
    throw new Error('Development Supabase configuration points to production. No connection was attempted.');
  }

  if (!PROJECT_REF_PATTERN.test(expectedProjectRef || '')) {
    throw new Error('VITE_EXPECTED_SUPABASE_PROJECT_REF must identify the approved non-production project.');
  }

  if (actualProjectRef !== expectedProjectRef) {
    throw new Error('Development Supabase configuration does not match the approved project reference.');
  }

  return actualProjectRef;
};
