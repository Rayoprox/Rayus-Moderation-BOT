const { SlashCommandBuilder } = require('discord.js');
const setupHome = require('../../interactions/admin/setup_sections/home.js'); 
const { safeDefer } = require('../../utils/interactionHelpers.js');
const { error } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Shows the main setup panel.'),

    generateSetupContent: setupHome.generateSetupContent,

    async execute(interaction) {
        if (!await safeDefer(interaction, true)) return;
        try {
            const { embed, components } = await setupHome.generateSetupContent(interaction, interaction.guild.id);
            await interaction.editReply({ embeds: [embed], components });
        } catch (err) {
            console.error(err);
            await interaction.editReply({ embeds: [error('Error loading setup panel.')] });
        }
    },
};