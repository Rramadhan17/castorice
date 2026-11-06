# Voice Greeter TTS provider

Voice Greeter continues to send its configured text greeting when no TTS provider is installed. TTS is optional and is enabled by setting `VOICE_GREETER_TTS_MODULE` to a trusted local Node.js module path in `.env`.

The module must export `synthesize(text, context)`. It receives `context.guildId`, `context.memberId`, and an `AbortSignal` at `context.signal`. It must resolve within 15 seconds to a Node.js `Readable` that emits an Ogg/Opus audio stream, or a `Buffer` containing a complete Ogg/Opus stream. The provider module owns its endpoint, credentials, voice selection, and any provider-specific request format. It should stop its request when the signal is aborted. Castorice does not assume a vendor API or log provider errors that may contain credentials.

Example provider shape:

```js
const { Readable } = require("node:stream");

module.exports = {
    async synthesize(text, { guildId, memberId }) {
        // Call the configured TTS service and return Ogg/Opus bytes.
        const bytes = await yourProviderCall(text, { guildId, memberId });
        return Readable.from([bytes]);
    }
};
```

The bot loads the module during startup. Keep its API key in the provider's environment configuration; do not commit secrets or include them in thrown error messages. If the provider cannot be loaded or audio playback fails, Castorice keeps the already-sent text greeting.

For voice safety, TTS only connects when the bot has no active Music session or current voice connection and has Connect/Speak permissions for the joining member's channel. It disconnects after playback and enforces a 30-second playback limit. TTS is skipped while Music or another voice connection is active so the greeting cannot interrupt playback.

No TTS provider is included or configured by default. A syntactically valid provider module and compatible Ogg/Opus output are required before audio greetings are active.
