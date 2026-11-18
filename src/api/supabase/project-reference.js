export const DEVELOPMENT_SUPABASE_PROJECT_REF = 'eyejarxvlmjxeedcserm';
export const PRODUCTION_SUPABASE_PROJECT_REF = 'eyrqcahewcgxvggblbho';
export const VALIDATION_SUPABASE_PROJECT_REF = 'amhrxkimokiqqflsugys';

export const SUPABASE_BUILD_ATTESTATION_FILE = 'onsite-w01-supabase-build.json';

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const SUPABASE_PROJECT_URL_PATTERN = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/;
const BUILD_ATTESTATION_KIND = 'onsite-w01-a-development-supabase';
const BUILD_ATTESTATION_VERSION = 1;

const invalidUrlError = () => new Error(
  'Development Supabase URL is missing or invalid. No connection was attempted.'
);

const invalidExpectedProjectError = () => new Error(
  'VITE_EXPECTED_SUPABASE_PROJECT_REF must identify the approved Development project. No connection was attempted.'
);

const mismatchedProjectError = () => new Error(
  'Development Supabase URL and expected project reference do not match. No connection was attempted.'
);

const unapprovedProjectError = () => new Error(
  'Supabase configuration does not identify the approved Development project. No connection was attempted.'
);

const invalidBuildAttestationError = () => new Error(
  'The preview build is not attested for the approved Development Supabase project. Preview was not started.'
);

export const getSupabaseValidationPhase = ({ command, isPreview } = {}) => {
  if (command === 'build') return 'build';
  if (command === 'serve' && isPreview === true) return 'preview';
  if (command === 'serve') return 'development';
  return null;
};

export const shouldValidateSupabaseDevelopmentConfig = (configEnv = {}) => (
  getSupabaseValidationPhase(configEnv) !== null
);

export const getSupabaseProjectRef = (supabaseUrl) => {
  if (typeof supabaseUrl !== 'string' || !supabaseUrl || supabaseUrl !== supabaseUrl.trim()) {
    return null;
  }

  const rawMatch = supabaseUrl.match(SUPABASE_PROJECT_URL_PATTERN);
  if (!rawMatch) return null;

  try {
    const parsed = new URL(supabaseUrl);
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.port
      || parsed.search
      || parsed.hash
      || parsed.pathname !== '/'
      || parsed.hostname !== `${rawMatch[1]}.supabase.co`
      || parsed.origin !== `https://${rawMatch[1]}.supabase.co`
    ) {
      return null;
    }

    return rawMatch[1];
  } catch {
    return null;
  }
};

/**
 * Validates the complete browser-facing Supabase target without accepting a
 * caller-supplied allow-list. The approved Development reference is compiled
 * into this guard and must independently match both configuration values.
 *
 * @param {{ supabaseUrl?: string, expectedProjectRef?: string }} config
 */
export const assertSafeDevelopmentSupabaseConfig = ({
  supabaseUrl,
  expectedProjectRef,
} = {}) => {
  const actualProjectRef = getSupabaseProjectRef(supabaseUrl);

  if (!actualProjectRef) {
    throw invalidUrlError();
  }

  if (!PROJECT_REF_PATTERN.test(expectedProjectRef || '')) {
    throw invalidExpectedProjectError();
  }

  if (actualProjectRef !== expectedProjectRef) {
    throw mismatchedProjectError();
  }

  if (
    actualProjectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF
    || expectedProjectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF
  ) {
    throw unapprovedProjectError();
  }

  return actualProjectRef;
};

export const createApprovedSupabaseBuildAttestation = (validatedProjectRef) => {
  if (validatedProjectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw invalidBuildAttestationError();
  }

  return `${JSON.stringify({
    kind: BUILD_ATTESTATION_KIND,
    version: BUILD_ATTESTATION_VERSION,
    projectRef: DEVELOPMENT_SUPABASE_PROJECT_REF,
    supabaseOrigin: `https://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`,
  }, null, 2)}\n`;
};

export const assertApprovedSupabaseBuildAttestation = (attestationSource) => {
  if (typeof attestationSource !== 'string' || !attestationSource) {
    throw invalidBuildAttestationError();
  }

  let attestation;
  try {
    attestation = JSON.parse(attestationSource);
  } catch {
    throw invalidBuildAttestationError();
  }

  const expectedKeys = ['kind', 'projectRef', 'supabaseOrigin', 'version'];
  const actualKeys = (
    attestation && typeof attestation === 'object' && !Array.isArray(attestation)
      ? Object.keys(attestation).sort()
      : []
  );

  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
    || attestation.kind !== BUILD_ATTESTATION_KIND
    || attestation.version !== BUILD_ATTESTATION_VERSION
    || attestation.projectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF
    || attestation.supabaseOrigin !== `https://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`
  ) {
    throw invalidBuildAttestationError();
  }

  return attestation.projectRef;
};
