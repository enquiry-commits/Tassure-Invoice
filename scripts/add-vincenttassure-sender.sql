INSERT INTO public.email_senders (email, display_name, is_default)
SELECT 'vincenttassure@outlook.com', 'Vincent (Tassure)', false
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_senders WHERE email = 'vincenttassure@outlook.com'
);
