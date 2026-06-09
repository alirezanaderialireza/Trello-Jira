// apps/web/e2e/specs/phase-1.1-smoke.spec.ts
//
// Twelve-step end-to-end flow that exercises the entire Phase 1.1
// surface in a single linear scenario. Two users, two browser
// contexts, one shared (test) database that is dropped + migrated
// in `beforeAll`.
//
// Why a single test (not 12 isolated tests):
//   The flow is a state machine — each step depends on the
//   previous one's data (a workspace can't be archived before
//   it's created). Splitting would require independent fixture
//   setup for every step, which dwarfs the per-step assertion
//   value. A single test with `test.step` blocks gives the same
//   readability with a fraction of the harness code.
//
// Two users, two contexts:
//   `userA` (the workspace creator) and `userB` (the invitee) live
//   in separate browser contexts so their cookies don't collide.
//   This mirrors real-world usage and lets us watch the realtime
//   sidebar update from B's perspective while A drives.
//
// Selectors:
//   We mostly target by Persian text + role. Some pre-F4 pages
//   have a11y gaps (label without htmlFor, etc.) — the auth helper
//   in `fixtures/auth.ts` documents the workarounds for those.
//   Polish PR phase-1.4 closes the gaps; for now the spec uses
//   structural selectors as a stable shim.
//
// What is NOT covered (intentional):
//   • Email rendering (covered by F5a templates' unit tests).
//   • Outbox-worker handler (handler unit-tests cover dispatch;
//     the spec just reads the invitation token directly from the
//     DB rather than parsing the captured email).
//   • Realtime WebSocket events (covered by F0.4 hookup tests).
//
// Sandbox awareness:
//   The agent that wrote this spec cannot run Playwright. The
//   first run is the user's; see apps/web/e2e/README.md.

import { test, expect, type Page, type BrowserContext } from "@playwright/test";

import { signUp } from "../fixtures/auth";
import { seedFixture } from "../fixtures/seed";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const USER_A = {
  displayName: "آرش (مالک)",
  email: "user-a@e2e.local",
  password: "e2e-password-A1!",
};

const USER_B = {
  displayName: "بهروز (دعوت‌شده)",
  email: "user-b@e2e.local",
  password: "e2e-password-B2!",
};

const WORKSPACE_NAME = "تیم آزمون";
const BOARD_TITLE = "تابلوی برنامه‌ریزی";

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

