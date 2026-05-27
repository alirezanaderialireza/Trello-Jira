-- packages/db/src/rls/__tests__/0006_phase11_rls.test.sql
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1.1 (F1) — manual RLS / CHECK isolation test script.
--
-- HOW TO RUN
--
--   1. Bring up dev Postgres and apply all migrations (including 0006):
--
--        docker compose up -d postgres
--        pnpm install
--        pnpm --filter @repo/db migrate
--
--   2. Run this script against the same database:
--
--        psql "$DATABASE_URL" \
--             -v ON_ERROR_STOP=1 \
--             -f packages/db/src/rls/__tests__/0006_phase11_rls.test.sql
--
--      Or with the docker-compose default credentials:
--
--        psql -h localhost -U trello -d trello_os \
--             -v ON_ERROR_STOP=1 \
--             -f packages/db/src/rls/__tests__/0006_phase11_rls.test.sql
--
--      Expected output: a sequence of `PASS: …` NOTICE lines followed by
--      `ALL TESTS PASSED`. Any RAISE EXCEPTION or PG error stops the
--      script (because of ON_ERROR_STOP=1) and indicates a failure.
--
-- WHAT THIS SCRIPT VERIFIES
--
--   1.  user_board_metadata RLS — SELECT cross-tenant / cross-user isolation.
--   2.  user_board_metadata RLS — INSERT WITH CHECK rejects mismatched GUCs.
--   3.  workspace_invitations RLS — admin/owner SELECT visibility.
--   4.  workspace_invitations RLS — invited-email SELECT visibility (pending).
--   5.  workspace_invitations RLS — non-member SELECT denied.
--   6.  workspace_invitations RLS — non-admin INSERT denied.
--   7.  active-email/workspace partial unique blocks duplicate active rows.
--   8.  Lifecycle CHECK rejects accepted_at + revoked_at on the same row.
--   9.  Email-lowercase CHECK rejects mixed-case invited_email.
--  10.  tenant_id = workspace_id CHECK enforced on workspace_invitations.
--  11.  workspaces.visibility CHECK rejects unknown values.
--  12.  boards.visibility CHECK rejects unknown values.
--  13.  users.preferences JSONB shape CHECK rejects non-object values.
--  14.  workspaces.background_data JSONB shape CHECK rejects non-object values.
--  15.  workspace_invitations DELETE policy — admin allowed, non-admin denied.
--  16.  Cascade delete: admin DELETEs a workspace and its invitations
--       cascade away even under FORCE RLS (D2 deviation).
--
-- TRANSACTION DISCIPLINE
--
--   The whole script runs inside a single top-level transaction terminated
--   with ROLLBACK so the database is left untouched. Per-test SAVEPOINTs
--   isolate accidental cross-test mutation. SET LOCAL effects survive
--   ROLLBACK TO SAVEPOINT (per Postgres semantics), so each test that
--   needs a different role/GUC explicitly RESETs them at the top.
-- ─────────────────────────────────────────────────────────────────────────────


-- ============================================================================
-- 0. Pre-flight: required roles must already exist.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    RAISE EXCEPTION
      'app_user role missing. Run "pnpm --filter @repo/db migrate" first, then ensure docker-compose / seed has created app_user (NOBYPASSRLS).';
  END IF;
  RAISE NOTICE 'PRE-FLIGHT: app_user role present';
END$$;


BEGIN;

-- ============================================================================
-- 1. Fixtures (committed only locally; ROLLBACK at end discards everything).
-- ============================================================================

-- Stable UUIDs to make per-test assertions readable. NOT random.
\set workspace_a 11111111-aaaa-1111-aaaa-111111111111
\set workspace_b 22222222-bbbb-2222-bbbb-222222222222
\set alice_id   aaaaaaaa-1111-1111-1111-111111111111
\set bob_id     bbbbbbbb-1111-1111-1111-111111111111
\set carol_id   cccccccc-2222-2222-2222-222222222222
\set dave_id    dddddddd-0000-0000-0000-000000000000
\set board_a    11110001-aaaa-1111-aaaa-111111111111
\set board_b    22220001-bbbb-2222-bbbb-222222222222

