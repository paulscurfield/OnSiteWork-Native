import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  DEVELOPMENT_SUPABASE_PROJECT_REF,
  SUPABASE_BUILD_ATTESTATION_FILE,
  assertApprovedSupabaseBuildAttestation,
  assertSafeDevelopmentSupabaseConfig,
  createApprovedSupabaseBuildAttestation,
  getSupabaseValidationPhase,
} from './src/api/supabase/project-reference.js'

// Builds emit a non-secret target attestation only after configuration passes.
// Preview requires that marker as well as revalidating its current environment,
// so an unguarded or pre-W01 dist directory cannot be served as a verified build.
export const createSupabaseDevelopmentGuard = ({
  loadEnvironment = loadEnv,
  getWorkingDirectory = () => process.cwd(),
  readBuildAttestation = readFileSync,
} = {}) => {
  let validationPhase = null;
  let validatedProjectRef = null;
  let previewAttestationPath = null;

  return {
    name: 'supabase-development-guard',
    enforce: 'pre',

    config: (_, configEnv) => {
      validationPhase = getSupabaseValidationPhase(configEnv);
      if (!validationPhase) return;

      const env = loadEnvironment(configEnv.mode, getWorkingDirectory(), 'VITE_');
      validatedProjectRef = assertSafeDevelopmentSupabaseConfig({
        supabaseUrl: env.VITE_SUPABASE_URL,
        expectedProjectRef: env.VITE_EXPECTED_SUPABASE_PROJECT_REF,
      });
    },

    configResolved: (config) => {
      if (validationPhase !== 'preview') return;
      const clientOutDir = config.environments?.client?.build?.outDir ?? config.build.outDir;
      previewAttestationPath = resolve(
        config.root,
        clientOutDir,
        SUPABASE_BUILD_ATTESTATION_FILE
      );
    },

    generateBundle() {
      if (validationPhase !== 'build') return;
      if (validatedProjectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
        throw new Error('Supabase build target validation did not complete. Build was stopped.');
      }

      this.emitFile({
        type: 'asset',
        fileName: SUPABASE_BUILD_ATTESTATION_FILE,
        source: createApprovedSupabaseBuildAttestation(validatedProjectRef),
      });
    },

    configurePreviewServer() {
      if (
        validationPhase !== 'preview'
        || validatedProjectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF
        || !previewAttestationPath
      ) {
        throw new Error('Supabase preview target validation did not complete. Preview was not started.');
      }

      let attestationSource;
      try {
        attestationSource = readBuildAttestation(previewAttestationPath, 'utf8');
      } catch {
        throw new Error(
          'The preview build is not attested for the approved Development Supabase project. Preview was not started.'
        );
      }

      assertApprovedSupabaseBuildAttestation(attestationSource);
    },
  };
};

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors
  plugins: [
    createSupabaseDevelopmentGuard(),
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      hmrNotifier: true,
      navigationNotifier: true,
      analyticsTracker: true,
      visualEditAgent: true
    }),
    react(),
  ]
});
