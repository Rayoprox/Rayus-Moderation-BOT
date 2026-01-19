const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../../utils/db.js');
const { safeDefer } = require('../../../utils/interactionHelpers.js');
const guildCache = require('../../../utils/guildCache.js');

module.exports = async (interaction) => {
    const { customId, guild } = interaction;
    const guildId = guild.id;

    if (customId === 'setup_antinuke') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT antinuke_enabled, threshold_count, threshold_time FROM guild_backups WHERE guildid = $1", [guildId]);
        const settings = res.rows[0] || { antinuke_enabled: false, threshold_count: 10, threshold_time: 60 };
        const status = settings.antinuke_enabled ? '✅ ENABLED' : '❌ DISABLED';
        
        const embed = new EmbedBuilder().setTitle('☢️ Anti-Nuke').setDescription(`**Status:** ${status}`).setColor(settings.antinuke_enabled ? 0x2ECC71 : 0xE74C3C);
        const toggle = new ButtonBuilder().setCustomId('antinuke_toggle').setLabel('Toggle').setStyle(settings.antinuke_enabled ? ButtonStyle.Danger : ButtonStyle.Success);
        const back = new ButtonBuilder().setCustomId('setup_menu_protection').setLabel('Back').setStyle(ButtonStyle.Secondary);
        
        await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(toggle, back)] });
        return;
    }

    if (customId === 'antinuke_toggle') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1", [guildId]);
        const newState = !(res.rows[0]?.antinuke_enabled);
        await db.query(`INSERT INTO guild_backups (guildid, antinuke_enabled) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET antinuke_enabled = $2`, [guildId, newState]);
        guildCache.flush(guildId);
        interaction.customId = 'setup_antinuke';
        return module.exports(interaction);
    }
};