INSERT INTO users (id, email, email_normalized, display_name)
VALUES
  (:'alice_id', 'alice@test.com', 'alice@test.com', 'Alice'),
  (:'bob_id',   'bob@test.com',   'bob@test.com',   'Bob'),
  (:'carol_id', 'carol@test.com', 'carol@test.com', 'Carol'),
  (:'dave_id',  'dave@test.com',  'dave@test.com',  'Dave');

INSERT INTO workspaces (id, name, slug, owner_id)
VALUES
  (:'workspace_a', 'Workspace A', 'phase11-test-ws-a', :'alice_id'),
  (:'workspace_b', 'Workspace B', 'phase11-test-ws-b', :'carol_id');

INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
  (:'workspace_a', :'alice_id', 'OWNER'),
  (:'workspace_a', :'bob_id',   'MEMBER'),
  (:'workspace_b', :'carol_id', 'OWNER');

INSERT INTO boards (id, tenant_id, title) VALUES
  (:'board_a', :'workspace_a', 'Board A'),
  (:'board_b', :'workspace_b', 'Board B');

\echo 'Fixtures inserted.'


-- ============================================================================
-- TEST 1 — user_board_metadata: cross-tenant / cross-user SELECT isolation
-- ============================================================================

\echo '─ TEST 1 — user_board_metadata SELECT isolation'
SAVEPOINT t1;

-- Insert metadata as superuser (BYPASSRLS) for both tenants.
INSERT INTO user_board_metadata (user_id, board_id, tenant_id, is_starred)
VALUES
  (:'alice_id', :'board_a', :'workspace_a', true),
  (:'carol_id', :'board_b', :'workspace_b', true);

-- 1a. Alice scoped to tenant A sees her own row only.
RESET ROLE;
RESET app.current_tenant_id;
RESET app.current_user_id;
SET LOCAL ROLE app_user;
SET LOCAL app.current_tenant_id = :'workspace_a';
SET LOCAL app.current_user_id   = :'alice_id';

DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM user_board_metadata;
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL 1a: alice/A should see exactly 1 row, saw %', cnt;
  END IF;
  RAISE NOTICE 'PASS 1a: alice/A sees own row only';
END$$;

-- 1b. Alice scoped to tenant B sees nothing (different GUC).
RESET ROLE;
SET LOCAL ROLE app_user;
SET LOCAL app.current_tenant_id = :'workspace_b';
SET LOCAL app.current_user_id   = :'alice_id';

DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM user_board_metadata;
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL 1b: alice/B should see 0 rows, saw %', cnt;
  END IF;
  RAISE NOTICE 'PASS 1b: alice/B sees zero rows (cross-tenant blocked)';
END$$;

-- 1c. Bob in tenant A (no metadata of his own) sees nothing.
RESET ROLE;
SET LOCAL ROLE app_user;
SET LOCAL app.current_tenant_id = :'workspace_a';
SET LOCAL app.current_user_id   = :'bob_id';

DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM user_board_metadata;
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL 1c: bob/A should see 0 rows (no metadata), saw %', cnt;
  END IF;
  RAISE NOTICE 'PASS 1c: bob/A sees zero rows (other-user blocked)';
END$$;

RESET ROLE;
ROLLBACK TO SAVEPOINT t1;


-- ============================================================================
-- TEST 2 — user_board_metadata: INSERT WITH CHECK rejects GUC mismatch
-- ============================================================================

\echo '─ TEST 2 — user_board_metadata INSERT WITH CHECK'
SAVEPOINT t2;

RESET ROLE;
RESET app.current_tenant_id;
RESET app.current_user_id;
SET LOCAL ROLE app_user;
SET LOCAL app.current_tenant_id = :'workspace_a';
SET LOCAL app.current_user_id   = :'alice_id';

