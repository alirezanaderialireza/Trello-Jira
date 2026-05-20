// packages/api/src/routers/workspaces/workspaces.router.ts
import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull } from "drizzle-orm";
import { router, protectedProcedure } from "../../trpc";
import { workspaces, workspaceMembers } from "@repo/db";

const IdSchema = z.string().uuid();
const NameSchema = z.string().trim().min(1).max(100);
const SlugSchema = z.string().trim().min(2).max(60).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
const RoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER"]);

export const workspacesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.infra.db.query.workspaceMembers.findMany({
      where: eq(workspaceMembers.userId, ctx.session.user.id),
    });
    if (memberships.length === 0) return [];
    const wsIds = memberships.map((m: any) => m.workspaceId);
    const wsList = await ctx.infra.db.query.workspaces.findMany({
      where: and(isNull(workspaces.deletedAt)),
    });
    const roleMap = new Map(memberships.map((m: any) => [m.workspaceId, m.role]));
    return wsList.filter((w: any) => wsIds.includes(w.id)).map((w: any) => ({ ...w, role: roleMap.get(w.id) }));
  }),

  create: protectedProcedure
    .input(z.object({ name: NameSchema, slug: SlugSchema.optional() }))
    .mutation(async ({ input, ctx }) => {
      const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 58) || `ws-${crypto.randomUUID().slice(0, 8)}`;
      const existing = await ctx.infra.db.query.workspaces.findFirst({ where: and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)) });
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Slug already taken." });

      const wsId = crypto.randomUUID();
      const now = new Date();
      await ctx.infra.db.insert(workspaces).values({ id: wsId, name: input.name, slug, tier: "free", ownerId: ctx.session.user.id, revision: 1, createdAt: now, updatedAt: now });
      await ctx.infra.db.insert(workspaceMembers).values({ workspaceId: wsId, userId: ctx.session.user.id, role: "OWNER", joinedAt: now });
      return { id: wsId, name: input.name, slug };
    }),

  getBySlug: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input, ctx }) => {
      const ws = await ctx.infra.db.query.workspaces.findFirst({ where: and(eq(workspaces.slug, input.slug), isNull(workspaces.deletedAt)) });
      if (!ws) throw new TRPCError({ code: "NOT_FOUND" });
      const member = await ctx.infra.db.query.workspaceMembers.findFirst({ where: and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, ctx.session.user.id)) });
      if (!member) throw new TRPCError({ code: "FORBIDDEN" });
      return { ...ws, role: member.role };
    }),

  inviteMember: protectedProcedure
    .input(z.object({ workspaceId: IdSchema, userId: z.string(), role: RoleSchema.default("MEMBER") }))
    .mutation(async ({ input, ctx }) => {
      const caller = await ctx.infra.db.query.workspaceMembers.findFirst({ where: and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, ctx.session.user.id)) });
      if (!caller || !["OWNER", "ADMIN"].includes(caller.role)) throw new TRPCError({ code: "FORBIDDEN" });
      const existing = await ctx.infra.db.query.workspaceMembers.findFirst({ where: and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.userId)) });
      if (existing) return { success: true, alreadyMember: true };
      await ctx.infra.db.insert(workspaceMembers).values({ workspaceId: input.workspaceId, userId: input.userId, role: input.role, joinedAt: new Date(), invitedBy: ctx.session.user.id });
      return { success: true, alreadyMember: false };
    }),

  removeMember: protectedProcedure
    .input(z.object({ workspaceId: IdSchema, userId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const caller = await ctx.infra.db.query.workspaceMembers.findFirst({ where: and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, ctx.session.user.id)) });
      if (!caller || !["OWNER", "ADMIN"].includes(caller.role)) throw new TRPCError({ code: "FORBIDDEN" });
      const target = await ctx.infra.db.query.workspaceMembers.findFirst({ where: and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.userId)) });
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });
      if (target.role === "OWNER") {
        const owners = await ctx.infra.db.query.workspaceMembers.findMany({ where: and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.role, "OWNER")) });
        if (owners.length <= 1) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot remove the last owner." });
      }
      await ctx.infra.db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.userId)));
      return { success: true };
    }),

  transferOwnership: protectedProcedure
    .input(z.object({ workspaceId: IdSchema, newOwnerId: IdSchema }))
    .mutation(async ({ input, ctx }) => {
      const caller = await ctx.infra.db.query.workspaceMembers.findFirst({ where: and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, ctx.session.user.id)) });
      if (!caller || caller.role !== "OWNER") throw new TRPCError({ code: "FORBIDDEN" });
      await ctx.infra.db.update(workspaceMembers).set({ role: "OWNER" }).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.newOwnerId)));
      await ctx.infra.db.update(workspaceMembers).set({ role: "ADMIN" }).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, ctx.session.user.id)));
      await ctx.infra.db.update(workspaces).set({ ownerId: input.newOwnerId, updatedAt: new Date() }).where(eq(workspaces.id, input.workspaceId));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ workspaceId: IdSchema }))
    .mutation(async ({ input, ctx }) => {
      const ws = await ctx.infra.db.query.workspaces.findFirst({ where: and(eq(workspaces.id, input.workspaceId), isNull(workspaces.deletedAt)) });
      if (!ws) throw new TRPCError({ code: "NOT_FOUND" });
      if (ws.ownerId !== ctx.session.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      if (ws.personalForUserId) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete personal workspace." });
      await ctx.infra.db.update(workspaces).set({ deletedAt: new Date() }).where(eq(workspaces.id, input.workspaceId));
      return { success: true };
    }),
});
