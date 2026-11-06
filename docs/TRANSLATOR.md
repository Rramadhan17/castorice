# Translator configuration

Castorice's Translator backend uses the LibreTranslate HTTP API at `src/translator/libretranslate-provider.js`. The Dashboard Translator panel and AI Tag mention route are connected.

Configuration (keep credentials in the local `.env`, never commit them):

- `LIBRETRANSLATE_URL` — API base URL, defaults to `https://libretranslate.com`. A self-hosted LibreTranslate instance is supported.
- `LIBRETRANSLATE_API_KEY` — optional for an instance that does not require a key; required by hosted instances configured to enforce keys.
- `TRANSLATOR_TIMEOUT_MS` — optional request timeout, defaults to `10000`.
- `TRANSLATOR_MAX_LENGTH` — optional input length cap, defaults to `4000` Unicode code points.

The provider reads supported language pairs from `/languages` and submits JSON to `/translate`. It supports LibreTranslate's `auto` source language mode. Provider response bodies and credentials are never included in thrown errors. Provider availability, API key, network access, and language models determine runtime availability; no live translation request has been made during development.

Example service use:

```js
const { createTranslatorFromEnv } = require("./src/translator/libretranslate-provider");
const translator = createTranslatorFromEnv();
const result = await translator.translate({ text: "Hello", source: "en", target: "id" });
```

Dashboard users can open **Translator → Pilih Bahasa** to load provider-supported target languages. The picker is paginated at 25 options per page and opens the translation form with the selected language code prefilled. **Terjemahkan Teks** remains available for manual source/target codes (`auto` detects the source). If the provider language endpoint is unavailable, the Dashboard reports the failure instead of showing an empty or success-shaped list.

In AI Tag, use `@Castorice terjemahkan hello ke id` or `@Castorice translate hello dari en ke tl`.

For the current song, use `@Castorice terjemahkan lirik ke id` or the **Translate Lyrics → ID** button in the lyrics panel. The original timed lyrics remain synchronized; the translated text is shown separately because line-by-line timing alignment is not guaranteed.

Run isolated unit tests with `node --test test/translator/*.test.js`.
