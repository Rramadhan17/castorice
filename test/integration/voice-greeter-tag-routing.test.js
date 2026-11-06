const test = require("node:test");
const assert = require("node:assert/strict");
const { Events, PermissionFlagsBits } = require("discord.js");
const registerInteractionHandler = require("../../src/events/interactionCreate");

test("natural Voice Greeter configuration requests route to the existing modal action", async () => {
    const handlers = new Map();
    const client = {
        user: { id: "123456789012345678" },
        on: (event, handler) => handlers.set(event, handler)
    };
    registerInteractionHandler(client, {
        featureGuard: async (_guildId, featureId) => ({
            allowed: featureId === "voice_greeter"
        })
    });

    let reply;
    const message = {
        author: { bot: false, id: "22345678901234567" },
        guild: {
            id: "12345678901234567",
            members: {
                fetch: async id => ({
                    id,
                    permissions: { has: flag => flag === PermissionFlagsBits.ManageGuild }
                })
            }
        },
        content: "Castorice: atur voice greeter",
        mentions: { users: { has: () => false } },
        reply: async payload => { reply = payload; }
    };

    await handlers.get(Events.MessageCreate)(message);
    assert.equal(reply.components[0].components[0].data.custom_id, "castorice:greeter_configure");
});
