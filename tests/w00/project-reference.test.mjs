import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  DEVELOPMENT_SUPABASE_PROJECT_REF,
  PRODUCTION_SUPABASE_PROJECT_REF,
  SUPABASE_BUILD_ATTESTATION_FILE,
  VALIDATION_SUPABASE_PROJECT_REF,
  assertApprovedSupabaseBuildAttestation,
  assertSafeDevelopmentSupabaseConfig,
  createApprovedSupabaseBuildAttestation,
  getSupabaseProjectRef,
  getSupabaseValidationPhase,
  shouldValidateSupabaseDevelopmentConfig,
} from '../../src/api/supabase/project-reference.js';
import { createSupabaseDevelopmentGuard } from '../../vite.config.js';

const OTHER_PROJECT_REF = 'abcdefghijklmnopqrst';
const APPROVED_URL = `https://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`;
const APPROVED_ENV = Object.freeze({
  VITE_SUPABASE_URL: APPROVED_URL,
  VITE_EXPECTED_SUPABASE_PROJECT_REF: DEVELOPMENT_SUPABASE_PROJECT_REF,
});

const DEVELOPMENT_MODE = Object.freeze({
  command: 'serve',
  mode: 'development',
  isPreview: false,
});
const BUILD_MODE = Object.freeze({
  command: 'build',
  mode: 'production',
  isPreview: false,
});
const PREVIEW_MODE = Object.freeze({
  command: 'serve',
  mode: 'production',
  isPreview: true,
});

const assertSanitizedFailure = (callback, expectedMessage, forbiddenValues = []) => {
  assert.throws(callback, (error) => {
    assert.match(error.message, expectedMessage);
    forbiddenValues
      .filter(Boolean)
      .forEach((value) => assert.equal(error.message.includes(value), false));
    return true;
  });
};

const createGuardHarness = ({
  env = APPROVED_ENV,
  attestation = createApprovedSupabaseBuildAttestation(DEVELOPMENT_SUPABASE_PROJECT_REF),
  readError = null,
} = {}) => {
  const loads = [];
  const reads = [];
  const guard = createSupabaseDevelopmentGuard({
    loadEnvironment: (...args) => {
      loads.push(args);
      return env;
    },
    getWorkingDirectory: () => '/safe/project',
    readBuildAttestation: (...args) => {
      reads.push(args);
      if (readError) throw readError;
      return attestation;
    },
  });

  return { guard, loads, reads };
};

test('extracts only a canonical Supabase project URL', () => {
  assert.equal(getSupabaseProjectRef(APPROVED_URL), DEVELOPMENT_SUPABASE_PROJECT_REF);
  assert.equal(getSupabaseProjectRef(`${APPROVED_URL}/`), DEVELOPMENT_SUPABASE_PROJECT_REF);
  assert.equal(getSupabaseProjectRef('not-a-url'), null);
  assert.equal(getSupabaseProjectRef('https://example.com'), null);
  assert.equal(getSupabaseProjectRef(`${APPROVED_URL}/private`), null);
  assert.equal(getSupabaseProjectRef(`${APPROVED_URL}?token=do-not-log`), null);
});

test('accepts the approved Development URL and matching expected reference', () => {
  assert.equal(
    assertSafeDevelopmentSupabaseConfig({
      supabaseUrl: APPROVED_URL,
      expectedProjectRef: DEVELOPMENT_SUPABASE_PROJECT_REF,
    }),
    DEVELOPMENT_SUPABASE_PROJECT_REF
  );
});

test('rejects production even when URL and expected reference agree', () => {
  const productionUrl = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
  assertSanitizedFailure(
    () => assertSafeDevelopmentSupabaseConfig({
      supabaseUrl: productionUrl,
      expectedProjectRef: PRODUCTION_SUPABASE_PROJECT_REF,
    }),
    /does not identify the approved Development project/,
    [productionUrl, PRODUCTION_SUPABASE_PROJECT_REF]
  );
});

test('rejects paused validation even when URL and expected reference agree', () => {
  const validationUrl = `https://${VALIDATION_SUPABASE_PROJECT_REF}.supabase.co`;
  assertSanitizedFailure(
    () => assertSafeDevelopmentSupabaseConfig({
      supabaseUrl: validationUrl,
      expectedProjectRef: VALIDATION_SUPABASE_PROJECT_REF,
    }),
    /does not identify the approved Development project/,
    [validationUrl, VALIDATION_SUPABASE_PROJECT_REF]
  );
});

test('rejects an arbitrary matching third-party project', () => {
  const otherUrl = `https://${OTHER_PROJECT_REF}.supabase.co`;
  assertSanitizedFailure(
    () => assertSafeDevelopmentSupabaseConfig({
      supabaseUrl: otherUrl,
      expectedProjectRef: OTHER_PROJECT_REF,
    }),
    /does not identify the approved Development project/,
    [otherUrl, OTHER_PROJECT_REF]
  );
});

