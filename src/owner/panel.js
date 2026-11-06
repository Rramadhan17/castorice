const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

function buildOwnerPanel(client) {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Castorice • Owner Control")
        .setDescription(
            "**Private Owner Dashboard**\n" +
            "Panel khusus pemilik Castorice."
        )
        .addFields(
            {
                name: "Bot Status",
                value: "ONLINE",
                inline: true
            },
            {
                name: "Connected Servers",
                value: String(client.guilds.cache.size),
                inline: true
            },
            {
                name: "Owner Access",
                value: "AUTHENTICATED",
                inline: true
            },
            {
                name: "Control Center",
                value:
                    "Pilih bagian yang ingin diperiksa melalui tombol di bawah."
            }
        )
        .setFooter({ text: "Castorice • Private Owner Panel" })
        .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("owner:global")
            .setLabel("Global Control")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("owner:servers")
            .setLabel("Server Management")
            .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("owner:health")
            .setLabel("System Health")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("owner:maintenance")
            .setLabel("Maintenance")
            .setStyle(ButtonStyle.Secondary)
    );

    return {
        embeds: [embed],
        components: [row1, row2]
    };
}

function buildOwnerSubPanel(section, client) {
    const pages = {
        global: {
            title: "Global Control",
            description:
                "Pusat kontrol global seluruh server Castorice."
        },
        servers: {
            title: "Server Management",
            description:
                `Castorice terhubung ke ${client.guilds.cache.size} server.`
        },
        health: {
            title: "System Health",
            description:
                "Pemeriksaan detail Gateway, Database, Music Engine, AI Service, dan modul lainnya akan diintegrasikan pada tahap berikutnya."
        },
        maintenance: {
            title: "Maintenance",
            description:
                "Pengaturan maintenance global, per server, dan per modul akan diintegrasikan pada tahap berikutnya."
        }
    };

    const page = pages[section];
    if (!page) return null;

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`Castorice • ${page.title}`)
        .setDescription(page.description)
        .setFooter({ text: "Private Owner Control" })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("owner:home")
            .setLabel("Kembali")
            .setStyle(ButtonStyle.Primary)
    );

    return { embeds: [embed], components: [row] };
}

module.exports = {
    buildOwnerPanel,
    buildOwnerSubPanel
};