-- Alice cannot insert a row claiming to belong to bob.
DO $$
BEGIN
  BEGIN
    INSERT INTO user_board_metadata (user_id, board_id, tenant_id, is_starred)
    VALUES ('bbbbbbbb-1111-1111-1111-111111111111',
            '11110001-aaaa-1111-aaaa-111111111111',
            '11111111-aaaa-1111-aaaa-111111111111',
            true);
    RAISE EXCEPTION 'FAIL 2a: alice should not be able to insert for bob';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      RAISE NOTICE 'PASS 2a: alice/A INSERT for bob blocked (RLS WITH CHECK)';
  END;
END$$;

-- Alice cannot insert a row for tenant B even with her own user_id.
DO $$
BEGIN
  BEGIN
    INSERT INTO user_board_metadata (user_id, board_id, tenant_id, is_starred)
    VALUES ('aaaaaaaa-1111-1111-1111-111111111111',
            '22220001-bbbb-2222-bbbb-222222222222',
            '22222222-bbbb-2222-bbbb-222222222222',
            true);
    RAISE EXCEPTION 'FAIL 2b: alice should not insert with mismatched tenant_id';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      RAISE NOTICE 'PASS 2b: alice/A INSERT with tenant=B blocked (RLS WITH CHECK)';
  END;
END$$;

RESET ROLE;
ROLLBACK TO SAVEPOINT t2;


-- ============================================================================
-- TEST 3-5 — workspace_invitations SELECT visibility
-- ============================================================================

\echo '─ TEST 3-5 — workspace_invitations SELECT visibility'
SAVEPOINT t3;

-- Alice (admin/owner of A) issues an invitation to dave's email.
INSERT INTO workspace_invitations
  (id, tenant_id, workspace_id, invited_email, invited_by_user_id, role, token, expires_at)
VALUES
  ('00000000-0000-0000-0000-000000000301',
   :'workspace_a', :'workspace_a',
   'dave@test.com',
   :'alice_id',
   'MEMBER',
   'token-test-3-static-fixture',
   now() + interval '7 days');

-- 3. Alice (OWNER of A) sees the invitation.
RESET ROLE;
RESET app.current_tenant_id;
RESET app.current_user_id;
SET LOCAL ROLE app_user;
SET LOCAL app.current_tenant_id = :'workspace_a';
SET LOCAL app.current_user_id   = :'alice_id';

DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM workspace_invitations;
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL 3: alice (OWNER of A) should see 1 invitation, saw %', cnt;
  END IF;
  RAISE NOTICE 'PASS 3: alice (OWNER) sees pending invitation';
END$$;

-- 4. Dave (matching email, still pending) sees the invitation.
RESET ROLE;
SET LOCAL ROLE app_user;
SET LOCAL app.current_tenant_id = :'workspace_a';
SET LOCAL app.current_user_id   = :'dave_id';

DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM workspace_invitations;
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL 4: dave (invited email) should see 1 invitation, saw %', cnt;
  END IF;
  RAISE NOTICE 'PASS 4: dave (invited-email) sees own pending invitation';
END$$;

-- 5a. Bob (MEMBER, not ADMIN/OWNER, not invited) sees nothing.
RESET ROLE;
SET LOCAL ROLE app_user;
SET LOCAL app.current_tenant_id = :'workspace_a';
SET LOCAL app.current_user_id   = :'bob_id';

DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM workspace_invitations;
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL 5a: bob (MEMBER) should see 0 invitations, saw %', cnt;
  END IF;
  RAISE NOTICE 'PASS 5a: bob (MEMBER) sees zero invitations (not admin)';
END$$;

-- 5b. Carol (OWNER of B, not in A) sees nothing — different tenant.
RESET ROLE;
SET LOCAL ROLE app_user;
SET LOCAL app.current_tenant_id = :'workspace_a';
SET LOCAL app.current_user_id   = :'carol_id';

DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM workspace_invitations;
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL 5b: carol (OWNER of B) should see 0 invitations of A, saw %', cnt;
  END IF;
  RAISE NOTICE 'PASS 5b: carol (foreign-workspace OWNER) sees zero invitations';
END$$;

RESET ROLE;
ROLLBACK TO SAVEPOINT t3;


-- ============================================================================
-- TEST 6 — workspace_invitations INSERT requires admin/owner
-- ============================================================================

\echo '─ TEST 6 — workspace_invitations INSERT admin-only'
SAVEPOINT t6;

RESET ROLE;
RESET app.current_tenant_id;
RESET app.current_user_id;
SET LOCAL ROLE app_user;
SET LOCAL app.current_tenant_id = :'workspace_a';
SET LOCAL app.current_user_id   = :'bob_id';

DO $$
BEGIN
  BEGIN
    INSERT INTO workspace_invitations
      (id, tenant_id, workspace_id, invited_email, invited_by_user_id, role, token, expires_at)
    VALUES
      ('00000000-0000-0000-0000-000000000601',
       '11111111-aaaa-1111-aaaa-111111111111',
       '11111111-aaaa-1111-aaaa-111111111111',
       'newcomer@test.com',
       'bbbbbbbb-1111-1111-1111-111111111111',
       'MEMBER',
       'token-test-6-bob-tries',
       now() + interval '7 days');
    RAISE EXCEPTION 'FAIL 6: bob (MEMBER) must not insert invitations';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      RAISE NOTICE 'PASS 6: bob (MEMBER) INSERT denied (admin-only policy)';
  END;
END$$;

RESET ROLE;
ROLLBACK TO SAVEPOINT t6;


-- ============================================================================
-- TEST 7 — Active-email/workspace partial unique
-- ============================================================================

\echo '─ TEST 7 — active-email/workspace partial unique'
SAVEPOINT t7;

INSERT INTO workspace_invitations
  (id, tenant_id, workspace_id, invited_email, invited_by_user_id, role, token, expires_at)
VALUES
  ('00000000-0000-0000-0000-000000000701',
   :'workspace_a', :'workspace_a',
   'dave@test.com',
   :'alice_id',
   'MEMBER',
   'token-test-7-first',
   now() + interval '7 days');

DO $$
BEGIN
  BEGIN
    INSERT INTO workspace_invitations
      (id, tenant_id, workspace_id, invited_email, invited_by_user_id, role, token, expires_at)
    VALUES
      ('00000000-0000-0000-0000-000000000702',
       '11111111-aaaa-1111-aaaa-111111111111',
       '11111111-aaaa-1111-aaaa-111111111111',
       'dave@test.com',
       'aaaaaaaa-1111-1111-1111-111111111111',
       'ADMIN',
       'token-test-7-second',
       now() + interval '7 days');
    RAISE EXCEPTION 'FAIL 7a: duplicate active invitation must violate partial unique';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS 7a: duplicate active invitation blocked by partial unique';
  END;
END$$;

-- After revoke, a new invitation for the same (email, workspace) is allowed.
UPDATE workspace_invitations
   SET revoked_at = now(), revoked_by_user_id = :'alice_id'
 WHERE id = '00000000-0000-0000-0000-000000000701';

INSERT INTO workspace_invitations
  (id, tenant_id, workspace_id, invited_email, invited_by_user_id, role, token, expires_at)
VALUES
  ('00000000-0000-0000-0000-000000000703',
   :'workspace_a', :'workspace_a',
   'dave@test.com',
   :'alice_id',
   'MEMBER',
   'token-test-7-after-revoke',
   now() + interval '7 days');

DO $$ BEGIN RAISE NOTICE 'PASS 7b: new invitation after revoke allowed'; END$$;

ROLLBACK TO SAVEPOINT t7;