test('rejects missing or incomplete configuration', () => {
  assertSanitizedFailure(
    () => assertSafeDevelopmentSupabaseConfig({
      expectedProjectRef: DEVELOPMENT_SUPABASE_PROJECT_REF,
    }),
    /URL is missing or invalid/
  );
  assertSanitizedFailure(
    () => assertSafeDevelopmentSupabaseConfig({
      supabaseUrl: APPROVED_URL,
    }),
    /VITE_EXPECTED_SUPABASE_PROJECT_REF/,
    [DEVELOPMENT_SUPABASE_PROJECT_REF]
  );
  assertSanitizedFailure(
    () => assertSafeDevelopmentSupabaseConfig({
      supabaseUrl: APPROVED_URL,
      expectedProjectRef: 'incomplete',
    }),
    /VITE_EXPECTED_SUPABASE_PROJECT_REF/,
    [APPROVED_URL, DEVELOPMENT_SUPABASE_PROJECT_REF, 'incomplete']
  );
});

test('rejects malformed URLs and incorrect hostnames without echoing them', () => {
  const invalidUrls = [
    'not-a-url',
    'https://example.com',
    `https://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.com`,
  ];

  for (const invalidUrl of invalidUrls) {
    assertSanitizedFailure(
      () => assertSafeDevelopmentSupabaseConfig({
        supabaseUrl: invalidUrl,
        expectedProjectRef: DEVELOPMENT_SUPABASE_PROJECT_REF,
      }),
      /URL is missing or invalid/,
      [invalidUrl, DEVELOPMENT_SUPABASE_PROJECT_REF]
    );
  }
});

test('rejects hostname prefix and suffix attacks', () => {
  const hostileUrls = [
    `https://evil${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`,
    `https://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co.evil.example`,
    `https://${DEVELOPMENT_SUPABASE_PROJECT_REF}-supabase.co`,
  ];

  for (const hostileUrl of hostileUrls) {
    assertSanitizedFailure(
      () => assertSafeDevelopmentSupabaseConfig({
        supabaseUrl: hostileUrl,
        expectedProjectRef: DEVELOPMENT_SUPABASE_PROJECT_REF,
      }),
      /URL is missing or invalid/,
      [hostileUrl, DEVELOPMENT_SUPABASE_PROJECT_REF]
    );
  }
});

test('rejects unsupported schemes and every explicit port', () => {
  const invalidUrls = [
    `http://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`,
    `ftp://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`,
    `https://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co:443`,
    `https://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co:8443`,
  ];

  for (const invalidUrl of invalidUrls) {
    assertSanitizedFailure(
      () => assertSafeDevelopmentSupabaseConfig({
        supabaseUrl: invalidUrl,
        expectedProjectRef: DEVELOPMENT_SUPABASE_PROJECT_REF,
      }),
      /URL is missing or invalid/,
      [invalidUrl]
    );
  }
});

test('rejects userinfo, paths, query strings, fragments, and surrounding whitespace', () => {
  const invalidUrls = [
    `https://user:password@${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`,
    `${APPROVED_URL}/rest/v1`,
    `${APPROVED_URL}?project=${PRODUCTION_SUPABASE_PROJECT_REF}`,
    `${APPROVED_URL}#${VALIDATION_SUPABASE_PROJECT_REF}`,
    ` ${APPROVED_URL}`,
  ];

  for (const invalidUrl of invalidUrls) {
    assertSanitizedFailure(
      () => assertSafeDevelopmentSupabaseConfig({
        supabaseUrl: invalidUrl,
        expectedProjectRef: DEVELOPMENT_SUPABASE_PROJECT_REF,
      }),
      /URL is missing or invalid/,
      [invalidUrl, 'password', PRODUCTION_SUPABASE_PROJECT_REF, VALIDATION_SUPABASE_PROJECT_REF]
    );
  }
});

test('rejects URL and expected-reference mismatch', () => {
  assertSanitizedFailure(
    () => assertSafeDevelopmentSupabaseConfig({
      supabaseUrl: APPROVED_URL,
      expectedProjectRef: OTHER_PROJECT_REF,
    }),
    /do not match/,
    [APPROVED_URL, DEVELOPMENT_SUPABASE_PROJECT_REF, OTHER_PROJECT_REF]
  );
});

test('classifies development, build, and preview as guarded Vite phases', () => {
  assert.equal(getSupabaseValidationPhase(DEVELOPMENT_MODE), 'development');
  assert.equal(getSupabaseValidationPhase(BUILD_MODE), 'build');
  assert.equal(getSupabaseValidationPhase(PREVIEW_MODE), 'preview');
  assert.equal(shouldValidateSupabaseDevelopmentConfig(DEVELOPMENT_MODE), true);
  assert.equal(shouldValidateSupabaseDevelopmentConfig(BUILD_MODE), true);
  assert.equal(shouldValidateSupabaseDevelopmentConfig(PREVIEW_MODE), true);
  assert.equal(shouldValidateSupabaseDevelopmentConfig({ command: 'unknown' }), false);
});

