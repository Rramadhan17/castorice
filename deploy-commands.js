require("dotenv").config();

const {
    REST,
    Routes,
    SlashCommandBuilder
} = require("discord.js");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
    throw new Error("DISCORD_TOKEN dan CLIENT_ID wajib diisi.");
}

const commands = [
    new SlashCommandBuilder()
        .setName("menu")
        .setDescription("Buka dashboard Castorice"),

    new SlashCommandBuilder()
        .setName("owner")
        .setDescription("Buka Owner Control Castorice")
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

async function deployCommands() {
    console.log("Mendaftarkan command Castorice...");

    await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
    );

    console.log("2 slash commands berhasil didaftarkan.");
}

deployCommands().catch(error => {
    console.error("[Deploy Error]", error);
    process.exitCode = 1;
});
