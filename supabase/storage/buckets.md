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

Path format:

```text
company/{company_id}/jobs/{job_id}/{photo_id}.{ext}
```

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
