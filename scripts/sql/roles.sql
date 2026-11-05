-- Least-privilege roles. Run once as the database owner, after migrations:
--   psql "$DATABASE_URL_OWNER" -v ingest_password=... -v web_password=... -f scripts/sql/roles.sql
--
-- ALTER DEFAULT PRIVILEGES means the web role can read every future table.
-- A task that adds a table holding article text or other sensitive data must
-- revoke web access to it in that same task.

SELECT format('CREATE ROLE signalfeed_ingest LOGIN PASSWORD %L', :'ingest_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'signalfeed_ingest') \gexec

SELECT format('CREATE ROLE signalfeed_web LOGIN PASSWORD %L', :'web_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'signalfeed_web') \gexec

ALTER ROLE signalfeed_ingest PASSWORD :'ingest_password';
ALTER ROLE signalfeed_web PASSWORD :'web_password';

GRANT USAGE ON SCHEMA public TO signalfeed_ingest, signalfeed_web;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO signalfeed_ingest;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO signalfeed_ingest;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO signalfeed_web;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO signalfeed_ingest;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO signalfeed_ingest;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO signalfeed_web;

-- Feed summaries are LLM input only and are never shown.
REVOKE ALL ON source_item_texts FROM signalfeed_web;
