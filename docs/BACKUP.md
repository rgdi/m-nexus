# Backups (v2.6.0)

M-NEXUS automatically backs up your data directory every N hours with smart rotation and optional remote push.

## What's backed up

- `data/*.json` — all notes, flashcards, folders, subjects, events, tasks, etc.
- `data/users.json` — admin user (hashed password)
- `data/ai-config.json` — AI provider config
- `data/backup-config.json` — this config
- `data/m-nexus.db` — if SQLite is in use

Stored as `tar.gz` in `data/backups/YYYY-MM-DD_HHMM.tar.gz`.

## Schedule

Configured in setup wizard (slide 8) or via `POST /api/v1/admin/backup/config`:

| Interval | Default | Range |
|---|---|---|
| Backup frequency | 24h | 6h / 12h / 24h / disabled (0) |
| Keep daily | 30 | 7 / 30 / 90 |
| Keep monthly | 12 | (fixed) |

Smart rotation keeps the **N most recent daily backups** plus **1 per month** (up to 12). Older backups are deleted automatically.

## Manual trigger

```bash
# From CLI wrapper
mnexus backup run

# From API (requires admin JWT)
curl -X POST -H "Authorization: Bearer $TOK" \
  http://localhost:4100/api/v1/admin/backup/run
```

## Restore

```bash
# From CLI wrapper
mnexus backup restore 2026-09-16_0300.tar.gz

# Manually
tar -xzf data/backups/2026-09-16_0300.tar.gz -C data/
```

## Remote push (optional)

In setup wizard slide 8, you can provide a command that runs after each backup. The placeholder `{}` is replaced with the backup file path.

Examples:

```bash
# rclone to S3
rclone copy {} s3:my-mnexus-backups/

# rclone to Google Drive
rclone copy {} gdrive:mnexus-backups/

# rsync to remote SSH
rsync -avz {} user@nas.example.com:/backups/mnexus/

# Copy to local USB mount
cp {} /mnt/usb/backups/
```

⚠️ **Security note:** the remote command runs with the same privileges as the M-NEXUS process. Don't use `sudo`, and don't pass unsanitized paths. The `{}` is shell-quoted by the script.

## File integrity

Each backup has a SHA256 hash stored in the backup entry. Use it to verify integrity:

```bash
sha256sum data/backups/2026-09-16_0300.tar.gz
# Compare with the hash returned by GET /api/v1/admin/backup
```

## WORM mode (audit-only)

If `BACKUP_WORM=true`, backups are written to a write-once-read-many directory (good for compliance). See `backend/src/utils/wormAudit.ts`.
