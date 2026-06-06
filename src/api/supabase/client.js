/**
 * Supabase client foundation.
 *
 * This file is intentionally not imported by any React page yet. It exists so
 * the Base44 migration can proceed behind an adapter without changing screens
 * module-by-module until each area is ready.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Keep this warning gentle while the project still runs on Base44.
  console.warn('Supabase environment variables are not configured yet.');
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
