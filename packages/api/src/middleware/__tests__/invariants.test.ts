// packages/api/src/middleware/__tests__/invariants.test.ts
//
// Unit + property-based tests for the six pure invariants in
// `../invariants/workspaceInvariants.ts`.
//
// fast-check is used on the three invariants whose input space is large
// enough to make hand-written cases miss something — assertCanRemoveMember,
// assertCanChangeMemberRole, assertCanLeaveWorkspace.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import type { WorkspaceRole } from "@repo/domain/workspaces";

import {
  assertCanInviteToWorkspace,
  assertCanRemoveMember,
  assertCanChangeMemberRole,
  assertCanLeaveWorkspace,
  assertCanTransferOwnership,
  assertCanDeleteWorkspace,
} from "../invariants/workspaceInvariants";

import {
  AdminCannotRemoveOwnerError,
  InsufficientRoleError,
  LastOwnerCannotLeaveError,
  PersonalWorkspaceCannotBeDeletedError,
  TransfereeMustBeMemberError,
} from "../invariants/errors";

// ─── Shared arbitraries ─────────────────────────────────────────────────────

const roleArb = fc.constantFrom<WorkspaceRole>(
  "OWNER",
  "ADMIN",
  "MEMBER",
  "VIEWER",
);

const ownerCountArb = fc.integer({ min: 1, max: 25 });

const isManager = (r: WorkspaceRole) => r === "OWNER" || r === "ADMIN";

// ════════════════════════════════════════════════════════════════════════════
// 1. assertCanInviteToWorkspace
// ════════════════════════════════════════════════════════════════════════════

