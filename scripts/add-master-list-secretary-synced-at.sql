ALTER TABLE public.master_list
  ADD COLUMN IF NOT EXISTS secretary_synced_at timestamptz;
