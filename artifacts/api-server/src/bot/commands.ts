import {
  SlashCommandBuilder,
  REST,
  Routes,
  ChatInputCommandInteraction,
  GuildMember,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import { db, vipMembersTable } from "@workspace/db";
import { eq, and, lte, sql, gt } from "drizzle-orm";
import { logger } from "../lib/logger";
import { discordClient } from "./client";

const GUILD_ID = process.env.DISCORD_GUILD_ID!;
const VIP_ROLE_NAME = process.env.VIP_ROLE_NAME ?? "VIP";

/* ---------------- COMMANDS ---------------- */

export const commands = [
  new SlashCommandBuilder()
    .setName("vip-add")
    .setDescription("Grant VIP role to a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((o) =>
      o.setName("user").setDescription("The member to grant VIP").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("VIP type: basic, silver, gold, platinum")
        .setRequired(true),
    )
    .addIntegerOption((o) =>
      o.setName("days").setDescription("How many days VIP lasts (default: 30)").setRequired(false),
    )
    .addStringOption((o) =>
      o.setName("notes").setDescription("Optional notes").setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("vip-remove")
    .setDescription("Remove VIP role from a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((o) =>
      o.setName("user").setDescription("The member").setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("vip-list")
    .setDescription("List active VIP members")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName("vip-extend")
    .setDescription("Extend VIP expiry")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((o) =>
      o.setName("user").setDescription("VIP member").setRequired(true),
    )
    .addIntegerOption((o) =>
      o.setName("days").setDescription("Extra days").setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("vip-status")
    .setDescription("Check VIP status"),
].map((c) => c.toJSON());

/* ---------------- VIP ADD (MODIFIED) ---------------- */

async function handleVipAdd(
  interaction: ChatInputCommandInteraction,
  guild: any,
) {
  await interaction.deferReply({ ephemeral: true });

  const target = interaction.options.getUser("user", true);
  const days = interaction.options.getInteger("days") ?? 30;
  const notes = interaction.options.getString("notes") ?? null;
  const type = interaction.options.getString("type", true);

  const vipRoles: Record<string, string> = {
    basic: "1500505039289057401",
    silver: "1500505143819632701",
    gold: "1500505217987510354",
    platinum: "1500505307661467718",
  };

  const vipNames: Record<string, string> = {
    basic: "VIP BASIC",
    silver: "VIP SILVER",
    gold: "VIP GOLD",
    platinum: "VIP PLATINUM",
  };

  const vipColors: Record<string, any> = {
    basic: 0xcd7f32,
    silver: 0xc0c0c0,
    gold: 0xffd700,
    platinum: 0xe5e4e2,
  };

  const roleId = vipRoles[type];
  if (!roleId) {
    return interaction.editReply("Invalid VIP type (basic/silver/gold/platinum).");
  }

  const member = await guild.members.fetch(target.id).catch(() => null);
  if (!member) {
    return interaction.editReply("Member not found.");
  }

  const role = guild.roles.cache.get(roleId);
  if (!role) {
    return interaction.editReply("Role not found in server.");
  }

  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await member.roles.add(role, "VIP granted");

  await db
    .insert(vipMembersTable)
    .values({
      discordId: target.id,
      username: target.tag,
      roleId: role.id,
      expiresAt,
      notes,
    })
    .onConflictDoUpdate({
      target: vipMembersTable.discordId,
      set: {
        username: target.tag,
        roleId: role.id,
        expiresAt,
        active: true,
        notes,
        grantedAt: sql`now()`,
      },
    });

  const vipChannelId = "1502463499878662305";
  const channel = guild.channels.cache.get(vipChannelId);

  const embed = new EmbedBuilder()
    .setColor(vipColors[type])
    .setTitle("💎 VIP Granted")
    .setDescription(
      `👤 User: <@${target.id}>\n` +
      `🏷 Type: ${vipNames[type]}\n` +
      `⏳ Duration: ${days} days\n` +
      `📅 Expires: <t:${Math.floor(expiresAt.getTime() / 1000)}:R>`
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });

  if (channel && channel.isTextBased()) {
    await channel.send({ embeds: [embed] });
  }

  logger.info({ discordId: target.id, type }, "VIP granted");
}
