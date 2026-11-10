# W00 Supabase Contract Baseline

This baseline records read-only production metadata inspected on 10 November 2026 for the On-Site Works project. It contains no company records, worker records, environment values, keys, tokens or credentials. It does not authorize RPC invocation, database changes or application integration work beyond W00.

## Development configuration safety

Vercel Production and Preview are separately verified to target the authoritative production project. Local development must use an explicitly approved non-production project.

A sanitized inspection classified the current ignored `.env.local` URL as the authoritative production project. No environment value or key was printed or copied. Local Vite development is therefore intentionally blocked until an approved non-production reference and matching URL are configured.

`VITE_EXPECTED_SUPABASE_PROJECT_REF` is a non-secret development safety value. During Vite development, startup is blocked when the configured URL is invalid, targets production or does not match this approved reference. Production builds do not run this development-only assertion.

## Priority production contracts

All functions below are in `public`, use `SECURITY DEFINER` with a controlled search path, and grant EXECUTE to `authenticated`. Authorization still occurs inside each function.

| Function | Identity arguments | Return type and verified top-level shape |
| --- | --- | --- |
| `get_active_workspace` | none | `TABLE(company_id uuid, company_name text, role text)`; at most the active membership and normalized role |
| `get_my_workspace` | none | `TABLE(company_id uuid, company_name text, role text)`; all memberships with `supervisor` normalized to `worker` |
| `set_active_workspace` | `p_company_id uuid` | same table shape after membership-checked preference update |
| `get_calendar_events` | `p_company_id uuid, p_start_date date, p_end_date date` | `jsonb` with `events`; leave titles are sanitized and notes are returned only for manual events to Owner/Admin |
| `create_calendar_event_admin` | `p_company_id uuid, p_title text, p_start_date date, p_end_date date, p_job_id uuid, p_color text, p_notes text` | `jsonb` with `event` |
| `update_calendar_event_admin` | `p_company_id uuid, p_event_id uuid, p_expected_updated_at timestamptz, p_title text, p_start_date date, p_end_date date, p_job_id uuid, p_color text, p_notes text` | `jsonb` with `event`; optimistic concurrency is required |
| `delete_calendar_event_admin` | `p_company_id uuid, p_event_id uuid, p_expected_updated_at timestamptz` | `jsonb` with `deleted_event_id` and `company_id`; only manual events |
| `get_equipment_pre_start_status_today` | `p_company_id uuid, p_equipment_id uuid` | `jsonb` with `local_date`, `primary_inspection`, `open_faults`, `is_stood_down`; Sydney date is calculated server-side |

## Later-package contract inventory

The following client-facing production contracts were observed. Exact JSON payload fields remain to be verified from function definitions before each package is implemented.

- Timesheets: `clock_in_time_entry`, `clock_out_time_entry`, `get_my_active_time_entry`, `create_manual_time_entry`, `approve_timesheet_period_admin`, `finalise_timesheet_period_admin`, `reopen_timesheet_period_admin`, `create_payroll_export_admin`, `get_payroll_export_admin`.
- Equipment: `create_equipment_admin`, `update_equipment_admin`, `checkout_equipment`, `return_equipment`, `force_return_equipment_admin`, `retire_equipment_admin`, `restore_equipment_admin`, `set_equipment_photo_admin`.
- Pre-Starts: `start_pre_start_inspection`, `save_pre_start_draft`, `submit_pre_start_inspection`, `get_pre_start_inspection`, `get_pre_start_inspection_admin`, `get_pre_start_inspection_pdf`, `list_company_pre_start_history_admin_v2`, `list_company_outstanding_pre_start_faults_admin`, `prepare_pre_start_fault_photo_upload`, `complete_pre_start_fault_photo_upload`, `resolve_pre_start_fault_admin`, `acknowledge_pre_start_inspection`.
- Toolbox Talks: `create_toolbox_talk_draft_v2`, `complete_toolbox_talk_v2`, `get_toolbox_talk`, `get_toolbox_talk_form_context`, `list_company_toolbox_talks_admin`, `list_job_toolbox_talks`, `list_toolbox_talk_question_templates_admin`, `upsert_toolbox_talk_question_template_admin`.
- Site Diaries: `start_site_diary_draft`, `save_site_diary_draft`, `complete_site_diary`, `correct_site_diary_admin`, `get_site_diary`, `get_site_diary_for_date`, `get_site_diary_toolbox_suggestions`, `create_site_diary_delivery_v2`, `list_site_diary_deliveries_v2`, `list_company_site_diary_exports_admin`, `link_site_diary_delivery_photo`.
- Site Photos: `create_job_photo`, `create_job_photo_with_metadata`, `get_job_photo`, `get_job_photo_admin`, `retire_job_photo_admin`, `get_site_photo_overview_admin`, `list_company_site_photos_admin`.
- Purchase Orders: `create_purchase_order_admin`, `update_purchase_order_draft_admin`, `approve_purchase_order_admin`, `cancel_purchase_order_admin`.
- Leave: `create_leave_request_worker`, `get_my_leave_requests`, `get_company_leave_requests_admin`, `review_leave_request_admin`, `delete_leave_request`.
- Team and Profile: `get_company_team`, `change_company_member_role_admin`, `remove_company_member_admin`, `create_company_invitation_admin`, `accept_company_invitation`, `update_my_profile`.

All inspected application tables have RLS enabled. The six inspected buckets—`avatars`, `equipment-photos`, `exports`, `job-photos`, `message-attachments` and `pre-start-fault-photos`—are private.

## Unresolved or restricted contracts

- `submit_my_timesheet_period` and `correct_locked_time_entry_admin` currently grant EXECUTE to `service_role`, not `authenticated`. W05 cannot call them from the browser and must verify the approved client-facing workflow before implementation.
- Legacy `delete_job_photo_admin` does not grant EXECUTE to `authenticated`. W10 should prefer the authenticated `retire_job_photo_admin` lifecycle and separately verify whether hard deletion is ever approved.
- No dedicated Pre-Start ZIP RPC was found by name. The approved ZIP may be assembled from authorized `get_pre_start_inspection_pdf` results; W07 must verify the native mechanism before choosing an implementation.
- JSON response fields for later-package functions are not established merely by a `jsonb` return type. Each consuming package must inspect the deployed function definition and add contract tests before integration.
- Function presence and EXECUTE grants do not replace active-workspace, membership and role authorization tests.
