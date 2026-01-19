const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const setupHome = require('../../interactions/admin/setup_sections/home.js'); 
const { safeDefer } = require('../../utils/interactionHelpers.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Shows the main setup panel.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

 
    generateSetupContent: setupHome.generateSetupContent,

    async execute(interaction) {
        if (!await safeDefer(interaction, true)) return;
        try {
       
            const { embed, components } = await setupHome.generateSetupContent(interaction, interaction.guild.id);
            await interaction.editReply({ embeds: [embed], components });
        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: '❌ Error loading setup.' });
        }
    },
};