describe("assertCanInviteToWorkspace", () => {
  it("allows OWNER", () => {
    expect(() => assertCanInviteToWorkspace("OWNER")).not.toThrow();
  });
  it("allows ADMIN", () => {
    expect(() => assertCanInviteToWorkspace("ADMIN")).not.toThrow();
  });
  it("blocks MEMBER", () => {
    expect(() => assertCanInviteToWorkspace("MEMBER")).toThrow(
      InsufficientRoleError,
    );
  });
  it("blocks VIEWER", () => {
    expect(() => assertCanInviteToWorkspace("VIEWER")).toThrow(
      InsufficientRoleError,
    );
  });

  it("property: only OWNER/ADMIN succeed", () => {
    fc.assert(
      fc.property(roleArb, (role) => {
        if (isManager(role)) {
          expect(() => assertCanInviteToWorkspace(role)).not.toThrow();
        } else {
          expect(() => assertCanInviteToWorkspace(role)).toThrow(
            InsufficientRoleError,
          );
        }
      }),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. assertCanRemoveMember
// ════════════════════════════════════════════════════════════════════════════

describe("assertCanRemoveMember", () => {
  it("OWNER can remove MEMBER (5 owners)", () => {
    expect(() => assertCanRemoveMember("OWNER", "MEMBER", 5)).not.toThrow();
  });
  it("OWNER can remove other OWNER when ownerCount > 1", () => {
    expect(() => assertCanRemoveMember("OWNER", "OWNER", 2)).not.toThrow();
  });
  it("OWNER cannot remove the last OWNER", () => {
    expect(() => assertCanRemoveMember("OWNER", "OWNER", 1)).toThrow(
      LastOwnerCannotLeaveError,
    );
  });
  it("ADMIN cannot remove OWNER even with many owners", () => {
    expect(() => assertCanRemoveMember("ADMIN", "OWNER", 10)).toThrow(
      AdminCannotRemoveOwnerError,
    );
  });
  it("ADMIN can remove MEMBER", () => {
    expect(() => assertCanRemoveMember("ADMIN", "MEMBER", 5)).not.toThrow();
  });
  it("MEMBER cannot remove anyone", () => {
    expect(() => assertCanRemoveMember("MEMBER", "MEMBER", 5)).toThrow(
      InsufficientRoleError,
    );
  });
  it("VIEWER cannot remove anyone", () => {
    expect(() => assertCanRemoveMember("VIEWER", "MEMBER", 5)).toThrow(
      InsufficientRoleError,
    );
  });

  it("property: ADMIN never removes OWNER, regardless of count", () => {
    fc.assert(
      fc.property(ownerCountArb, (ownerCount) => {
        expect(() =>
          assertCanRemoveMember("ADMIN", "OWNER", ownerCount),
        ).toThrow(AdminCannotRemoveOwnerError);
      }),
    );
  });

  it("property: OWNER never removes the last OWNER", () => {
    fc.assert(
      fc.property(fc.constant(1), () => {
        expect(() => assertCanRemoveMember("OWNER", "OWNER", 1)).toThrow(
          LastOwnerCannotLeaveError,
        );
      }),
    );
  });

  it("property: removing non-OWNER target only requires manager role", () => {
    fc.assert(
      fc.property(
        roleArb,
        fc.constantFrom<WorkspaceRole>("ADMIN", "MEMBER", "VIEWER"),
        ownerCountArb,
        (callerRole, targetRole, ownerCount) => {
          const action = () =>
            assertCanRemoveMember(callerRole, targetRole, ownerCount);
          if (isManager(callerRole)) {
            expect(action).not.toThrow();
          } else {
            expect(action).toThrow(InsufficientRoleError);
          }
        },
      ),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. assertCanChangeMemberRole
// ════════════════════════════════════════════════════════════════════════════

describe("assertCanChangeMemberRole", () => {
  it("OWNER can promote MEMBER to ADMIN", () => {
    expect(() =>
      assertCanChangeMemberRole("OWNER", "MEMBER", "ADMIN", 3),
    ).not.toThrow();
  });
  it("OWNER can promote MEMBER to OWNER", () => {
    expect(() =>
      assertCanChangeMemberRole("OWNER", "MEMBER", "OWNER", 1),
    ).not.toThrow();
  });
  it("OWNER can demote OWNER when ownerCount > 1", () => {
    expect(() =>
      assertCanChangeMemberRole("OWNER", "OWNER", "MEMBER", 3),
    ).not.toThrow();
  });
  it("OWNER cannot demote the last OWNER", () => {
    expect(() =>
      assertCanChangeMemberRole("OWNER", "OWNER", "MEMBER", 1),
    ).toThrow(LastOwnerCannotLeaveError);
  });
  it("ADMIN cannot demote OWNER", () => {
    expect(() =>
      assertCanChangeMemberRole("ADMIN", "OWNER", "MEMBER", 5),
    ).toThrow(AdminCannotRemoveOwnerError);
  });
  it("ADMIN cannot promote MEMBER to OWNER", () => {
    expect(() =>
      assertCanChangeMemberRole("ADMIN", "MEMBER", "OWNER", 5),
    ).toThrow(InsufficientRoleError);
  });
  it("MEMBER cannot change anyone's role", () => {
    expect(() =>
      assertCanChangeMemberRole("MEMBER", "MEMBER", "ADMIN", 5),
    ).toThrow(InsufficientRoleError);
  });

  it("property: ADMIN never participates in OWNER role transitions", () => {
    fc.assert(
      fc.property(
        // either targetRole or newRole is OWNER
        fc.oneof(
          fc.tuple(
            fc.constant<WorkspaceRole>("OWNER"),
            fc.constantFrom<WorkspaceRole>("ADMIN", "MEMBER", "VIEWER"),
          ),
          fc.tuple(
            fc.constantFrom<WorkspaceRole>("MEMBER", "VIEWER", "ADMIN"),
            fc.constant<WorkspaceRole>("OWNER"),
          ),
        ),
        ownerCountArb,
        ([targetRole, newRole], ownerCount) => {
          expect(() =>
            assertCanChangeMemberRole(
              "ADMIN",
              targetRole,
              newRole,
              ownerCount,
            ),
          ).toThrow();
        },
      ),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. assertCanLeaveWorkspace
// ════════════════════════════════════════════════════════════════════════════

describe("assertCanLeaveWorkspace", () => {
  it("MEMBER can always leave", () => {
    expect(() => assertCanLeaveWorkspace("MEMBER", 1)).not.toThrow();
    expect(() => assertCanLeaveWorkspace("MEMBER", 25)).not.toThrow();
  });
  it("VIEWER can always leave", () => {
    expect(() => assertCanLeaveWorkspace("VIEWER", 1)).not.toThrow();
  });
  it("ADMIN can always leave", () => {
    expect(() => assertCanLeaveWorkspace("ADMIN", 1)).not.toThrow();
  });
  it("OWNER can leave when other OWNERs exist", () => {
    expect(() => assertCanLeaveWorkspace("OWNER", 2)).not.toThrow();
  });
  it("the last OWNER cannot leave", () => {
    expect(() => assertCanLeaveWorkspace("OWNER", 1)).toThrow(
      LastOwnerCannotLeaveError,
    );
  });

  it("property: only OWNER+ownerCount===1 throws", () => {
    fc.assert(
      fc.property(roleArb, ownerCountArb, (role, ownerCount) => {
        const action = () => assertCanLeaveWorkspace(role, ownerCount);
        if (role === "OWNER" && ownerCount <= 1) {
          expect(action).toThrow(LastOwnerCannotLeaveError);
        } else {
          expect(action).not.toThrow();
        }
      }),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. assertCanTransferOwnership
// ════════════════════════════════════════════════════════════════════════════

describe("assertCanTransferOwnership", () => {
  it("OWNER can transfer to an existing member", () => {
    expect(() => assertCanTransferOwnership("OWNER", true)).not.toThrow();
  });
  it("OWNER cannot transfer to a non-member", () => {
    expect(() => assertCanTransferOwnership("OWNER", false)).toThrow(
      TransfereeMustBeMemberError,
    );
  });
  it("ADMIN cannot transfer", () => {
    expect(() => assertCanTransferOwnership("ADMIN", true)).toThrow(
      InsufficientRoleError,
    );
  });
  it("MEMBER cannot transfer", () => {
    expect(() => assertCanTransferOwnership("MEMBER", true)).toThrow(
      InsufficientRoleError,
    );
  });
  it("VIEWER cannot transfer", () => {
    expect(() => assertCanTransferOwnership("VIEWER", true)).toThrow(
      InsufficientRoleError,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. assertCanDeleteWorkspace
// ════════════════════════════════════════════════════════════════════════════

describe("assertCanDeleteWorkspace", () => {
  const sharedWs = { personalForUserId: null };
  const personalWs = { personalForUserId: "u-123" };

  it("OWNER can delete a shared workspace", () => {
    expect(() =>
      assertCanDeleteWorkspace("OWNER", sharedWs),
    ).not.toThrow();
  });
  it("OWNER cannot delete a personal workspace", () => {
    expect(() => assertCanDeleteWorkspace("OWNER", personalWs)).toThrow(
      PersonalWorkspaceCannotBeDeletedError,
    );
  });
  it("ADMIN cannot delete a shared workspace", () => {
    expect(() => assertCanDeleteWorkspace("ADMIN", sharedWs)).toThrow(
      InsufficientRoleError,
    );
  });
  it("MEMBER cannot delete a shared workspace", () => {
    expect(() => assertCanDeleteWorkspace("MEMBER", sharedWs)).toThrow(
      InsufficientRoleError,
    );
  });
});
