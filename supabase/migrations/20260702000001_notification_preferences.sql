-- notification_preferences: per-user toggle for each push event type
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "sale.approved"       boolean NOT NULL DEFAULT true,
  "sale.pending"        boolean NOT NULL DEFAULT true,
  "sale.failed"         boolean NOT NULL DEFAULT true,
  "checkout.abandoned"  boolean NOT NULL DEFAULT true,
  refund                boolean NOT NULL DEFAULT true,
  new_customer          boolean NOT NULL DEFAULT true,
  daily_summary         boolean NOT NULL DEFAULT true,
  system                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_full_access" ON public.notification_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

GRANT ALL ON public.notification_preferences TO authenticated;

-- Add type 'sale.failed' to notifications_log if not present (backward compat)
ALTER TABLE public.notifications_log
  DROP CONSTRAINT IF EXISTS notifications_log_type_check;

ALTER TABLE public.notifications_log
  ADD CONSTRAINT notifications_log_type_check
    CHECK (type IN ('sale', 'daily_report', 'motivation', 'system', 'sale.failed', 'checkout.abandoned'));
