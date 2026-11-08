# AI Chat Configuration

Google Gemini is Castorice's only AI provider. AI Chat and Voice AI use the
same Gemini integration; a Gemini failure never triggers a request to OpenAI,
OpenRouter, or another provider.

Configure these process environment variables:

- `GEMINI_API_KEY` — required Gemini API key.
- `GEMINI_MODEL` — optional Gemini model ID. If omitted, Castorice performs
  bounded, timed discovery of models supporting `generateContent`.
- `AI_TIMEOUT_MS` — optional request timeout from 100 to 120000 milliseconds;
  defaults to 15000.

Legacy `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `OPENROUTER_API_KEY`,
`OPENROUTER_MODEL`, `AI_PROVIDER_ORDER`, and `AI_FAILOVER_ENABLED` values are
not used by the runtime. Provider priority, rotation, and cross-provider
failover have been removed. The existing Gemini environment configuration is
preserved. Never place real keys in tracked example files.

Gemini generates natural-language answers to general questions, explanations,
discussion, and idea requests. The system prompt guides Indonesian, informal
Indonesian, slang, English, and mixed-language responses to follow the user's
language. Feature intents still route through deterministic intent handlers
and permission-checked backend services; conversational AI does not execute
server-changing actions by itself.

Conversation context is held temporarily in memory, scoped to the guild and
channel, shared by that channel's participants, and resettable with
`Castorice: reset percakapan`. Each member has an independent cooldown. A
provider/configuration failure returns an honest error instead of a generated
or template substitute. Logs contain only the provider name, operation, HTTP
status when available, and a safe error category; they do not contain keys,
headers, request payloads, or conversation text.

HTTP 400 is reported as a request/configuration error; 401/403 as an
authentication/access problem; 429 as quota or rate limit; 5xx and timeouts as
temporary failures. Gemini API keys are never displayed in Discord or logs.
An environment key being present is only a configuration check, not proof of
connectivity or model access.

AI Chat is available only when the bot owner enables global AI and a server
administrator enables AI Chat for that server. Members can use the feature
after both checks pass but cannot change either setting. Feature-specific
commands are routed before conversational AI.

Automated tests use mocks and do not make a live Gemini API request. Gemini
authentication, model entitlement, quota, and response quality must be
verified separately in an authorized staging environment before claiming
live connectivity.
