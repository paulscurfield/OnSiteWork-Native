# Supabase API Adapter

This folder is the migration foundation for replacing `base44.*` calls without changing React pages yet.

## Files

- `client.js` creates the browser Supabase client from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- `adapter.js` exposes a small app-owned API wrapper around auth, table CRUD, and storage.

## Migration Rule

Do not import this adapter into a page until that page/module is actively being migrated and tested.

The intended order is:

1. Auth/profile/company loading
2. Jobs
3. Clock-in/time entries
4. Timesheets/admin payroll
5. Equipment/logs
6. Pre-starts
7. Site photos/storage
8. Leave
9. Messages
10. Invites/email exports
