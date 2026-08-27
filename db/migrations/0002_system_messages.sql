-- Document Chat — system messages in the thread.
--
-- Run once against your Neon database:
--   psql "$DATABASE_URL" -f db/migrations/0002_system_messages.sql
--
-- A `system` message is written whenever the app hits an error it wants the
-- reader to know about after the fact (a failed document switch, a retrieval
-- failure, a rejected upload). It is persisted alongside the conversation so
-- the record of "something went wrong here" survives a reload, exactly like
-- the user and assistant turns around it.
--
-- The 0001 constraint already permitted 'note'; this widens it to 'system'
-- without dropping anything that was previously allowed.

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname
    INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'messages'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%role%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE messages DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE messages
  ADD CONSTRAINT messages_role_check
  CHECK (role IN ('user', 'assistant', 'note', 'system'));
