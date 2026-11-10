import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  PRODUCTION_SUPABASE_PROJECT_REF,
  assertSafeDevelopmentSupabaseConfig,
  getSupabaseProjectRef,
  shouldValidateSupabaseDevelopmentConfig,
} from '../../src/api/supabase/project-reference.js';

const APPROVED_TEST_REF = 'abcdefghijklmnopqrst';
const OTHER_TEST_REF = 'tsrqponmlkjihgfedcba';

const assertSanitizedFailure = (callback, expectedMessage, forbiddenValues = []) => {
  assert.throws(callback, (error) => {
    assert.match(error.message, expectedMessage);
    forbiddenValues.forEach((value) => assert.equal(error.message.includes(value), false));
    return true;
  });
};

test('extracts a valid project reference without retaining credentials or paths', () => {
  assert.equal(
    getSupabaseProjectRef(`https://${APPROVED_TEST_REF}.supabase.co/private?token=do-not-log`),
    APPROVED_TEST_REF
  );
  assert.equal(getSupabaseProjectRef('not-a-url'), null);
  assert.equal(getSupabaseProjectRef('https://example.com'), null);
});

test('accepts only the explicitly approved non-production project', () => {
  assert.equal(
    assertSafeDevelopmentSupabaseConfig({
      supabaseUrl: `https://${APPROVED_TEST_REF}.supabase.co`,
      expectedProjectRef: APPROVED_TEST_REF,
    }),
    APPROVED_TEST_REF
  );
});

test('blocks a missing Supabase URL at the guard boundary', () => {
  assertSanitizedFailure(
    () => assertSafeDevelopmentSupabaseConfig({
      expectedProjectRef: APPROVED_TEST_REF,
    }),
    /missing or invalid/
  );
});

test('blocks a malformed Supabase URL without exposing its contents', () => {
  const malformedUrl = `https://user:credential@example.com/${OTHER_TEST_REF}`;

  assertSanitizedFailure(
    () => assertSafeDevelopmentSupabaseConfig({
      supabaseUrl: malformedUrl,
      expectedProjectRef: APPROVED_TEST_REF,
    }),
    /missing or invalid/,
    [malformedUrl, 'credential', OTHER_TEST_REF]
  );
});

test('blocks a missing expected development project reference', () => {
  assertSanitizedFailure(
    () => assertSafeDevelopmentSupabaseConfig({
      supabaseUrl: `https://${APPROVED_TEST_REF}.supabase.co`,
    }),
    /VITE_EXPECTED_SUPABASE_PROJECT_REF/,
    [APPROVED_TEST_REF]
  );
});

test('blocks an invalid expected development project reference without exposing it', () => {
  const invalidExpectedRef = `invalid-${OTHER_TEST_REF}`;

  assertSanitizedFailure(
    () => assertSafeDevelopmentSupabaseConfig({
      supabaseUrl: `https://${APPROVED_TEST_REF}.supabase.co`,
      expectedProjectRef: invalidExpectedRef,
    }),
    /VITE_EXPECTED_SUPABASE_PROJECT_REF/,
    [APPROVED_TEST_REF, invalidExpectedRef, OTHER_TEST_REF]
  );
});

test('blocks the production project during development without echoing its URL', () => {
  const sensitiveUrl = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co/secret-value`;

  assert.throws(
    () => assertSafeDevelopmentSupabaseConfig({
      supabaseUrl: sensitiveUrl,
      expectedProjectRef: APPROVED_TEST_REF,
    }),
    (error) => {
      assert.match(error.message, /points to production/);
      assert.equal(error.message.includes(sensitiveUrl), false);
      assert.equal(error.message.includes(PRODUCTION_SUPABASE_PROJECT_REF), false);
      return true;
    }
  );
});

test('blocks an unexpected project without echoing either reference', () => {
  assert.throws(
    () => assertSafeDevelopmentSupabaseConfig({
      supabaseUrl: `https://${OTHER_TEST_REF}.supabase.co`,
      expectedProjectRef: APPROVED_TEST_REF,
    }),
    (error) => {
      assert.match(error.message, /does not match/);
      assert.equal(error.message.includes(OTHER_TEST_REF), false);
      assert.equal(error.message.includes(APPROVED_TEST_REF), false);
      return true;
    }
  );
});

test('validates a development server even when Vite uses production mode', () => {
  assert.equal(
    shouldValidateSupabaseDevelopmentConfig({
      command: 'serve',
      mode: 'production',
      isPreview: false,
    }),
    true
  );
});

test('does not validate normal builds or the Vite preview server', () => {
  assert.equal(
    shouldValidateSupabaseDevelopmentConfig({
      command: 'build',
      mode: 'production',
      isPreview: false,
    }),
    false
  );
  assert.equal(
    shouldValidateSupabaseDevelopmentConfig({
      command: 'build',
      mode: 'preview',
      isPreview: false,
    }),
    false
  );
  assert.equal(
    shouldValidateSupabaseDevelopmentConfig({
      command: 'serve',
      mode: 'production',
      isPreview: true,
    }),
    false
  );
});

test('documents the expected project reference variable without a value', () => {
  const example = fs.readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  assert.match(example, /^VITE_EXPECTED_SUPABASE_PROJECT_REF=$/m);
});
