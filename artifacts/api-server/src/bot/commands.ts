import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
} from "discord.js";

import { db, vipMembersTable } from "@workspace/db";
import { sql, eq, and, lte } from "drizzle-orm";
import { logger } from "../lib/logger";
import { discordClient } from "./client";

const GUILD_ID = process.env.DISCORD_GUILD_ID!;
const TOKEN = process.env.DISCORD_BOT_TOKEN!;

/* ---------------- COMMANDS ---------------- */

export const commands = [
  new SlashCommandBuilder()
    .setName("vip-add")
    .setDescription("Grant VIP role to a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(o =>
      o.setName("user").setDescription("Member").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("type")
        .setDescription("VIP type")
        .setRequired(true)
        .addChoices(
          { name: "basic", value: "basic" },
          { name: "silver", value: "silver" },
          { name: "gold", value: "gold" },
          { name: "platinum", value: "platinum" },
        )
    )
    .addIntegerOption(o =>
      o.setName("days").setDescription("Days").setRequired(false)
    )
    .addStringOption(o =>
      o.setName("notes").setDescription("Notes").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("vip-status")
    .setDescription("Check VIP status"),
].map(c => c.toJSON());

/* ---------------- REGISTER COMMANDS ---------------- */

export async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const CLIENT_ID = discordClient.user?.id;
  if (!CLIENT_ID) throw new Error("Bot not ready (CLIENT_ID missing)");

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  logger.info("Slash commands registered");
}

/* ---------------- INTERACTION ---------------- */

export async function handleInteraction(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return;

  if (interaction.commandName === "vip-add") {
    return handleVipAdd(interaction, interaction.guild);
  }
}

/* ---------------- VIP ADD ---------------- */

async function handleVipAdd(
  interaction: ChatInputCommandInteraction,
  guild: any
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

  const roleId = vipRoles[type];
  if (!roleId) return interaction.editReply("Invalid VIP type");

  const member = await guild.members.fetch(target.id).catch(() => null);
  if (!member) return interaction.editReply("Member not found");

  const expiresAt = new Date(Date.now() + days * 86400000);

  await member.roles.add(roleId).catch(() => {});

  await db.insert(vipMembersTable).values({
    discordId: target.id,
    username: target.tag,
    roleId,
    expiresAt,
    notes,
    active: true,
  }).onConflictDoUpdate({
    target: vipMembersTable.discordId,
    set: {
      roleId,
      expiresAt,
      notes,
      active: true,
    },
  });

  const embed = new EmbedBuilder()
    .setTitle("💎 VIP GRANTED")
    .setColor(0xffd700)
    .setDescription(
      `User: <@${target.id}>\nType: ${type}\nExpires: <t:${Math.floor(expiresAt.getTime()/1000)}:R>`
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

/* ---------------- EXPIRE SYSTEM ---------------- */

export async function expireVipMembers() {
  const guild = discordClient.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  const expired = await db
    .select()
    .from(vipMembersTable)
    .where(and(eq(vipMembersTable.active, true), lte(vipMembersTable.expiresAt, new Date())));

  for (const vip of expired) {
    const member = await guild.members.fetch(vip.discordId).catch(() => null);

    if (member) {
      await member.roles.remove(vip.roleId).catch(() => {});
    }

    await db.update(vipMembersTable)
      .set({ active: false })
      .where(eq(vipMembersTable.discordId, vip.discordId));

    logger.info({ discordId: vip.discordId }, "VIP expired");
  }
}
