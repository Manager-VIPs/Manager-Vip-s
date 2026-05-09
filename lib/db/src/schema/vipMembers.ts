import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vipMembersTable = pgTable("vip_members", {
  discordId: text("discord_id").primaryKey(),
  username: text("username").notNull(),
  roleId: text("role_id").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  active: boolean("active").default(true).notNull(),
  notes: text("notes"),
});

export const insertVipMemberSchema = createInsertSchema(vipMembersTable).omit({
  grantedAt: true,
  active: true,
});

export type InsertVipMember = z.infer<typeof insertVipMemberSchema>;
export type VipMember = typeof vipMembersTable.$inferSelect;
