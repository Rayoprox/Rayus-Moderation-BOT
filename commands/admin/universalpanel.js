const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../utils/db.js');
const { SUPREME_IDS, emojis } = require('../../utils/config.js');

module.exports = {
    deploy: 'main', 
    data: new SlashCommandBuilder()
        .setName('universalpanel')
        .setDescription('👑 Advanced Control Panel (Restricted Access).'),

    async execute(interaction) {
        if (!SUPREME_IDS.includes(interaction.user.id)) {
            return interaction.editReply({ 
                content: `${emojis.error} **ACCESS DENIED.** You are not authorized to use this panel.`
            });
        }

        const guildId = interaction.guild.id;

        const res = await db.query('SELECT universal_lock FROM guild_settings WHERE guildid = $1', [guildId]);
        let isLocked = res.rows[0]?.universal_lock || false;

        const embed = new EmbedBuilder()
            .setTitle('👑 Management Control Panel')
            .setDescription(`Control the absolute permission state of the bot.\n\n**Current State:** ${isLocked ? `${emojis.lock} **RESTRICTED (Lockdown)**` : `${emojis.unlock} **DEFAULT (Standard)**`}`)
            .addFields(
                { name: `${emojis.unlock} Standard Mode`, value: 'Admins have full access.\nStaff Roles work normally.' },
                { name: `${emojis.lock} Strict Mode (Lockdown)`, value: 'Admins have **NO** access.\nOnly database-configured roles can use commands.' },
                { name: '⚙️ Secure Setup', value: 'Configure who can use `/setup`. (This command cannot configure itself via the normal menu).' }
            )
            .setColor(isLocked ? 0xFF0000 : 0x00FF00);

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('univ_toggle_lock')
                .setLabel(isLocked ? 'Disable Strict Mode' : 'Enable Strict Mode')
                .setEmoji(isLocked ? (emojis.unlock || '🔓') : (emojis.lock || '🔒'))
                .setStyle(isLocked ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('univ_config_setup') 
                .setLabel('Manage /setup Access')
                .setEmoji('⚙️')
                .setStyle(ButtonStyle.Primary)
        );

        await interaction.editReply({ embeds: [embed], components: [row1] });
    },
};