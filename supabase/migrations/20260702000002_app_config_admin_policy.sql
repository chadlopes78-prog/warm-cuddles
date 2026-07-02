-- Allow admin users to read and write app_config
-- This lets the admin UI save E2Payments credentials directly from the browser

CREATE POLICY "admins_can_read_app_config"
  ON public.app_config
  FOR SELECT
  TO authenticated
  USING (
    auth.jwt() ->> 'email' IN ('chadlopesff@gmail.com', 'dercktuane@gmail.com')
  );

CREATE POLICY "admins_can_write_app_config"
  ON public.app_config
  FOR ALL
  TO authenticated
  USING (
    auth.jwt() ->> 'email' IN ('chadlopesff@gmail.com', 'dercktuane@gmail.com')
  )
  WITH CHECK (
    auth.jwt() ->> 'email' IN ('chadlopesff@gmail.com', 'dercktuane@gmail.com')
  );
