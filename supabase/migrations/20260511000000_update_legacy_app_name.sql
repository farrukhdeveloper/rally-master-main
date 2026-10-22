UPDATE app_settings
SET value = 'Rally Master',
    updated_at = now()
WHERE key = 'app_name'
  AND (value IS NULL OR trim(value) = '' OR value = 'ShuttleSync');
