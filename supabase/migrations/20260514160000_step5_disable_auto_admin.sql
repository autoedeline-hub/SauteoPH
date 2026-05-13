-- Step 5: Disable the "first signup becomes admin" trigger.
--
-- Before this migration:
--   ON INSERT INTO auth.users → if no admin row exists, the new user
--   is auto-promoted to admin. Convenient for bootstrap, dangerous in
--   prod: if the admin row is ever deleted, the next random signup
--   silently becomes admin.
--
-- After this migration:
--   No auto-promotion. Admins are granted explicitly via
--   public.grant_admin_by_email(_email text), which is callable only
--   from inside the Supabase SQL Editor (the postgres superuser role)
--   or by an existing admin.
--
-- Bootstrapping the first admin:
--   1. Sign the admin user up through the normal auth flow first so
--      their row lands in auth.users.
--   2. In the SQL Editor, run:
--        SELECT public.grant_admin_by_email('youremail@example.com');
--   3. The function returns the user_roles row that was created
--      (or null if no auth user with that email exists yet).

-- ---------------------------------------------------------------------------
-- 1. Remove the auto-promotion trigger + its function.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user_role();

-- ---------------------------------------------------------------------------
-- 2. Explicit admin grant helper.
--    SECURITY DEFINER so the lookup against auth.users works from any role
--    that has EXECUTE on the function. We then revoke EXECUTE from anon /
--    authenticated so only the postgres superuser (SQL Editor) or another
--    admin can run it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_admin_by_email(_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email   text := lower(trim(_email));
  v_user_id uuid;
  v_role_id uuid;
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'email is required' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_user_id
    FROM auth.users
   WHERE lower(email) = v_email
   LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no auth user with email %', v_email
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING
  RETURNING id INTO v_role_id;

  RETURN jsonb_build_object(
    'user_id', v_user_id,
    'email',   v_email,
    'role',    'admin',
    'granted', v_role_id IS NOT NULL  -- false if already had the role
  );
END;
$$;

-- Lock the function down: only the database owner (postgres superuser, which
-- the Supabase SQL Editor runs as) can execute it. anon and authenticated
-- cannot escalate themselves.
REVOKE ALL ON FUNCTION public.grant_admin_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_admin_by_email(text) FROM anon, authenticated;
