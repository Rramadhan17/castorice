# Voice AI

Voice AI answers an explicit natural-language request with the configured AI
provider and then speaks that answer in the requesting member's current voice
channel. Enable **Voice AI** per server using `/menu` → **Settings** → **Feature
Selection**. It is disabled by default.

Configure `AI_API_KEY` and `AI_MODEL` as described in [AI Chat](./AI_CHAT.md),
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
