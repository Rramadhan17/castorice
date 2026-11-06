const test = require("node:test");
const assert = require("node:assert/strict");
const { PermissionFlagsBits } = require("discord.js");
const {
    isGreeterConfigurationIntent,
    createVoiceGreeterTagRouter
} = require("../../src/voice-ai/greeter-tag-router");

test("Voice Greeter AI Tag parser accepts explicit configuration requests only", () => {
    assert.equal(isGreeterConfigurationIntent("atur voice greeter"), true);
    assert.equal(isGreeterConfigurationIntent("configure greeting voice greeter!"), true);
    assert.equal(isGreeterConfigurationIntent("buat voice private bernama Game Room"), false);
    assert.equal(isGreeterConfigurationIntent("greeting welcome members"), false);
});

test("Voice Greeter AI Tag requires an enabled feature and Manage Server", async () => {
    const replies = [];
    let memberFetches = 0;
    const message = {
        guild: {
            id: "12345678901234567",
            members: {
                async fetch(id) {
                    memberFetches += 1;
                    return { id, permissions: { has: () => false } };
                }
            }
        },
        author: { id: "22345678901234567" },
        reply: async payload => replies.push(payload)
    };

    const disabled = createVoiceGreeterTagRouter({
        featureGuard: async () => ({ allowed: false, reason: "Greeter nonaktif" })
    });
    assert.equal(await disabled({ message, commandText: "atur voice greeter" }), true);
    assert.equal(replies[0].content, "Greeter nonaktif");
    assert.equal(memberFetches, 0);

    const denied = createVoiceGreeterTagRouter({
        featureGuard: async () => ({ allowed: true })
    });
    await denied({ message, commandText: "atur voice greeter" });
    assert.match(replies[1].content, /Manage Server/i);
    assert.equal(replies[1].allowedMentions.parse.length, 0);
});

test("Voice Greeter AI Tag links authorized users to the existing settings modal", async () => {
    let reply;
    const route = createVoiceGreeterTagRouter({
        featureGuard: async (guildId, featureId) => {
            assert.equal(guildId, "12345678901234567");
            assert.equal(featureId, "voice_greeter");
            return { allowed: true };
        }
    });
    const message = {
        guild: {
            id: "12345678901234567",
            members: {
                fetch: async id => ({
                    id,
                    permissions: { has: flag => flag === PermissionFlagsBits.ManageGuild }
                })
            }
        },
        author: { id: "22345678901234567" },
        reply: async payload => { reply = payload; }
    };

    assert.equal(await route({ message, commandText: "atur pesan voice greeter" }), true);
    assert.match(reply.content, /massal akan dinonaktifkan/i);
    assert.equal(reply.components[0].components[0].data.custom_id, "castorice:greeter_configure");
    assert.deepEqual(reply.allowedMentions, { parse: [] });
});
