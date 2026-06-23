-- Clear requested_date and requested_time from all contacts so they move
-- from "Scheduled" to "Unscheduled" in the Waitlist tab. Use this to test
-- the UI with all 100+ guests showing in the unscheduled bucket.

UPDATE public.crm_contacts
SET requested_date = NULL,
    requested_time = NULL
WHERE requested_date IS NOT NULL;

-- Verify: should now show 0 scheduled, all contacts unscheduled.
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE requested_date IS NOT NULL) AS scheduled,
  COUNT(*) FILTER (WHERE requested_date IS NULL)     AS unscheduled
FROM public.crm_contacts;
