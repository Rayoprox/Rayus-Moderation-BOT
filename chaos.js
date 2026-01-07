const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

require('dotenv').config(); // Asegúrate de tener dotenv instalado
const TOKEN = process.env.CHAOS_TOKEN; // Pon el token en tu archivo .env
const CLIENT_ID = process.env.CHAOS_CLIENT_ID;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    new SlashCommandBuilder().setName('createchannels').setDescription('Create test channels').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('createroles').setDescription('Create test roles').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('testingprotection').setDescription('Run simulation').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'createchannels') {
        await interaction.deferReply();
        for (let i = 0; i < 10; i++) {
            await interaction.guild.channels.create({ name: `channel-${i}` }).catch(() => {});
        }
        await interaction.editReply('Channels created.');
    }

    if (interaction.commandName === 'createroles') {
        await interaction.deferReply();
        for (let i = 0; i < 10; i++) {
            await interaction.guild.roles.create({ name: `role-${i}` }).catch(() => {});
        }
        await interaction.editReply('Roles created.');
    }

    if (interaction.commandName === 'testingprotection') {
        await interaction.deferReply();
        
        const channels = interaction.guild.channels.cache.filter(c => c.deletable).first(5);
        const roles = interaction.guild.roles.cache.filter(r => r.editable && r.name !== '@everyone').first(5);

        const promises = [];
        channels.forEach(c => promises.push(c.delete().catch(() => {})));
        roles.forEach(r => promises.push(r.delete().catch(() => {})));
        
        await Promise.all(promises);

        for (let i = 0; i < 5; i++) {
             interaction.guild.channels.create({ name: `test-channel-${i}` }).catch(() => {});
             interaction.guild.roles.create({ name: `test-role-${i}` }).catch(() => {});
        }
        
        await interaction.editReply('Simulation executed.');
    }
});

client.login(TOKEN);