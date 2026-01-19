const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { DEVELOPER_IDS } = require('../../utils/config.js'); 
const db = require('../../utils/db.js');
const crypto = require('crypto');
const ms = require('ms');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('generate_license')
        .setDescription('👑 Developer Only: Create a new license.')
        .addStringOption(o => o.setName('duration').setDescription('Duration (e.g. 30d, 1y) or "permanent"').setRequired(true)),

    async execute(interaction) {
        if (!DEVELOPER_IDS.includes(interaction.user.id)) {
            return interaction.editReply({ content: '❌ Access Denied: Global Developer Only.' });
        }

        const duration = interaction.options.getString('duration');
        const key = `UP-${crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-')}`;
        
        await db.query("INSERT INTO licenses (key, type, created_at) VALUES ($1, $2, $3)", [key, duration, Date.now()]);

        const embed = new EmbedBuilder()
            .setTitle('🎫 License Generated')
            .setDescription(`**Key:** \`${key}\`\n**Type:** ${duration}`)
            .setColor(0x00FF00);

        await interaction.editReply({ embeds: [embed] });
    },
};