test('development mode executes the actual Vite guard path', () => {
  const approved = createGuardHarness();
  approved.guard.config({}, DEVELOPMENT_MODE);
  assert.equal(approved.loads.length, 1);

  const protectedConfig = createGuardHarness({
    env: {
      VITE_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
      VITE_EXPECTED_SUPABASE_PROJECT_REF: PRODUCTION_SUPABASE_PROJECT_REF,
    },
  });
  assertSanitizedFailure(
    () => protectedConfig.guard.config({}, DEVELOPMENT_MODE),
    /does not identify the approved Development project/,
    [PRODUCTION_SUPABASE_PROJECT_REF]
  );
});

test('build mode executes the guard and emits an approved non-secret attestation', () => {
  const { guard, loads } = createGuardHarness();
  const emitted = [];

  guard.config({}, BUILD_MODE);
  guard.generateBundle.call({ emitFile: (asset) => emitted.push(asset) });

  assert.equal(loads.length, 1);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, 'asset');
  assert.equal(emitted[0].fileName, SUPABASE_BUILD_ATTESTATION_FILE);
  assert.equal(
    assertApprovedSupabaseBuildAttestation(emitted[0].source),
    DEVELOPMENT_SUPABASE_PROJECT_REF
  );
  assert.equal(emitted[0].source.includes('anon'), false);
  assert.equal(emitted[0].source.includes('service_role'), false);
});

test('build mode stops protected configuration before emitting an attestation', () => {
  const { guard } = createGuardHarness({
    env: {
      VITE_SUPABASE_URL: `https://${VALIDATION_SUPABASE_PROJECT_REF}.supabase.co`,
      VITE_EXPECTED_SUPABASE_PROJECT_REF: VALIDATION_SUPABASE_PROJECT_REF,
    },
  });

  assertSanitizedFailure(
    () => guard.config({}, BUILD_MODE),
    /does not identify the approved Development project/,
    [VALIDATION_SUPABASE_PROJECT_REF]
  );
});

test('preview mode validates current configuration and the generated build attestation', () => {
  const { guard, loads, reads } = createGuardHarness();

  guard.config({}, PREVIEW_MODE);
  guard.configResolved({
    root: '/safe/project',
    build: { outDir: 'legacy-dist' },
    environments: { client: { build: { outDir: 'dist' } } },
  });
  guard.configurePreviewServer();

  assert.equal(loads.length, 1);
  assert.deepEqual(reads, [[
    `/safe/project/dist/${SUPABASE_BUILD_ATTESTATION_FILE}`,
    'utf8',
  ]]);
});

test('preview mode rejects protected configuration before reading build output', () => {
  const { guard, reads } = createGuardHarness({
    env: {
      VITE_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
      VITE_EXPECTED_SUPABASE_PROJECT_REF: PRODUCTION_SUPABASE_PROJECT_REF,
    },
  });

  assertSanitizedFailure(
    () => guard.config({}, PREVIEW_MODE),
    /does not identify the approved Development project/,
    [PRODUCTION_SUPABASE_PROJECT_REF]
  );
  assert.equal(reads.length, 0);
});

test('preview mode rejects missing, malformed, stale, or unexpected attestations', () => {
  const invalidAttestations = [
    '',
    'not-json',
    JSON.stringify({
      kind: 'onsite-w00',
      version: 0,
      projectRef: DEVELOPMENT_SUPABASE_PROJECT_REF,
      supabaseOrigin: APPROVED_URL,
    }),
    JSON.stringify({
      kind: 'onsite-w01-a-development-supabase',
      version: 1,
      projectRef: PRODUCTION_SUPABASE_PROJECT_REF,
      supabaseOrigin: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
    }),
  ];

  for (const attestation of invalidAttestations) {
    const { guard } = createGuardHarness({ attestation });
    guard.config({}, PREVIEW_MODE);
    guard.configResolved({ root: '/safe/project', build: { outDir: 'dist' } });
    assertSanitizedFailure(
      () => guard.configurePreviewServer(),
      /not attested for the approved Development Supabase project/,
      [attestation, PRODUCTION_SUPABASE_PROJECT_REF]
    );
  }

  const missing = createGuardHarness({ readError: new Error('private path') });
  missing.guard.config({}, PREVIEW_MODE);
  missing.guard.configResolved({ root: '/safe/project', build: { outDir: 'dist' } });
  assertSanitizedFailure(
    () => missing.guard.configurePreviewServer(),
    /not attested for the approved Development Supabase project/,
    ['private path', '/safe/project']
  );
});

test('build attestation rejects extra fields and cannot be created for another project', () => {
  const approved = JSON.parse(
    createApprovedSupabaseBuildAttestation(DEVELOPMENT_SUPABASE_PROJECT_REF)
  );
  approved.unexpected = 'value';

  assertSanitizedFailure(
    () => assertApprovedSupabaseBuildAttestation(JSON.stringify(approved)),
    /not attested/
  );
  assertSanitizedFailure(
    () => createApprovedSupabaseBuildAttestation(PRODUCTION_SUPABASE_PROJECT_REF),
    /not attested/,
    [PRODUCTION_SUPABASE_PROJECT_REF]
  );
});

test('documents the expected project reference variable without a value', () => {
  const example = fs.readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  assert.match(example, /^VITE_EXPECTED_SUPABASE_PROJECT_REF=$/m);
});
