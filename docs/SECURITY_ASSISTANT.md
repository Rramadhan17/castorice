# Security Assistant bot presence

The Security Assistant reports presence only for bot members currently present
in the Discord.js guild member cache. Its snapshot distinguishes `online`,
`idle`, `dnd`, `offline/invisible`, and `unknown`; it never treats missing data
as an offline bot. Discord presence does not distinguish an intentionally
invisible user/bot from a disconnected one, and cache coverage is not
guaranteed, so these numbers are diagnostic and not proof of bot health.

Presence collection is disabled by default. To request Gateway presence data,
set `DISCORD_ENABLE_PRESENCE_INTENT=true` and enable the privileged **Presence
Intent** required by the bot's Discord application
in the Developer Portal. Restart the bot after changing the setting. If the
intent is unavailable or disabled, status may remain unknown.

The audit only reports observations. It does not automatically kick bots,
change server settings, or claim to determine why a bot is offline.