-- ============================================================================
-- TEST 8 — Lifecycle CHECK rejects accepted_at + revoked_at on the same row
-- ============================================================================

\echo '─ TEST 8 — lifecycle CHECK'
SAVEPOINT t8;

DO $$
BEGIN
  BEGIN
    INSERT INTO workspace_invitations
      (id, tenant_id, workspace_id, invited_email, invited_by_user_id, role, token, expires_at,
       accepted_at, revoked_at)
    VALUES
      ('00000000-0000-0000-0000-000000000801',
       '11111111-aaaa-1111-aaaa-111111111111',
       '11111111-aaaa-1111-aaaa-111111111111',
       'who@test.com',
       'aaaaaaaa-1111-1111-1111-111111111111',
       'MEMBER',
       'token-test-8',
       now() + interval '7 days',
       now(),
       now());
    RAISE EXCEPTION 'FAIL 8: lifecycle CHECK should reject accepted+revoked';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS 8: lifecycle CHECK rejects accepted+revoked combo';
  END;
END$$;

ROLLBACK TO SAVEPOINT t8;


-- ============================================================================
-- TEST 9 — Email lowercase CHECK
-- ============================================================================

\echo '─ TEST 9 — invited_email lowercase CHECK'
SAVEPOINT t9;

DO $$
BEGIN
  BEGIN
    INSERT INTO workspace_invitations
      (id, tenant_id, workspace_id, invited_email, invited_by_user_id, role, token, expires_at)
    VALUES
      ('00000000-0000-0000-0000-000000000901',
       '11111111-aaaa-1111-aaaa-111111111111',
       '11111111-aaaa-1111-aaaa-111111111111',
       'Dave@TEST.com',
       'aaaaaaaa-1111-1111-1111-111111111111',
       'MEMBER',
       'token-test-9',
       now() + interval '7 days');
    RAISE EXCEPTION 'FAIL 9: email-lowercase CHECK should reject mixed case';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS 9: email-lowercase CHECK rejects mixed case';
  END;
END$$;

ROLLBACK TO SAVEPOINT t9;


-- ============================================================================
-- TEST 10 — tenant_id = workspace_id CHECK
-- ============================================================================

\echo '─ TEST 10 — tenant_id = workspace_id CHECK'
SAVEPOINT t10;

DO $$
BEGIN
  BEGIN
    INSERT INTO workspace_invitations
      (id, tenant_id, workspace_id, invited_email, invited_by_user_id, role, token, expires_at)
    VALUES
      ('00000000-0000-0000-0000-000000001001',
       '22222222-bbbb-2222-bbbb-222222222222',  -- tenant = B
       '11111111-aaaa-1111-aaaa-111111111111',  -- workspace = A
       'who@test.com',
       'aaaaaaaa-1111-1111-1111-111111111111',
       'MEMBER',
       'token-test-10',
       now() + interval '7 days');
    RAISE EXCEPTION 'FAIL 10: tenant!=workspace must be rejected';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS 10: tenant_id != workspace_id rejected by CHECK';
  END;
END$$;

ROLLBACK TO SAVEPOINT t10;


-- ============================================================================
-- TEST 11 — workspaces.visibility CHECK
-- ============================================================================

\echo '─ TEST 11 — workspaces.visibility CHECK'
SAVEPOINT t11;

DO $$
BEGIN
  BEGIN
    UPDATE workspaces SET visibility = 'banana'
     WHERE id = '11111111-aaaa-1111-aaaa-111111111111';
    RAISE EXCEPTION 'FAIL 11: workspaces.visibility CHECK should reject "banana"';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS 11: workspaces.visibility CHECK rejects unknown value';
  END;
END$$;

ROLLBACK TO SAVEPOINT t11;


-- ============================================================================
-- TEST 12 — boards.visibility CHECK
-- ============================================================================

\echo '─ TEST 12 — boards.visibility CHECK'
SAVEPOINT t12;

