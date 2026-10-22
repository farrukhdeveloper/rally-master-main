/*
  # Move player skill labels to Level 1-9

  The frontend now uses player levels instead of beginner/intermediate/advanced/pro.
  Existing rows are mapped into the closest middle level of their old band:
  beginner -> Level 2, intermediate -> Level 5, advanced -> Level 8, pro -> Level 9.
  Existing level values are also normalized, including "Level 5" and "Level_5".
*/

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_skill_level_check;

UPDATE profiles
SET skill_level = CASE lower(replace(trim(skill_level), ' ', '_'))
  WHEN 'beginner' THEN 'level_2'
  WHEN 'intermediate' THEN 'level_5'
  WHEN 'advanced' THEN 'level_8'
  WHEN 'pro' THEN 'level_9'
  WHEN 'level_1' THEN 'level_1'
  WHEN 'level_2' THEN 'level_2'
  WHEN 'level_3' THEN 'level_3'
  WHEN 'level_4' THEN 'level_4'
  WHEN 'level_5' THEN 'level_5'
  WHEN 'level_6' THEN 'level_6'
  WHEN 'level_7' THEN 'level_7'
  WHEN 'level_8' THEN 'level_8'
  WHEN 'level_9' THEN 'level_9'
  ELSE 'level_5'
END;

ALTER TABLE profiles ALTER COLUMN skill_level SET DEFAULT 'level_5';

ALTER TABLE profiles ADD CONSTRAINT profiles_skill_level_check
  CHECK (skill_level IN (
    'level_1', 'level_2', 'level_3',
    'level_4', 'level_5', 'level_6',
    'level_7', 'level_8', 'level_9'
  ));
