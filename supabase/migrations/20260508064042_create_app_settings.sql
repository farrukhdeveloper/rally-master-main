/*
  # Create app_settings table

  1. New Tables
    - `app_settings`
      - `key` (text, primary key) — setting identifier e.g. "app_name"
      - `value` (text) — setting value
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS
    - Admins can read/write; everyone (authenticated) can read
    - Seed default app_name = 'Rally Master'
*/

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read settings"
  ON app_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can update settings"
  ON app_settings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can insert settings"
  ON app_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

INSERT INTO app_settings (key, value) VALUES ('app_name', 'Rally Master')
ON CONFLICT (key) DO NOTHING;