DO $$
BEGIN
  BEGIN
    UPDATE boards SET visibility = 'banana'
     WHERE id = '11110001-aaaa-1111-aaaa-111111111111';
    RAISE EXCEPTION 'FAIL 12: boards.visibility CHECK should reject "banana"';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS 12: boards.visibility CHECK rejects unknown value';
  END;
END$$;

ROLLBACK TO SAVEPOINT t12;


-- ============================================================================
-- TEST 13 — users.preferences JSONB shape CHECK
-- ============================================================================

\echo '─ TEST 13 — users.preferences JSONB shape CHECK'
SAVEPOINT t13;

DO $$
BEGIN
  -- Array, not object.
  BEGIN
    UPDATE users SET preferences = '[1,2,3]'::jsonb
     WHERE id = 'aaaaaaaa-1111-1111-1111-111111111111';
    RAISE EXCEPTION 'FAIL 13a: preferences=array must be rejected';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS 13a: users.preferences CHECK rejects array';
  END;

  -- Scalar.
  BEGIN
    UPDATE users SET preferences = '"hello"'::jsonb
     WHERE id = 'aaaaaaaa-1111-1111-1111-111111111111';
    RAISE EXCEPTION 'FAIL 13b: preferences=string must be rejected';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS 13b: users.preferences CHECK rejects scalar';
  END;

  -- Object → accepted.
  UPDATE users SET preferences = '{"theme":"dark"}'::jsonb
   WHERE id = 'aaaaaaaa-1111-1111-1111-111111111111';
  RAISE NOTICE 'PASS 13c: users.preferences object is accepted';
END$$;

ROLLBACK TO SAVEPOINT t13;


-- ============================================================================
-- TEST 14 — workspaces.background_data JSONB shape CHECK
-- ============================================================================

\echo '─ TEST 14 — workspaces.background_data JSONB shape CHECK'
SAVEPOINT t14;

DO $$
BEGIN
  BEGIN
    UPDATE workspaces SET background_data = '[]'::jsonb
     WHERE id = '11111111-aaaa-1111-aaaa-111111111111';
    RAISE EXCEPTION 'FAIL 14a: background_data=[] must be rejected';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS 14a: workspaces.background_data CHECK rejects array';
  END;

  -- NULL is allowed.
  UPDATE workspaces SET background_data = NULL
   WHERE id = '11111111-aaaa-1111-aaaa-111111111111';
  RAISE NOTICE 'PASS 14b: workspaces.background_data NULL is accepted';

  UPDATE workspaces SET background_data = '{"color":"blue.500"}'::jsonb
   WHERE id = '11111111-aaaa-1111-aaaa-111111111111';
  RAISE NOTICE 'PASS 14c: workspaces.background_data object is accepted';
END$$;

ROLLBACK TO SAVEPOINT t14;


-- ============================================================================
-- TEST 15 — workspace_invitations DELETE policy
-- ============================================================================

\echo '─ TEST 15 — workspace_invitations DELETE policy'
SAVEPOINT t15;

INSERT INTO workspace_invitations
  (id, tenant_id, workspace_id, invited_email, invited_by_user_id, role, token, expires_at)
VALUES
  ('00000000-0000-0000-0000-000000001501',
   :'workspace_a', :'workspace_a',
   'will-be-deleted@test.com',
   :'alice_id',
   'MEMBER',
   'token-test-15',
   now() + interval '7 days');

-- 15a — bob (MEMBER, not admin) cannot DELETE.
RESET ROLE;
RESET app.current_tenant_id;
RESET app.current_user_id;
SET LOCAL ROLE app_user;
SET LOCAL app.current_tenant_id = :'workspace_a';
SET LOCAL app.current_user_id   = :'bob_id';

