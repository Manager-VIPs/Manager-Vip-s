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
import { eq, and, lte, sql } from "drizzle-orm";
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
    .setName("vip-status")
    .setDescription("Check your VIP status"),
].map((c) => c.toJSON());

export async function registerCommands() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = discordClient.user?.id;

  if (!token || !clientId) {
    logger.error("Missing DISCORD_BOT_TOKEN or bot not ready — skipping command registration");
    return;
  }

  const rest = new REST({ version: "10" }).setToken(token);
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, GUILD_ID), {
      body: commands,
    });
    logger.info("Slash commands registered");
  } catch (err) {
    logger.error({ err }, "Failed to register slash commands");
  }
}

async function getOrCreateVipRole(guild: NonNullable<ReturnType<typeof discordClient.guilds.cache.get>>) {
  let role = guild.roles.cache.find((r) => r.name === VIP_ROLE_NAME);
  if (!role) {
    role = await guild.roles.create({
      name: VIP_ROLE_NAME,
      color: "Gold",
      reason: "Auto-created by VIP bot",
    });
    logger.info({ roleId: role.id }, "Created VIP role");
  }
  return role;
}

export async function handleInteraction(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) return;

  const guild = discordClient.guilds.cache.get(GUILD_ID);
  if (!guild) {
    await interaction.reply({ content: "Guild not found.", ephemeral: true });
    return;
  }

  if (interaction.commandName === "vip-add") {
    await handleVipAdd(interaction, guild);
  } else if (interaction.commandName === "vip-remove") {
    await handleVipRemove(interaction, guild);
  } else if (interaction.commandName === "vip-list") {
    await handleVipList(interaction);
  } else if (interaction.commandName === "vip-status") {
    await handleVipStatus(interaction);
  }
}

async function handleVipAdd(
  interaction: ChatInputCommandInteraction,
  guild: NonNullable<ReturnType<typeof discordClient.guilds.cache.get>>,
) {
  await interaction.deferReply({ ephemeral: true });

  const target = interaction.options.getUser("user", true);
  const days = interaction.options.getInteger("days") ?? 30;
  const notes = interaction.options.getString("notes") ?? null;

  const role = await getOrCreateVipRole(guild);
  const member = await guild.members.fetch(target.id).catch(() => null);
  if (!member) {
    await interaction.editReply("Member not found in this server.");
    return;
  }

  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await member.roles.add(role, `VIP granted by ${interaction.user.tag}`);

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
    .setColor("Gold")
    .setTitle("VIP Granted")
    .addFields(
      { name: "Member", value: `<@${target.id}>`, inline: true },
      { name: "Duration", value: `${days} days`, inline: true },
      { name: "Expires", value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`, inline: true },
    )
    .setTimestamp();

  if (notes) embed.addFields({ name: "Notes", value: notes });

  await interaction.editReply({ embeds: [embed] });
  logger.info({ discordId: target.id, days }, "VIP granted");
}

async function handleVipRemove(
  interaction: ChatInputCommandInteraction,
  guild: NonNullable<ReturnType<typeof discordClient.guilds.cache.get>>,
) {
  await interaction.deferReply({ ephemeral: true });

  const target = interaction.options.getUser("user", true);
  const role = await getOrCreateVipRole(guild);
  const member = await guild.members.fetch(target.id).catch(() => null);

  if (member) {
    await member.roles.remove(role, `VIP removed by ${interaction.user.tag}`);
  }

  await db
    .update(vipMembersTable)
    .set({ active: false })
    .where(eq(vipMembersTable.discordId, target.id));

  await interaction.editReply({ content: `VIP removed from <@${target.id}>.` });
  logger.info({ discordId: target.id }, "VIP removed");
}

async function handleVipList(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const members = await db
    .select()
    .from(vipMembersTable)
    .where(eq(vipMembersTable.active, true))
    .orderBy(vipMembersTable.expiresAt);

  if (members.length === 0) {
    await interaction.editReply("No active VIP members.");
    return;
  }

  const embed = new EmbedBuilder()
    .setColor("Gold")
    .setTitle(`Active VIP Members (${members.length})`)
    .setTimestamp();

  const lines = members.map((m) => {
    const expireTs = Math.floor(new Date(m.expiresAt).getTime() / 1000);
    return `<@${m.discordId}> — expires <t:${expireTs}:R>`;
  });

  embed.setDescription(lines.join("\n"));
  await interaction.editReply({ embeds: [embed] });
}

async function handleVipStatus(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const [member] = await db
    .select()
    .from(vipMembersTable)
    .where(
      and(
        eq(vipMembersTable.discordId, interaction.user.id),
        eq(vipMembersTable.active, true),
      ),
    )
    .limit(1);

  if (!member) {
    await interaction.editReply("You don't have an active VIP subscription.");
    return;
  }

  const expireTs = Math.floor(new Date(member.expiresAt).getTime() / 1000);
  const embed = new EmbedBuilder()
    .setColor("Gold")
    .setTitle("Your VIP Status")
    .addFields(
      { name: "Status", value: "Active", inline: true },
      { name: "Expires", value: `<t:${expireTs}:R>`, inline: true },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

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
    const member = await guild.members.fetch(vip.discordId).catch(() => null);
    if (member) {
      const role = guild.roles.cache.get(vip.roleId);
      if (role) {
        await member.roles.remove(role, "VIP expired").catch(() => null);
      }
    }

    await db
      .update(vipMembersTable)
      .set({ active: false })
      .where(eq(vipMembersTable.discordId, vip.discordId));

    logger.info({ discordId: vip.discordId }, "VIP expired — role removed");
  }

  if (expired.length > 0) {
    logger.info({ count: expired.length }, "VIP expiration check complete");
  }
}
