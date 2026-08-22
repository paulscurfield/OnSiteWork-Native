# Supabase Storage Buckets

All buckets are private. Store object paths in application tables, then use signed URLs for display/download.

## avatars

Profile images.

Path format:

```text
user/{user_id}/avatar-{timestamp}.{ext}
```

## job-photos

Site photos uploaded by workers.

Private: yes

Maximum file size: 20 MiB

Allowed MIME types:

- image/jpeg
- image/png
- image/webp

Path format:

```text
company/{company_uuid}/jobs/{job_uuid}/workers/{worker_uuid}/{photo_uuid}.{ext}
```

Permissions:

- Workers can upload their own canonical Site Photo path and read their own objects.
- Supervisors can read company Site Photo objects.
- Admins and owners can read and delete company Site Photo objects.
- Each Site Photo object path may be attached to at most one job_photos row.
- Historical committed Site Photos remain readable after their Job row is deleted.
- Site Photo objects are not updated in place.
- Site Photos have no public access.
- Applying the secure Supabase Site Photo foundation fails if incompatible old Supabase job-photos paths already exist; no automatic legacy-path migration is performed.
- Base44 Site Photos are not read, copied, imported, backfilled, or migrated.

## equipment-photos

Equipment/vehicle photos.

Path format:

```text
company/{company_id}/equipment/{equipment_id}/{photo_id}.{ext}
```

## exports

Payroll, MYOB, pre-start, and admin-generated exports.

Path format:

```text
company/{company_id}/payroll/{export_id}.csv
company/{company_id}/prestarts/{export_id}.csv
```

## message-attachments

Reserved for future message attachments.

Path format:

```text
company/{company_id}/messages/{message_id}/{attachment_id}.{ext}
```