DO $$
DECLARE deleted int;
BEGIN
  WITH d AS (
    DELETE FROM workspace_invitations
     WHERE id = '00000000-0000-0000-0000-000000001501'
     RETURNING 1
  )
  SELECT count(*) INTO deleted FROM d;
  IF deleted <> 0 THEN
    RAISE EXCEPTION 'FAIL 15a: bob (MEMBER) deleted % rows; should be 0', deleted;
  END IF;
  RAISE NOTICE 'PASS 15a: bob (MEMBER) DELETE returns 0 rows (RLS blocks)';
END$$;

-- 15b — alice (OWNER) can DELETE.
RESET ROLE;
SET LOCAL ROLE app_user;
SET LOCAL app.current_tenant_id = :'workspace_a';
SET LOCAL app.current_user_id   = :'alice_id';

DO $$
DECLARE deleted int;
BEGIN
  WITH d AS (
    DELETE FROM workspace_invitations
     WHERE id = '00000000-0000-0000-0000-000000001501'
     RETURNING 1
  )
  SELECT count(*) INTO deleted FROM d;
  IF deleted <> 1 THEN
    RAISE EXCEPTION 'FAIL 15b: alice (OWNER) deleted % rows; expected 1', deleted;
  END IF;
  RAISE NOTICE 'PASS 15b: alice (OWNER) DELETE succeeds';
END$$;

RESET ROLE;
ROLLBACK TO SAVEPOINT t15;


-- ============================================================================
-- TEST 16 — Cascade DELETE from workspace under FORCE RLS (D2 deviation)
-- ============================================================================

\echo '─ TEST 16 — workspace cascade DELETE invitations under FORCE RLS'
SAVEPOINT t16;

INSERT INTO workspace_invitations
  (id, tenant_id, workspace_id, invited_email, invited_by_user_id, role, token, expires_at)
VALUES
  ('00000000-0000-0000-0000-000000001601',
   :'workspace_a', :'workspace_a',
   'cascade-victim@test.com',
   :'alice_id',
   'MEMBER',
   'token-test-16',
   now() + interval '7 days');

-- Alice as workspace OWNER hard-deletes the workspace; the FK CASCADE must
-- be permitted by the workspace_invitations DELETE policy (D2).
--
-- NOTE: workspaces also has its own RLS DELETE policy (boards_admin_delete
-- pattern was for boards; for workspaces we rely on tenant_iso). Setting
-- the tenant GUC + admin/owner membership lets the chain succeed.

RESET ROLE;
RESET app.current_tenant_id;
RESET app.current_user_id;
SET LOCAL ROLE app_user;
SET LOCAL app.current_tenant_id = :'workspace_a';
SET LOCAL app.current_user_id   = :'alice_id';

DO $$
DECLARE pre int; post int;
BEGIN
  SELECT count(*) INTO pre FROM workspace_invitations
   WHERE id = '00000000-0000-0000-0000-000000001601';
  IF pre <> 1 THEN
    RAISE EXCEPTION 'FAIL 16-pre: invitation should exist before delete, found %', pre;
  END IF;

  -- The actual cascade test: delete the parent workspace.
  DELETE FROM workspaces WHERE id = '11111111-aaaa-1111-aaaa-111111111111';

  -- Switch to BYPASSRLS to confirm the row really vanished from the table
  -- (not just hidden from app_user's RLS view).
  RESET ROLE;
  SELECT count(*) INTO post FROM workspace_invitations
   WHERE id = '00000000-0000-0000-0000-000000001601';
  IF post <> 0 THEN
    RAISE EXCEPTION 'FAIL 16: invitation should have cascaded away, still found %', post;
  END IF;
  RAISE NOTICE 'PASS 16: workspace DELETE cascaded invitations under FORCE RLS';
END$$;

RESET ROLE;
ROLLBACK TO SAVEPOINT t16;


-- ============================================================================
-- Final ROLLBACK — leaves DB in pristine state.
-- ============================================================================

ROLLBACK;

\echo ''
\echo '✓ ALL TESTS PASSED'
\echo ''
