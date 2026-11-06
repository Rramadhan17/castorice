const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
    JsonGuildStore,
    StorageValidationError
} = require("../../src/storage/json-guild-store");

const GUILD_A = "12345678901234567";
const GUILD_B = "22345678901234567";

async function makeStore(options = {}) {
    const rootDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "castorice-storage-")
    );

    return {
        rootDir,
        store: new JsonGuildStore({ rootDir, ...options }),
        cleanup: () => fs.rm(rootDir, { recursive: true, force: true })
    };
}

test("read returns a cloned default when no record exists", async t => {
    const { store, cleanup } = await makeStore();
    t.after(cleanup);

    const fallback = { count: 0 };
    const result = await store.read(GUILD_A, "settings", {
        defaultValue: fallback
    });

    assert.deepEqual(result, fallback);
    assert.notEqual(result, fallback);
});

test("records are isolated by guild and collection", async t => {
    const { store, cleanup } = await makeStore();
    t.after(cleanup);

    await store.write(GUILD_A, "settings", { enabled: true });
    await store.write(GUILD_B, "settings", { enabled: false });
    await store.write(GUILD_A, "playlist", { names: ["mix"] });

    assert.deepEqual(await store.read(GUILD_A, "settings"), { enabled: true });
    assert.deepEqual(await store.read(GUILD_B, "settings"), { enabled: false });
    assert.deepEqual(await store.read(GUILD_A, "playlist"), { names: ["mix"] });
});

test("writes use a versioned envelope and reject incompatible schema versions", async t => {
    const { store, rootDir, cleanup } = await makeStore();
    t.after(cleanup);

    await store.write(GUILD_A, "settings", { enabled: true }, {
        schemaVersion: 2
    });

    const filePath = path.join(rootDir, GUILD_A, "settings.json");
    const envelope = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.equal(envelope.schemaVersion, 2);
    assert.equal(envelope.guildId, GUILD_A);
    assert.equal(envelope.collection, "settings");
    assert.equal(typeof envelope.updatedAt, "string");

    await assert.rejects(
        store.read(GUILD_A, "settings", { schemaVersion: 1 }),
        StorageValidationError
    );
});

test("validation runs on reads and writes", async t => {
    const { store, cleanup } = await makeStore();
    t.after(cleanup);
    const validate = value => value && Number.isInteger(value.count);

    await assert.rejects(
        store.write(GUILD_A, "counter", { count: "one" }, { validate }),
        StorageValidationError
    );

    await store.write(GUILD_A, "counter", { count: 1 }, { validate });
    await assert.rejects(
        store.read(GUILD_A, "counter", {
            validate: () => false
        }),
        StorageValidationError
    );
});

test("same guild collection updates serialize without lost writes", async t => {
    const { store, cleanup } = await makeStore();
    t.after(cleanup);
    const validate = value => value && Number.isSafeInteger(value.count);

    await store.write(GUILD_A, "counter", { count: 0 }, { validate });
    await Promise.all(Array.from({ length: 40 }, () =>
        store.update(GUILD_A, "counter", async current => {
            await new Promise(resolve => setTimeout(resolve, 1));
            return { count: current.count + 1 };
        }, { validate })
    ));

    assert.deepEqual(
        await store.read(GUILD_A, "counter", { validate }),
        { count: 40 }
    );
});

test("guild IDs, collection names and oversized records are rejected", async t => {
    const { store, cleanup } = await makeStore({ maxBytes: 256 });
    t.after(cleanup);

    await assert.rejects(store.read("../../other", "settings"), TypeError);
    await assert.rejects(store.read(GUILD_A, "../settings"), TypeError);
    await assert.rejects(
        store.write(GUILD_A, "settings", { value: "x".repeat(400) }),
        StorageValidationError
    );
});

test("remove is idempotent", async t => {
    const { store, cleanup } = await makeStore();
    t.after(cleanup);

    assert.equal(await store.remove(GUILD_A, "settings"), false);
    await store.write(GUILD_A, "settings", { enabled: true });
    assert.equal(await store.remove(GUILD_A, "settings"), true);
    assert.equal(await store.remove(GUILD_A, "settings"), false);
});

test("read, update and remove reject a redirected guild directory", async t => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "castorice-storage-link-root-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "castorice-storage-link-outside-"));
    t.after(async () => {
        await fs.rm(rootDir, { recursive: true, force: true });
        await fs.rm(outsideDir, { recursive: true, force: true });
    });

    await fs.writeFile(path.join(outsideDir, "settings.json"), JSON.stringify({
        schemaVersion: 1,
        guildId: GUILD_A,
        collection: "settings",
        updatedAt: new Date().toISOString(),
        data: { secret: "outside" }
    }));

    try {
        await fs.symlink(outsideDir, path.join(rootDir, GUILD_A), "junction");
    } catch (error) {
        if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
            t.skip("This environment does not allow directory junction creation.");
            return;
        }
        throw error;
    }

    const store = new JsonGuildStore({ rootDir });
    await assert.rejects(
        store.read(GUILD_A, "settings"),
        StorageValidationError
    );
    await assert.rejects(
        store.update(GUILD_A, "settings", current => current),
        StorageValidationError
    );
    await assert.rejects(
        store.remove(GUILD_A, "settings"),
        StorageValidationError
    );
    assert.equal(await fs.readFile(path.join(outsideDir, "settings.json"), "utf8").then(Boolean), true);
});
