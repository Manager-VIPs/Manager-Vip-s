# VIP Bot

A Discord VIP bot with role expiration system and automatic role removal when memberships expire.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server + Discord bot (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required secrets: `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`
- Optional env: `VIP_ROLE_NAME` — name of the VIP role (default: `VIP`)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Discord: discord.js v14
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Build: esbuild (ESM bundle)

## Where things live

- `artifacts/api-server/src/bot/` — Discord bot code
  - `client.ts` — Discord client instance
  - `commands.ts` — Slash commands + VIP expiration logic
  - `index.ts` — Bot startup & event wiring
- `lib/db/src/schema/vipMembers.ts` — `vip_members` table schema

## Architecture decisions

- Bot runs inside the same Express process — no separate service needed
- VIP expiry is checked every 60 seconds via `setInterval`
- The "VIP" role is auto-created (gold color) if it doesn't exist in the guild
- VIP records are soft-deleted (`active = false`) rather than hard-deleted for audit history
- On conflict (re-granting VIP), the record is upserted and `grantedAt` resets

## Product

A Discord bot that lets admins grant timed VIP roles to members. Roles are automatically removed when the VIP period expires, with all memberships stored in a PostgreSQL database for persistence across restarts.

## Commands

| Command | Permission | Description |
|---|---|---|
| `/vip-add @user [days] [notes]` | Manage Roles | Grant VIP (default 30 days) |
| `/vip-remove @user` | Manage Roles | Remove VIP immediately |
| `/vip-list` | Manage Roles | List all active VIPs with expiry |
| `/vip-status` | Everyone | Check own VIP status |

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always run `pnpm run typecheck:libs` before `pnpm --filter @workspace/api-server run typecheck` so lib types are emitted first
- Discord slash commands can take up to 1 hour to propagate globally, but guild-scoped commands (used here) are instant

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
