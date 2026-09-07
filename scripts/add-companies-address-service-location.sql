-- Which of Tassure's real address-service locations a client's registered
-- office actually is (see lib/address-service.ts) — previously only a
-- boolean (companies.uses_address), which couldn't say WHICH address, and
-- was itself computed from a rule that only recognized one of the 5 real
-- addresses (Vincent's boss, 2026-09-07: "Besides our own current office
-- address..., we also use" 4 more), silently undercounting clients
-- registered at any of the other 4.
--
-- Safe to run more than once in the Supabase SQL Editor.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS address_service_location text;
