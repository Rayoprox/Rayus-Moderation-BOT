const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, StringSelectMenuBuilder } = require('discord.js');
const db = require('../../../utils/db.js');
const { success } = require('../../../utils/embedFactory.js');
const { safeDefer } = require('../../../utils/interactionHelpers.js');

module.exports = async (interaction) => {
    const { customId, guild, values } = interaction;
    const guildId = guild.id;

    if (customId === 'setup_channels') {
        if (!await safeDefer(interaction, true)) return;

        const res = await db.query("SELECT log_type, channel_id FROM log_channels WHERE guildid = $1", [guildId]);
        const channels = {}; res.rows.forEach(r => channels[r.log_type] = r.channel_id);
        const format = (type) => channels[type] ? `<#${channels[type]}>` : '`Not Set`';

        const embed = new EmbedBuilder()
            .setTitle('📺 Log Channels Configuration')
            .setDescription('Set channels for different logs.')
            .addFields(
                { name: '🔨 Mod Logs', value: format('modlog'), inline: true },
                { name: '💻 Command Logs', value: format('cmdlog'), inline: true },
                { name: '📝 Ban Appeals', value: format('banappeal'), inline: true },
                { name: '☢️ Anti-Nuke', value: format('antinuke'), inline: true }
            )
            .setColor('#3498DB');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_channels_edit').setLabel('Edit Channel').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('setup_home').setLabel('Back').setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
        return;
    }

    if (customId === 'setup_channels_edit') {
        if (!await safeDefer(interaction, true)) return;
        
        const options = [
            { label: 'Mod Logs', value: 'modlog' },
            { label: 'Command Logs', value: 'cmdlog' },
            { label: 'Ban Appeals', value: 'banappeal' },
            { label: 'Anti-Nuke Logs', value: 'antinuke' }
        ];

        const menu = new StringSelectMenuBuilder()
            .setCustomId('setup_channels_select_type')
            .setPlaceholder('Select log type...')
            .addOptions(options);

        const back = new ButtonBuilder().setCustomId('setup_channels').setLabel('Back').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ 
            embeds: [new EmbedBuilder().setTitle('Select Log Type to Edit')], 
            components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(back)] 
        });
        return;
    }

    if (interaction.isStringSelectMenu() && customId === 'setup_channels_select_type') {
        if (!await safeDefer(interaction, true)) return;
        const logType = values[0];
        
        const menu = new ChannelSelectMenuBuilder()
            .setCustomId(`setup_channels_set_${logType}`)
            .setPlaceholder(`Select channel for ${logType}`)
            .addChannelTypes(ChannelType.GuildText);

        const back = new ButtonBuilder().setCustomId('setup_channels_edit').setLabel('Back').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ 
            embeds: [new EmbedBuilder().setTitle(`Set Channel for: ${logType}`)], 
            components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(back)] 
        });
        return;
    }

   
    if (interaction.isChannelSelectMenu() && customId.startsWith('setup_channels_set_')) {
        if (!await safeDefer(interaction, true)) return;
        
        const logType = customId.replace('setup_channels_set_', '');
        
        await db.query("INSERT INTO log_channels (guildid, log_type, channel_id) VALUES ($1, $2, $3) ON CONFLICT (guildid, log_type) DO UPDATE SET channel_id = $3", [guildId, logType, values[0]]);
        
        const back = new ButtonBuilder().setCustomId('setup_channels').setLabel('Back to Channels').setStyle(ButtonStyle.Primary);
        
        await interaction.editReply({ 
            embeds: [success(`${logType} channel updated to <#${values[0]}>`)], 
            components: [new ActionRowBuilder().addComponents(back)] 
        });
        return;
    }
};