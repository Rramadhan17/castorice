# Security Assistant bot presence

The Security Assistant reports presence only for bot members currently present in the Discord.js guild member cache. Its snapshot distinguishes `online`, `idle`, `dnd`, `offline/invisible`, and `unknown`; it never treats missing data as an offline bot. Discord presence does not distinguish an intentionally invisible user or bot from a disconnected one, and cache coverage is not guaranteed. Therefore, these numbers are diagnostic and do not prove bot health.

Presence collection is disabled by default. To request Gateway presence data, set `DISCORD_ENABLE_PRESENCE_INTENT=true` and enable the privileged **Presence Intent** for the bot application in the Discord Developer Portal. Restart the bot after changing the setting. If the intent is unavailable or disabled, status may remain unknown.

The audit only reports observations. It does not automatically kick bots, change server settings, or claim to determine why a bot is offline.

## Automatic spam observation and per-guild moderation

The message-event monitor starts automatically in alert-only mode. It tracks repeated identical text per guild, channel, and user within `SECURITY_SPAM_WINDOW_MS=10000`, and persists one alert when `SECURITY_SPAM_DELETE_THRESHOLD=5` is reached. The alert is based on a fingerprint; message text is never persisted. `SECURITY_SPAM_EXEMPT_IDS` accepts up to 100 comma-separated Discord user IDs.

The monitor requires the `GuildMessages` and privileged `MessageContent` Gateway intents. Enable Message Content for the bot application in the Discord Developer Portal. Persistent guild policy and audit JSON are stored under `data/storage`, so configure persistent storage on the hosting platform if this data must survive restarts or redeployments.

Deleting messages or applying timeouts is disabled by default independently in every guild. An administrator with **Manage Server** permission must open `/menu` > **Security Assistant** > **Kebijakan Spam**, review the thresholds and timeout duration, and confirm the policy. The confirmed policy is saved separately for each guild.

The legacy `SECURITY_AUTO_MODERATION` setting is obsolete and ignored. It cannot enable destructive moderation; only the confirmed per-guild policy can do so.

Before any destructive action, the Security Assistant verifies the feature guard, the bot's effective permissions in the message channel, the moderator's or administrator's effective permissions in that channel, user exemptions, bot and webhook status, ownership, and (for timeouts) role hierarchy and `ModerateMembers`.

Configure the bot with `ManageMessages` and `ModerateMembers` permissions where needed. The administrator approving the policy must have `Manage Server` permission.

Unknown moderator permissions are treated as privileged. A durable audit intent must be stored before each delete or timeout. If audit persistence fails, the action is not attempted. Bounded audit records contain IDs, counts, policy changes, and outcomes, never message text.

This monitor only detects repeated identical text. Repetitive legitimate messages may still cross the threshold; test alert behavior on an authorized test server before enabling per-guild moderation.

The monitor does not kick or ban members and does not take action based on offline-bot presence. The monitor and its safeguards have mock regression coverage only. Discord Gateway behavior, effective permissions, message deletion, and timeout behavior have not been tested live.
