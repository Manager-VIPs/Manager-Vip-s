import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
} from "discord.js";
import { db, vipMembersTable } from "@workspace/db";
import { eq, and, lte } from "drizzle-orm";
import { logger } from "../lib/logger";
import { discordClient } from "./client";

const GUILD_ID = process.env.DISCORD_GUILD_ID!;
const TOKEN = process.env.DISCORD_BOT_TOKEN!;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID!;

/* ---------------- COMMANDS ---------------- */

export const commands = [
  new SlashCommandBuilder()
    .setName("vip-add")
    .setDescription("Grant VIP role")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((o) =>
      o.setName("user").setDescription("Member").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("basic/silver/gold/platinum")
        .setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName("days")
        .setDescription("Duration in days")
        .setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName("notes")
        .setDescription("Optional notes")
        .setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("vip-remove")
    .setDescription("Remove VIP role")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((o) =>
      o.setName("user").setDescription("Member").setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("vip-list")
    .setDescription("List VIP members")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName("vip-status")
    .setDescription("Check VIP status"),
].map((c) => c.toJSON());

/* ---------------- REGISTER ---------------- */

export async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    {
      body: commands,
    },
  );

  logger.info("Slash commands registered");
}

/* ---------------- HANDLER ---------------- */

export async function handleInteraction(
  interaction: ChatInputCommandInteraction,
) {
  const guild = interaction.guild;

  if (!guild) return;

  if (interaction.commandName === "vip-add") {
    return handleVipAdd(interaction, guild);
  }
}

/* ---------------- VIP ADD ---------------- */

async function handleVipAdd(
  interaction: ChatInputCommandInteraction,
  guild: any,
) {
  await interaction.deferReply({ ephemeral: true });

  const target = interaction.options.getUser("user", true);
  const type = interaction.options.getString("type", true);
  const days = interaction.options.getInteger("days") ?? 30;
  const notes = interaction.options.getString("notes") ?? "";

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

  const vipColors: Record<string, number> = {
    basic: 0xcd7f32,
    silver: 0xc0c0c0,
    gold: 0xffd700,
    platinum: 0xe5e4e2,
  };

  const roleId = vipRoles[type];

  if (!roleId) {
    return interaction.editReply("Invalid VIP type.");
  }

  const member = await guild.members
    .fetch(target.id)
    .catch(() => null);

  if (!member) {
    return interaction.editReply("Member not found.");
  }

  const role = guild.roles.cache.get(roleId);

  if (!role) {
    return interaction.editReply("Role not found.");
  }

  const expiresAt = new Date(
    Date.now() + days * 24 * 60 * 60 * 1000,
  );

  await member.roles.add(role);

  await db.insert(vipMembersTable).values({
    discordId: target.id,
    username: target.tag,
    roleId,
    expiresAt,
    notes,
  });

  const embed = new EmbedBuilder()
    .setColor(vipColors[type])
    .setTitle("💎 VIP Granted")
    .setDescription(
      `👤 User: <@${target.id}>\n` +
        `🏷 Type: ${vipNames[type]}\n` +
        `⏳ Duration: ${days} days\n` +
        `📅 Expires: <t:${Math.floor(
          expiresAt.getTime() / 1000,
        )}:R>\n` +
        `📝 Notes: ${notes || "None"}`
    )
    .setTimestamp();

  await interaction.editReply({
    embeds: [embed],
  });

  /* ---------------- VIP MEMBERS CHANNEL ---------------- */

  const vipChannelId = "1502463499878662305";

  const channel = guild.channels.cache.get(vipChannelId);

  if (channel && channel.isTextBased()) {
    const publicEmbed = new EmbedBuilder()
      .setColor(vipColors[type])
      .setTitle("💎 New VIP Member")
      .setDescription(
        `👤 User: <@${target.id}>\n` +
          `🏷 Tier: ${vipNames[type]}\n` +
          `⏳ Duration: ${days} days\n` +
          `📅 Expires: <t:${Math.floor(
            expiresAt.getTime() / 1000,
          )}:R>`
      )
      .setTimestamp();

    await channel.send({
      embeds: [publicEmbed],
    });
  }

  logger.info(
    {
      discordId: target.id,
      type,
      days,
    },
    "VIP granted",
  );
}

/* ---------------- EXPIRE SYSTEM ---------------- */

export async function expireVipMembers() {
  const guild = discordClient.guilds.cache.get(GUILD_ID);

  if (!guild) return;

  const expired = await db
    .select()
    .from(vipMembersTable)
    .where(
      and(
        eq(vipMembersTable.active, true),
        lte(vipMembersTable.expiresAt, new Date()),
      ),
    );

  for (const vip of expired) {
    const member = await guild.members
      .fetch(vip.discordId)
      .catch(() => null);

    if (member) {
      await member.roles.remove(vip.roleId).catch(() => {});
    }

    await db
      .update(vipMembersTable)
      .set({ active: false })
      .where(eq(vipMembersTable.discordId, vip.discordId));

    logger.info(
      { discordId: vip.discordId },
      "VIP expired",
    );
  }
}
