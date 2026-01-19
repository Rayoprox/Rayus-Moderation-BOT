const { SlashCommandBuilder } = require('discord.js');
const { DEVELOPER_IDS } = require('../../utils/config.js'); 
const db = require('../../utils/db.js');
const { success, error } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('delete_license')
        .setDescription('👑 Developer Only: Revoke a license by Guild ID.')
        .addStringOption(o => o.setName('id').setDescription('The Guild ID to revoke').setRequired(true)),

    async execute(interaction) {
        if (!DEVELOPER_IDS.includes(interaction.user.id)) {
            return interaction.editReply({ content: '❌ Access Denied: Global Developer Only.' });
        }

        const guildId = interaction.options.getString('id');
        const res = await db.query("DELETE FROM licenses WHERE guild_id = $1", [guildId]);

        if (res.rowCount > 0) {
            await interaction.editReply({ embeds: [success(`License for server \`${guildId}\` has been revoked.`)] });
        } else {
            await interaction.editReply({ embeds: [error(`No license found for Guild ID \`${guildId}\`.`)] });
        }
    },
};