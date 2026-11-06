# AI Chat Configuration

AI Chat uses an OpenAI-compatible Chat Completions endpoint. No external AI
package is required; the provider uses the Node.js `fetch` implementation.

1. Copy the AI settings from `.env.example` into the bot's `.env`.
2. Set `AI_API_KEY` and `AI_MODEL` to credentials and a model supported by the
   selected provider.
3. Optionally set `AI_BASE_URL` for another OpenAI-compatible provider and
   `AI_TIMEOUT_MS` (100–120000 milliseconds).
4. Start the bot and enable **AI Chat** from `/menu` → **Settings** → **Feature
   Selection** for each guild that should use it.
5. Mention Castorice or start a message with `Castorice:`. Use
   `Castorice: reset percakapan` to clear that user's conversation context.

Conversation context is held in process memory, isolated by guild and user,
limited in size, and expires after 30 minutes of inactivity. It is not written
to disk and is cleared when the process restarts. A provider call is made only
after a valid bot trigger and an enabled guild feature. Do not send sensitive
information: prompts are sent to the configured external provider.

Without both `AI_API_KEY` and `AI_MODEL`, AI Chat remains unavailable and the
bot reports that configuration is required. No provider or model is assumed
to be available, and no test credential or API call is included.
