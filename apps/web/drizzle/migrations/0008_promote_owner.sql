-- Promote the earliest-created admin to owner, but only if no owner exists yet.
-- Idempotent and a no-op on a fresh install with no admins (owner is then set
-- manually via SQL, like the first admin).
UPDATE "user"
SET "role" = 'owner'
WHERE "id" = (
  SELECT "id" FROM "user" WHERE "role" = 'admin' ORDER BY "created_at" ASC LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM "user" WHERE "role" = 'owner');
