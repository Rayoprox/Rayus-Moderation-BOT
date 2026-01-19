const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../utils/db.js');
const { success, error } = require('../../utils/embedFactory.js');
const ms = require('ms');

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('redeem')
        .setDescription('Activate your bot license.')
        .addStringOption(o => o.setName('key').setDescription('UP-XXXX-...').setRequired(true)),

    async execute(interaction) {
        const key = interaction.options.getString('key').trim();
        const res = await db.query("SELECT * FROM licenses WHERE key = $1", [key]);

        if (res.rows.length === 0) return interaction.editReply({ embeds: [error('Invalid Key.')] });
        const license = res.rows[0];

        if (license.guild_id) return interaction.editReply({ embeds: [error('Key already used.')] });

        let expiresAt = null;
        if (license.type.toLowerCase() !== 'permanent') {
            const time = ms(license.type);
            if (time) expiresAt = Date.now() + time;
        }

        await db.query("UPDATE licenses SET guild_id = $1, redeemed_by = $2, expires_at = $3 WHERE key = $4", [interaction.guild.id, interaction.user.id, expiresAt, key]);
        
        await interaction.editReply({ embeds: [success(`**License Activated!**\nExpires: ${expiresAt ? `<t:${Math.floor(expiresAt/1000)}:R>` : 'Never'}`)] });
    },
};