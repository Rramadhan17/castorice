require("dotenv").config();

const { REST, Routes } = require("discord.js");

const rest = new REST({ version: "10" })
    .setToken(process.env.DISCORD_TOKEN);

async function checkCommands() {
    const clientId = process.env.CLIENT_ID;

    console.log("Memeriksa global commands Castorice...\n");

    const commands = await rest.get(
        Routes.applicationCommands(clientId)
    );

    if (!commands.length) {
        console.log("Tidak ada global command yang tersimpan.");
        return;
    }

    for (const command of commands) {
        console.log(`/${command.name} — ${command.description}`);
    }

    console.log(`\nTotal command: ${commands.length}`);
}

checkCommands().catch(error => {
    console.error("Gagal memeriksa command:", error.message);
    process.exitCode = 1;
});
