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

export const commands = [
  new SlashCommandBuilder()
    .setName("vip-add")
    .setDescription("Grant VIP role to a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((o) =>
      o.setName("user").setDescription("The member to grant VIP").setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("type")
        .setDescription("VIP type: basic, silver, gold, platinum")
        .setRequired(true),
    )
    .addIntegerOption((o) =>
      o.setName("days").setDescription("How many days VIP lasts (default: 30)").setRequired(false),
    )
    .addStringOption((o) =>
      o.setName("notes").setDescription("Optional notes about this VIP grant").setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("vip-remove")
    .setDescription("Remove VIP role from a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((o) =>
      o.setName("user").setDescription("The member to remove VIP from").setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("vip-list")
    .setDescription("List all active VIP members")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName("vip-extend")
    .setDescription("Extend an existing VIP member's expiry")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((o) =>
      o.setName("user").setDescription("The VIP member to extend").setRequired(true),
    )
    .addIntegerOption((o) =>
      o.setName("days").setDescription("How many additional days to add (default: 30)").setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("vip-status")
    .setDescription("Check your VIP status"),
].map((c) => c.toJSON());

/* ---------------- VIP ADD ---------------- */

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
    basic: 0xCD7F32,
    silver: 0xC0C0C0,
    gold: 0xFFD700,
    platinum: 0xE5E4E2,
  };

  const roleId = vipRoles[type];
  if (!roleId) {
    return interaction.editReply("Invalid VIP type.");
  }

  const member = await guild.members.fetch(target.id).catch(() => null);
  if (!member) {
    return interaction.editReply("Member not found.");
  }

  const role = guild.roles.cache.get(roleId);
  if (!role) {
    return interaction.editReply("Role not found.");
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

  const embed = new EmbedBuilder()
    .setColor(vipColors[type])
    .setTitle("VIP Granted")
    .addFields(
      { name: "Member", value: `<@${target.id}>`, inline: true },
      { name: "Type", value: vipNames[type], inline: true },
      { name: "Duration", value: `${days} days`, inline: true },
      { name: "Expires", value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`, inline: true },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });

  // 🔥 VIP CHANNEL POST
  const vipChannelId = "1502463499878662305";
  const channel = guild.channels.cache.get(vipChannelId);

  if (channel) {
    const embed2 = new EmbedBuilder()
      .setColor(vipColors[type])
      .setTitle("💎 New VIP Member")
      .setDescription(
        `👤 User: <@${target.id}>\n` +
        `⭐ Tier: ${vipNames[type]}\n` +
        `⏳ Duration: ${days} days\n` +
        `📅 Expires: <t:${Math.floor(expiresAt.getTime() / 1000)}:R>`
      )
      .setTimestamp();

    await (channel as any).send({ embeds: [embed2] });
  }

  logger.info({ discordId: target.id, days, type }, "VIP granted");
}
