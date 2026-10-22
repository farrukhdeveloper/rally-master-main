/*
  # Admin Policies for Availability and Profile Management

  ## Changes
  1. session_availability
     - Add admin INSERT policy (admin can mark any player as available)
     - Add admin UPDATE policy (admin can change any player's availability)
  2. profiles
     - Add admin INSERT policy (admin can insert profiles on behalf of new users)
     - Add admin UPDATE policy (admin can update any profile)
*/

-- Admins can insert availability for any player
CREATE POLICY "Admins can insert any player availability"
  ON session_availability FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Admins can update availability for any player
CREATE POLICY "Admins can update any player availability"
  ON session_availability FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Admins can insert any profile (needed when creating player accounts)
CREATE POLICY "Admins can insert any profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Admins can update any profile
CREATE POLICY "Admins can update any profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
