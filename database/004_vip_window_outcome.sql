-- Lifegroup tracker export: remember each VIP's 4-week outcome (the status the
-- person was exported as once their 4-week window since invitation closed).
ALTER TABLE vip_registrations ADD COLUMN IF NOT EXISTS window_outcome text;
ALTER TABLE vip_registrations ADD COLUMN IF NOT EXISTS outcome_applied_at timestamptz;

INSERT INTO schema_migrations(version) VALUES ('004_vip_window_outcome') ON CONFLICT DO NOTHING;
