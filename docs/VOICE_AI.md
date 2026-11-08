# Voice AI

Voice AI answers an explicit natural-language request with the configured AI
provider and then speaks that answer in the requesting member's current voice
channel. Enable **Voice AI** per server using `/menu` → **Settings** → **Feature
Selection**. It is disabled by default.

Configure at least one AI provider as described in [AI Chat](./AI_CHAT.md),
then configure `VOICE_GREETER_TTS_MODULE` with a trusted local module that
implements the [Voice Greeter TTS contract](./VOICE_GREETER_TTS.md). No TTS
provider is bundled or assumed available.

Supported explicit requests include:

- `@Castorice voice ai explain aurora`
- `Castorice: jawab pakai suara jelaskan aurora`
- `Castorice: ucapkan selamat datang`

The user must already be in a voice channel in the same server. Voice AI uses
the configured TTS provider and the existing voice playback lifecycle and will
not interrupt an active music session or another bot voice connection. If
playback is unavailable, the text answer is still reported as text-only.

This feature does not implement speech recognition, inbound audio processing,
or continuous/live conversation.

## Voice AI Center: access and disconnect controls

The `/menu` Dashboard includes **Voice AI Center** for per-server voice access
and session controls. Auto Kick Voice is disabled by default and only applies
to voice channels an administrator explicitly protects. Trusted members and
trusted roles are managed per server; non-trusted users are disconnected from
voice (not kicked or banned) only after the configured grace period. The bot
needs the channel-level **Move Members** permission to enforce this policy.

Only the server owner, a Manage Server administrator, or the configured bot
owner can change Voice AI Center settings. Members can view basic status; they
cannot modify server policy. Admins can manage trusted entries, role/channel
exceptions, the grace period, and the activity log in the Dashboard. Natural
language commands such as `@Castorice aktifkan Auto Kick Voice`,
`Castorice, tambahkan member ini ke trusted members`, and
`Castorice, lindungi voice channel ini` use the same permission-checked service.

Administrators can also set, view, extend, reset, or cancel a Voice Disconnect
Timer. Timers bind to the current guild and voice-session identity. A timer
clears if Castorice leaves or changes channels; persisted timer metadata is
cancelled on restart to avoid disconnecting a later session. These flows are
mock-tested only; configure permissions and verify in a staging guild before
production use.