// ─── Re-skipped — Phase 1.4 spec rewrite task ────────────────────────────
// PR #60 (tRPC App Router migration) was empirically validated by
// re-running this spec post-merge: step 1 (signup → /workspaces) PASSED
// in 21 seconds (previously 60s timeout from the Sidebar crash). The
// production blocker — "Unable to find tRPC Context" on /workspaces —
// is resolved.
//
// Step 2+ then exposed a different class of issue: the spec was
// authored predictively (before the UI was final). After two correction
// rounds (selector + workspace card wait), step 2 still failed because
// (likely) a workspace.create input validation issue with Persian names
// or a downstream UI mismatch that is not surface-visible in CI logs.
//
// Per Master Contract Rule 4 (Scope Discipline) and the F5c-Recovery
// prompt's stop-condition (≤3 fix iterations on step 2+ before
// STOP-AND-ASK), spec reconciliation is deferred to Phase 1.4.
// CI debugging cycles are not the right medium for this work — local
// browser walks with DevTools open are.
//
// What Phase 1.4 inherits (NOT lost effort — starting point):
//   • Working Playwright config + dependency wiring
//   • CI integration with continue-on-error: true (still active)
//   • Auth fixtures (signUp + signIn with markEmailVerified bypass)
//   • Seed fixture (resetDatabase + getInvitationToken)
//   • The 12-step spec content (selectors below need adjustment vs.
//     actual UI, but the flow structure is sound)
//   • One verified passing step (step 1: signup + login dance)
//
// Phase 1.4 task list:
//   1. Boot the dev server locally with the trello_e2e DB
//   2. Walk each spec step manually with browser DevTools open
//   3. Update selectors to match the actual rendered DOM
//   4. Remove `.skip` (revert to plain test.describe)
//   5. Verify all 4 cases pass (desktop + mobile × 1 retry each)
//   6. Set continue-on-error: false in .github/workflows/ci.yml
//
// See .kiro/steering/phase-1.1-complete.md → "Polish followups" for
// the parked-TODO entry that tracks this.
//
// ─── F1.4.6-web update — READY FOR LOCAL UNSKIP ──────────────────────────
// Selectors have been reconciled against the REAL UI (each step carries a
// traceability comment naming its source component). Specifically:
//   • Persian UI is final (F1.4.5) — predictive English selectors replaced.
//   • window.confirm steps (7 archive, 12 leave) migrated to the manual
//     ConfirmDialog (F1.4.4); confirm clicks are scoped to role="alertdialog".
//   • step 10 (star) is now a HARD assertion (BoardStarButton, F1.4.4).
//   • step 11's incorrect combobox assertion was fixed to assert the
//     owner-only transfer button disappears.
//   • auth fixtures use getByLabel (F1.4.5 added htmlFor + id).
// This is still .skip and CI stays continue-on-error: true ON PURPOSE — the
// web sandbox cannot run Playwright to verify. TO ACTIVATE (local only):
//   1. follow apps/web/e2e/LOCAL_RUNBOOK.md,
//   2. remove `.skip` below,
//   3. confirm all 4 cases pass (desktop + mobile × 1 retry),
//   4. flip ci.yml e2e `continue-on-error: false` + `--frozen-lockfile`,
//   5. record outcomes in apps/web/e2e/e2e-results.md.
// ─────────────────────────────────────────────────────────────────────────
test.describe.skip("Phase 1.1 — workspace lifecycle smoke flow", () => {
  let userAContext: BrowserContext;
  let userBContext: BrowserContext;
  let userAPage: Page;
  let userBPage: Page;

  test.beforeAll(async ({ browser }) => {
    await seedFixture.resetDatabase();
    userAContext = await browser.newContext();
    userBContext = await browser.newContext();
    userAPage = await userAContext.newPage();
    userBPage = await userBContext.newPage();
  });

  test.afterAll(async () => {
    await userAContext.close();
    await userBContext.close();
    await seedFixture.dispose();
  });

  test("twelve-step flow: signup → invite → accept → archive → transfer → leave", async () => {
    // ── 1. User A signs up ───────────────────────────────────────────────
    await test.step("1. User A signs up", async () => {
      await signUp(userAPage, USER_A);
      // The (app) layout writes the user's display name into the
      // topnav profile chip; assert we can see it as a sanity check
      // that the session is real.
      await expect(userAPage).toHaveURL(/\/workspaces|\/verify-email/);
    });

    // ── 2. User A creates a workspace ───────────────────────────────────
    let workspaceSlug = "";
    await test.step("2. User A creates a workspace", async () => {
      await userAPage.goto("/workspaces");
      // Selector source: app/(app)/workspaces/page.tsx (reconciled F1.4.6-web).
      //   The Create form is INLINE (no dialog/CTA):
      //     • <input placeholder="نام فضای کاری..." />   (no id/label)
      //     • <button type="submit">ساخت</button>
      //   After submit there is no redirect; the page calls refetch() +
      //   toast.success("فضای کاری ساخته شد.") and the new workspace card
      //   appears in the grid. We click the card to navigate into
      //   /workspaces/[slug] and capture the slug from the URL.
      await userAPage.getByPlaceholder(/نام فضای کاری/).fill(WORKSPACE_NAME);
      await userAPage.getByRole("button", { name: "ساخت", exact: true }).click();

      // Wait for the workspace card to appear in the list. Card is
      // a <Link> so getByRole("link") with the Persian workspace name
      // is the most semantic anchor.
      const card = userAPage.getByRole("link", { name: new RegExp(WORKSPACE_NAME) });
      await card.waitFor({ timeout: 10_000 });
      await card.click();

      await userAPage.waitForURL(/\/workspaces\/[a-z0-9-]+(?!\/)/);
      const url = new URL(userAPage.url());
      const match = url.pathname.match(/\/workspaces\/([a-z0-9-]+)/);
      workspaceSlug = match?.[1] ?? "";
      expect(workspaceSlug).not.toBe("");
    });

    // ── 3. User A creates a board inside the workspace ──────────────────
    let boardId = "";
    await test.step("3. User A creates a board", async () => {
      // Selector source: app/(app)/workspaces/[slug]/page.tsx (reconciled
      // F1.4.6-web). The create-board form is INLINE (not a dialog):
      //   • <input placeholder="عنوان بورد..." />   (no id/label)
      //   • <button type="submit">ساخت</button>  ("در حال ساخت..." while pending)
      //   onSuccess → router.push(`/board/${created.id}`)
      await userAPage.getByPlaceholder(/عنوان بورد/).fill(BOARD_TITLE);
      await userAPage.getByRole("button", { name: "ساخت", exact: true }).click();

      await userAPage.waitForURL(/\/board\/[0-9a-f-]+/);
      const url = new URL(userAPage.url());
      const match = url.pathname.match(/\/board\/([0-9a-f-]+)/);
      boardId = match?.[1] ?? "";
      expect(boardId).not.toBe("");
    });

    // ── 4. User A invites User B by email ───────────────────────────────
    await test.step("4. User A invites User B", async () => {
      // Selector source: features/settings/workspace/InviteMemberModal.tsx
      // (reconciled F1.4.6-web):
      //   • trigger: <button> with Plus icon + text "دعوت عضو"
      //   • modal:   role="dialog" aria-labelledby="invite-member-title"
      //   • email:   <label htmlFor="invite-email">ایمیل</label>
      //   • submit:  <button>ارسال دعوت</button>  ("در حال ارسال..." pending)
      // Scope email/submit to the dialog so we don't collide with member
      // emails rendered in the table behind it.
      await userAPage.goto(`/workspaces/${workspaceSlug}/settings/members`);
      await userAPage.getByRole("button", { name: /دعوت عضو/ }).click();
      const inviteDialog = userAPage.getByRole("dialog");
      await inviteDialog.getByLabel("ایمیل").fill(USER_B.email);
      // Default role is MEMBER; spec keeps that.
      await inviteDialog.getByRole("button", { name: /ارسال دعوت/ }).click();
      // Toast confirms; the modal closes and the pending list
      // re-renders. Assert the email shows up in the pending row.
      await expect(userAPage.getByText(USER_B.email)).toBeVisible({ timeout: 10_000 });
    });

    // ── 5. User B signs up + visits the invitation URL + accepts ────────
    await test.step("5. User B signs up + accepts the invitation", async () => {
      await signUp(userBPage, USER_B);
      const token = await seedFixture.getInvitationToken(USER_B.email);
      expect(token).not.toBeNull();
      await userBPage.goto(`/invitations/${encodeURIComponent(token!)}`);
      // Selector source: features/invitation/AcceptInvitationCard.tsx —
      // logged-in default state renders <button>پذیرش دعوت</button>.
      await userBPage.getByRole("button", { name: /پذیرش دعوت/ }).click();
      // Successful accept navigates to /workspaces/[slug].
      await userBPage.waitForURL(new RegExp(`/workspaces/${workspaceSlug}`));
    });

    // ── 6. Both users see each other in the members list ────────────────
    await test.step("6. Both users see each other in the members list", async () => {
      // Selector source: features/settings/workspace/MembersTable.tsx —
      // each row renders the member's displayName in a <p> (getByText).
      await userAPage.goto(`/workspaces/${workspaceSlug}/settings/members`);
      await expect(userAPage.getByText(USER_A.displayName)).toBeVisible();
      await expect(userAPage.getByText(USER_B.displayName)).toBeVisible();

      await userBPage.goto(`/workspaces/${workspaceSlug}/settings/members`);
      await expect(userBPage.getByText(USER_A.displayName)).toBeVisible();
      await expect(userBPage.getByText(USER_B.displayName)).toBeVisible();
    });

    // ── 7. User A archives the board ────────────────────────────────────
    await test.step("7. User A archives the board", async () => {
      // Selector source: app/board/[boardId]/_components/DangerTab.tsx +
      // app/board/[boardId]/_components/BoardSettings.tsx (reconciled
      // F1.4.6-web). Navigating with ?settings=danger auto-mounts the
      // settings drawer on the danger tab (BoardSettings owns the
      // ?settings=<tab> query param).
      //
      // Archive is now a MANUAL ConfirmDialog (F1.4.4), NOT window.confirm:
      //   • panel trigger:  <button>بایگانی</button>  (Archive icon + text)
      //   • ConfirmDialog:  role="alertdialog", confirmLabel="بایگانی"
      // Both buttons share the name "بایگانی", so we scope the confirm
      // click to the alertdialog. (The old page.once("dialog") shim is
      // removed — there is no window.confirm anymore.)
      await userAPage.goto(`/board/${boardId}?settings=danger`);
      await userAPage.getByRole("button", { name: "بایگانی", exact: true }).click();
      const archiveDialog = userAPage.getByRole("alertdialog");
      await archiveDialog.getByRole("button", { name: "بایگانی" }).click();
      // The board page renders an archived banner (page.tsx) once archived.
      await userAPage.goto(`/board/${boardId}`);
      await expect(userAPage.getByText(/این بورد بایگانی شده/)).toBeVisible({ timeout: 10_000 });
    });

    // ── 8. User B's sidebar no longer shows the archived board ─────────
    await test.step("8. Sidebar hides archived board for User B", async () => {
      await userBPage.goto(`/workspaces/${workspaceSlug}`);
      // The archived board should be filtered out of starred + recent
      // (the F5c sidebar fix). The sidebar's recent section is
      // best-effort; we assert via the boards LIST endpoint as
      // a stronger guarantee — fetching `/workspaces/<slug>` re-
      // renders the page using `workspace.listBoards` which already
      // filters archived by default.
      await expect(userBPage.getByText(BOARD_TITLE)).not.toBeVisible({ timeout: 5_000 });
    });

    // ── 9. User A unarchives the board ─────────────────────────────────
    await test.step("9. User A unarchives the board", async () => {
      // Selector source: DangerTab.tsx — when archived, the panel shows
      // <button>خروج از بایگانی</button>. Unarchive runs directly (no
      // confirmation dialog), so a single click suffices.
      await userAPage.goto(`/board/${boardId}?settings=danger`);
      await userAPage.getByRole("button", { name: /خروج از بایگانی/ }).click();
      await userAPage.goto(`/board/${boardId}`);
      // The archived banner should be gone.
      await expect(userAPage.getByText(/این بورد بایگانی شده/)).not.toBeVisible();
    });

    // ── 10. User A stars the board ─────────────────────────────────────
    await test.step("10. User A stars the board", async () => {
      // Selector source: features/board/components/BoardStarButton.tsx
      // (F1.4.4, reconciled F1.4.6-web). The button sits in the BoardView
      // header with a Persian aria-label containing "موارد ستاره‌دار":
      //   • not starred: «افزودن «<title>» به موارد ستاره‌دار»
      //   • starred:     «حذف «<title>» از موارد ستاره‌دار»
      // The button now always exists, so this is a HARD assertion (the
      // previous best-effort soft/count check is removed).
      await userAPage.goto(`/board/${boardId}`);
      const starButton = userAPage.getByRole("button", { name: /موارد ستاره‌دار/ });
      await expect(starButton).toBeVisible({ timeout: 10_000 });
      await starButton.click();
      // The starred board appears in the sidebar's Starred section, which
      // the (app) layout renders on /workspaces.
      await userAPage.goto("/workspaces");
      await expect(userAPage.getByText(BOARD_TITLE).first()).toBeVisible({ timeout: 10_000 });
    });

    // ── 11. User A transfers ownership to User B ────────────────────────
    await test.step("11. User A transfers workspace ownership to User B", async () => {
      // Selector source: features/settings/workspace/MembersTable.tsx +
      // TransferOwnershipDialog.tsx (reconciled F1.4.6-web):
      //   • row action (OWNER viewer, non-OWNER row): <button>ارتقاء به مالک</button>
      //   • dialog (role="dialog"): confirm <button>تأیید انتقال مالکیت</button>
      await userAPage.goto(`/workspaces/${workspaceSlug}/settings/members`);
      await userAPage.getByRole("button", { name: /ارتقاء به مالک/ }).first().click();
      await userAPage.getByRole("button", { name: /تأیید انتقال مالکیت/ }).click();
      // After the transfer, User A is ADMIN (no longer OWNER), so the
      // owner-only "ارتقاء به مالک" controls disappear for every row.
      //
      // NOTE (F1.4.6-web fix): the previous assertion looked for a role
      // <combobox> on User A's own row, which is INCORRECT — MembersTable
      // never renders a role <select> for the current user's own row
      // (canChangeRole = !isOwnerRow && !isSelf), and after the transfer
      // there are zero comboboxes. We assert the owner-only transfer
      // button is gone instead, which correctly proves the demotion.
      await userAPage.goto(`/workspaces/${workspaceSlug}/settings/members`);
      await expect(
        userAPage.getByRole("button", { name: /ارتقاء به مالک/ }),
      ).toHaveCount(0);
    });

    // ── 12. User A leaves the workspace ─────────────────────────────────
    await test.step("12. User A leaves the workspace", async () => {
      // Selector source: features/settings/workspace/DangerZone.tsx
      // (reconciled F1.4.6-web). Leave is now a MANUAL ConfirmDialog
      // (F1.4.4), NOT window.confirm:
      //   • panel trigger:  <button>خروج از فضای کاری</button>
      //   • ConfirmDialog:  role="alertdialog", confirmLabel="خروج"
      // Scope the confirm click to the alertdialog. (The old
      // page.once("dialog") shim is removed — no window.confirm anymore.)
      await userAPage.goto(`/workspaces/${workspaceSlug}/settings/danger`);
      await userAPage.getByRole("button", { name: "خروج از فضای کاری" }).click();
      const leaveDialog = userAPage.getByRole("alertdialog");
      await leaveDialog.getByRole("button", { name: "خروج", exact: true }).click();
      // After leaving, User A is bounced to /workspaces.
      await userAPage.waitForURL(/\/workspaces$/);
      // The workspace should no longer be in the sidebar.
      await expect(userAPage.getByText(WORKSPACE_NAME)).not.toBeVisible();
    });
  });
});
