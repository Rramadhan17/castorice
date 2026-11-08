# Castorice storage foundation

`src/storage/json-guild-store.js` provides an isolated, guild-scoped JSON adapter for new modules. It is intentionally not wired into the existing feature or voice-state managers yet, so their on-disk formats and cache behavior remain unchanged.

## Use

```js
const { JsonGuildStore } = require("../storage/json-guild-store");

const store = new JsonGuildStore();
const validateSettings = value =>
    value && typeof value.enabled === "boolean";

await store.write(guildId, "translator", { enabled: true }, {
    schemaVersion: 1,
    validate: validateSettings
});

const settings = await store.read(guildId, "translator", {
    schemaVersion: 1,
    defaultValue: { enabled: false },
    validate: validateSettings
});
```

The default root is `data/storage/`, separate from existing `data/guilds/<guildId>/*.json` records. The adapter stores `{ schemaVersion, guildId, collection, updatedAt, data }`, validates guild/collection identifiers, enforces a configurable record-size limit, serializes operations per guild and collection, writes through a same-directory temporary file followed by rename, and rejects symlinked guild directories or record files.

The API is `read`, `write`, `update`, and `remove`. `update` serializes read-modify-write operations for one record. Pass a `validate(data, context)` function to enforce each module's schema; returning `false` or throwing rejects the operation. Schema version mismatches are errors. Migration policy must be defined by each adopting module before it imports legacy records.

This first adapter is file-backed. It does not use the installed `pg` dependency, provide cross-process locking, perform backups/retention, or automatically migrate existing data. Do not run multiple bot processes against the same storage root until cross-process coordination is added.

## Render Free Web Service persistence warning

The current application stores guild collections under `data/storage/<guildId>/`,
legacy guild settings under `data/guilds/<guildId>/`, and global AI settings in
`data/global-ai-settings.json`. These files are on the service filesystem and
must be treated as ephemeral on Render Free: deploys, restarts, or instance
replacement can lose them. The installed `pg` package is not currently wired
to these stores. Persistent production data requires a separately configured
persistent database/storage service and an explicit migration; the HTTP health
endpoint does not imply persistence.
