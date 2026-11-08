const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { JsonGuildStore } = require("../../src/storage/json-guild-store");
const { createSecurityAssistant } = require("../../src/security/assistant");

test("Security Assistant persists monitor decisions in the bounded audit log", async t => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "castorice-security-monitor-"));
    t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
    const service = createSecurityAssistant({ store: new JsonGuildStore({ rootDir }) });
    const guildId = "12345678901234567";

    await service.recordMonitorEvent(
        guildId,
        "spam_message_deleted",
        "member=22345678901234567; channel=32345678901234567; count=5"
    );

    const events = await service.listAuditLog(guildId);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "spam_message_deleted");
    assert.match(events[0].detail, /count=5/);
    assert.equal("actorId" in events[0], false);
    await assert.rejects(
        service.recordMonitorEvent(guildId, "offline_policy_activated", "unsafe event type"),
        /audit event is invalid/
    );
});
