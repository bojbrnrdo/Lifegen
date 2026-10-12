-- Allow the lifegroup export outcome statuses on people.status.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'people'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%status%' LOOP
    EXECUTE format('ALTER TABLE people DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE people ADD CONSTRAINT people_status_check
  CHECK (status IN ('first_timer','new_believer','regular','visitor_3','visitor_2','visitor_1','no_returns','member','leader','volunteer','inactive'));

INSERT INTO schema_migrations(version) VALUES ('005_people_status_outcomes') ON CONFLICT DO NOTHING;
