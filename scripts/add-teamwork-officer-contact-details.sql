-- Adds the richer per-person fields TeamWork's own "Directors / Shareholders
-- / Secretaries / Controllers / ..." detail cards carry (a different, richer
-- section of the same company profile page than the plain "Active Officials"
-- summary table teamwork_company_officials was originally built from) —
-- Vincent pointed out these exist with real data (D.O.B., Individual Email,
-- Individual Mobile No #) and asked for them to fill the still-empty Birth
-- Date/Contact No/Email Address fields on Post Incorporate.
--
-- Run ONCE in the Supabase SQL editor. Idempotent — safe to re-run.

alter table teamwork_company_officials add column if not exists dob text;
alter table teamwork_company_officials add column if not exists email text;
alter table teamwork_company_officials add column if not exists mobile text;
alter table teamwork_company_officials add column if not exists telephone text;
-- e.g. "Nominee Director", "Member", "Controller" — from the card's own
-- "Sub Role N. {role} : ..." / "Role N. {role} : ..." line(s). Comma-joined
-- when a person has more than one.
alter table teamwork_company_officials add column if not exists sub_roles text;
