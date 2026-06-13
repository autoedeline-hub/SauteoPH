-- Tests for the one-couple-per-time-slot cap.
-- Run after `supabase db reset` (which applies migrations + seed.sql):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/one_couple_per_slot_test.sql
-- (or pipe this file into the local DB container's psql)
-- All fixtures are rolled back at the end.

BEGIN;

-- ============================================================
-- Task 1: two_top_taken() helper
-- ============================================================

-- T1.1 empty dine-in slot -> false
DO $$
DECLARE s uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.time_slots(id,slot_date,slot_time,capacity,seats_taken,is_open,channel)
    VALUES (s, current_date+30, '13:00', 16, 0, true, 'dine_in');
  IF public.two_top_taken(s) THEN
    RAISE EXCEPTION 'FAIL T1.1: empty slot reported as taken';
  END IF;
  RAISE NOTICE 'PASS T1.1 empty slot -> false';
END $$;

-- T1.2 one live couple booking -> true
DO $$
DECLARE s uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.time_slots(id,slot_date,slot_time,capacity,seats_taken,is_open,channel)
    VALUES (s, current_date+30, '13:00', 16, 2, true, 'dine_in');
  INSERT INTO public.bookings(slot_id,customer_name,customer_email,customer_phone,group_size,status,pickup_mode,source)
    VALUES (s,'A','a@x.com','09170000001',2,'pending','dine_in','web');
  IF NOT public.two_top_taken(s) THEN
    RAISE EXCEPTION 'FAIL T1.2: couple booking not detected';
  END IF;
  RAISE NOTICE 'PASS T1.2 couple booking -> true';
END $$;

-- T1.3 one active issued couple invite -> true
DO $$
DECLARE s uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.time_slots(id,slot_date,slot_time,capacity,seats_taken,is_open,channel)
    VALUES (s, current_date+30, '15:00', 16, 0, true, 'dine_in');
  INSERT INTO public.booking_invites(token,channel,customer_name,group_size,expires_at,slot_id)
    VALUES ('tok-'||gen_random_uuid(),'dine_in','Inv',2, now()+interval '72 hours', s);
  IF NOT public.two_top_taken(s) THEN
    RAISE EXCEPTION 'FAIL T1.3: active couple invite not detected';
  END IF;
  RAISE NOTICE 'PASS T1.3 active couple invite -> true';
END $$;

-- T1.4 cancelled couple booking -> false (cancellation frees the slot)
DO $$
DECLARE s uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.time_slots(id,slot_date,slot_time,capacity,seats_taken,is_open,channel)
    VALUES (s, current_date+30, '17:00', 16, 0, true, 'dine_in');
  INSERT INTO public.bookings(slot_id,customer_name,customer_email,customer_phone,group_size,status,pickup_mode,source)
    VALUES (s,'A','a@x.com','09170000001',2,'cancelled','dine_in','web');
  IF public.two_top_taken(s) THEN
    RAISE EXCEPTION 'FAIL T1.4: cancelled booking still counts';
  END IF;
  RAISE NOTICE 'PASS T1.4 cancelled booking -> false';
END $$;

-- T1.5 pickup couple -> false (pickup never affected)
DO $$
DECLARE s uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.time_slots(id,slot_date,slot_time,capacity,seats_taken,is_open,channel)
    VALUES (s, current_date+30, '17:00', 16, 0, true, 'pickup');
  INSERT INTO public.bookings(slot_id,customer_name,customer_email,customer_phone,group_size,status,pickup_mode,source)
    VALUES (s,'P','p@x.com','09170000002',2,'pending','personal_pickup','web');
  IF public.two_top_taken(s) THEN
    RAISE EXCEPTION 'FAIL T1.5: pickup couple counted';
  END IF;
  RAISE NOTICE 'PASS T1.5 pickup couple -> false';
END $$;

-- T1.6 solo diner (party of 1) -> true (uses the same 2-top)
DO $$
DECLARE s uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.time_slots(id,slot_date,slot_time,capacity,seats_taken,is_open,channel)
    VALUES (s, current_date+30, '19:00', 16, 1, true, 'dine_in');
  INSERT INTO public.bookings(slot_id,customer_name,customer_email,customer_phone,group_size,status,pickup_mode,source)
    VALUES (s,'Solo','s@x.com','09170000003',1,'pending','dine_in','web');
  IF NOT public.two_top_taken(s) THEN
    RAISE EXCEPTION 'FAIL T1.6: solo diner not counted';
  END IF;
  RAISE NOTICE 'PASS T1.6 solo diner -> true';
END $$;

-- T1.7 four-top booking -> false (only group_size <=2 needs the 2-top)
DO $$
DECLARE s uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.time_slots(id,slot_date,slot_time,capacity,seats_taken,is_open,channel)
    VALUES (s, current_date+30, '19:00', 16, 4, true, 'dine_in');
  INSERT INTO public.bookings(slot_id,customer_name,customer_email,customer_phone,group_size,status,pickup_mode,source)
    VALUES (s,'Four','f@x.com','09170000004',4,'pending','dine_in','web');
  IF public.two_top_taken(s) THEN
    RAISE EXCEPTION 'FAIL T1.7: four-top counted as a 2-top';
  END IF;
  RAISE NOTICE 'PASS T1.7 four-top -> false';
END $$;

-- T1.8 _exclude_invite removes the named invite from the count
DO $$
DECLARE s uuid := gen_random_uuid(); inv uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.time_slots(id,slot_date,slot_time,capacity,seats_taken,is_open,channel)
    VALUES (s, current_date+30, '13:00', 16, 0, true, 'dine_in');
  INSERT INTO public.booking_invites(id,token,channel,customer_name,group_size,expires_at,slot_id)
    VALUES (inv,'tok-'||gen_random_uuid(),'dine_in','Inv',2, now()+interval '72 hours', s);
  IF public.two_top_taken(s, inv, NULL) THEN
    RAISE EXCEPTION 'FAIL T1.8: excluded invite still counted';
  END IF;
  RAISE NOTICE 'PASS T1.8 _exclude_invite works';
END $$;

-- T1.9 waiting invite (NULL token / NULL expires_at) -> false
DO $$
DECLARE s uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.time_slots(id,slot_date,slot_time,capacity,seats_taken,is_open,channel)
    VALUES (s, current_date+30, '13:00', 16, 0, true, 'dine_in');
  INSERT INTO public.booking_invites(token,channel,customer_name,group_size,expires_at,slot_id)
    VALUES (NULL,'dine_in','Waiting',2, NULL, s);
  IF public.two_top_taken(s) THEN
    RAISE EXCEPTION 'FAIL T1.9: waiting (un-issued) invite counted';
  END IF;
  RAISE NOTICE 'PASS T1.9 waiting invite -> false';
END $$;

ROLLBACK;
