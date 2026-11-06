require("dotenv").config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const ownerId = process.env.OWNER_ID;

if (!token) {
    throw new Error("DISCORD_TOKEN belum diisi di .env");
}

if (!clientId) {
    throw new Error("CLIENT_ID belum diisi di .env");
}

if (!ownerId || !/^\d{17,20}$/.test(ownerId)) {
    throw new Error("OWNER_ID belum diisi atau formatnya tidak valid di .env");
}

module.exports = { token, clientId, ownerId };
