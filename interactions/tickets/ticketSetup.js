const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder, 
    RoleSelectMenuBuilder, 
    ChannelSelectMenuBuilder, 
    ChannelType, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    MessageFlags
} = require('discord.js');
const { safeDefer, smartReply } = require('../../utils/interactionHelpers.js');
const { success, error } = require('../../utils/embedFactory.js');

async function showPanelDashboard(interaction, db, guildId, panelId, isNew = false) {
    const res = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, panelId]);
    if (res.rows.length === 0) return await smartReply(interaction, { embeds: [error('Panel not found in database.')] }, true);
    
    const p = res.rows[0];

    const embed = new EmbedBuilder()
        .setTitle(`⚙️ Configure Panel: ${p.title}`)
        .setDescription(`**Panel ID:** \`${p.panel_id}\`\n\nConfigure the appearance, roles, and destination for this support system.`)
        .addFields(
            { name: '🎨 Appearance', value: `Title: ${p.title}\nButton: ${p.button_emoji} ${p.button_label} (${p.button_style})`, inline: true },
            { name: '👥 Roles', value: `Support: ${p.support_role_id ? `<@&${p.support_role_id}>` : '`None`'}\nBlacklist: ${p.blacklist_role_id ? `<@&${p.blacklist_role_id}>` : '`None`'}`, inline: true },
            { name: '📍 Destination', value: `Category: ${p.ticket_category_id ? `<#${p.ticket_category_id}>` : '`None`'}\nLogs: ${p.log_channel_id ? `<#${p.log_channel_id}>` : '`None`'}`, inline: true },
            { name: '📝 Messages', value: `Welcome: \`${p.welcome_message.slice(0, 50)}...\``, inline: false }
        )
        .setColor('#5865F2')
        .setFooter({ text: 'Made by: ukirama' });

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ticket_panel_edit_appearance_${p.panel_id}`).setLabel('Appearance').setStyle(ButtonStyle.Primary).setEmoji('🎨'),
        new ButtonBuilder().setCustomId(`ticket_panel_edit_roles_${p.panel_id}`).setLabel('Roles').setStyle(ButtonStyle.Primary).setEmoji('👥'),
        new ButtonBuilder().setCustomId(`ticket_panel_edit_channels_${p.panel_id}`).setLabel('Channels').setStyle(ButtonStyle.Primary).setEmoji('📍')
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ticket_panel_edit_message_${p.panel_id}`).setLabel('Welcome Msg').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
        new ButtonBuilder().setCustomId(`ticket_panel_send_${p.panel_id}`).setLabel('Post Panel').setStyle(ButtonStyle.Success).setEmoji('📤'),
        new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Back').setStyle(ButtonStyle.Secondary)
    );

    return await smartReply(interaction, { embeds: [embed], components: [row1, row2] });
}

module.exports = async (interaction) => {
    const { customId, guild, values, client } = interaction;
    const db = client.db;
    const guildId = guild.id;

    if (customId === 'setup_tickets_menu') {
        if (!await safeDefer(interaction, true)) return;
        
        const panels = await db.query('SELECT panel_id, title FROM ticket_panels WHERE guild_id = $1', [guildId]);
        
        const embed = new EmbedBuilder()
            .setTitle('🎫 Ticket System Configuration')
            .setDescription('Manage your existing ticket panels or create a new one.')
            .setColor('#5865F2')
            .setFooter({ text: 'Made by: ukirama' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket_panel_create_modal').setLabel('Create New Panel').setStyle(ButtonStyle.Success).setEmoji('➕'),
            new ButtonBuilder().setCustomId('ticket_panel_delete_menu').setLabel('Delete Panel').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
            new ButtonBuilder().setCustomId('setup_home').setLabel('Back to Setup').setStyle(ButtonStyle.Secondary)
        );

        if (panels.rows.length > 0) {
            const menu = new StringSelectMenuBuilder()
                .setCustomId('ticket_panel_select')
                .setPlaceholder('Select a panel to edit...')
                .addOptions(panels.rows.map(p => ({ label: p.title, value: p.panel_id, emoji: '🎫' })));
            
            return await smartReply(interaction, { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), row] });
        }

        return await smartReply(interaction, { embeds: [embed], components: [row] });
    }

    if (customId === 'ticket_panel_create_modal') {
        const modal = new ModalBuilder().setCustomId('ticket_modal_submit_create').setTitle('New Ticket Panel');
        const idInput = new TextInputBuilder().setCustomId('panel_id').setLabel("Internal ID (Unique)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20);
        const titleInput = new TextInputBuilder().setCustomId('panel_title').setLabel("Panel Title").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50);
        
        modal.addComponents(
            new ActionRowBuilder().addComponents(idInput),
            new ActionRowBuilder().addComponents(titleInput)
        );
        return await interaction.showModal(modal);
    }

    if (customId === 'ticket_modal_submit_create') {
        await safeDefer(interaction, false, true);
        const pId = interaction.fields.getTextInputValue('panel_id').toLowerCase().replace(/\s+/g, '_');
        const pTitle = interaction.fields.getTextInputValue('panel_title');

        await db.query(`
            INSERT INTO ticket_panels (guild_id, panel_id, title, button_label, welcome_message)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (guild_id, panel_id) DO NOTHING
        `, [guildId, pId, pTitle, 'Open Ticket', 'Welcome {user}, how can we help you?']);

        return await showPanelDashboard(interaction, db, guildId, pId, true);
    }

    if (customId === 'ticket_panel_select') {
        if (!await safeDefer(interaction, true)) return;
        return await showPanelDashboard(interaction, db, guildId, values[0]);
    }

    if (customId === 'ticket_panel_delete_menu') {
        if (!await safeDefer(interaction, true)) return;
        const panels = await db.query('SELECT panel_id, title FROM ticket_panels WHERE guild_id = $1', [guildId]);
        
        if (panels.rows.length === 0) return await smartReply(interaction, { embeds: [error('No panels available to delete.')] }, true);

        const menu = new StringSelectMenuBuilder()
            .setCustomId('ticket_panel_delete_confirm')
            .setPlaceholder('Select panel to delete permanently...')
            .addOptions(panels.rows.map(p => ({ label: p.title, value: p.panel_id, emoji: '🗑️' })));

        return await smartReply(interaction, { 
            embeds: [new EmbedBuilder().setTitle('🗑️ Delete Ticket Panel').setDescription('Warning: This action is permanent. All settings for this panel will be erased.').setColor('#E74C3C')], 
            components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Cancel').setStyle(ButtonStyle.Secondary))] 
        });
    }

    if (customId === 'ticket_panel_delete_confirm') {
        await safeDefer(interaction, true);
        const panelId = values[0];
        await db.query('DELETE FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, panelId]);
        return await smartReply(interaction, { embeds: [success(`Panel \`${panelId}\` has been deleted.`)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Return to Menu').setStyle(ButtonStyle.Primary))] });
    }

    if (customId.startsWith('ticket_panel_send_')) {
        await safeDefer(interaction, true);
        const pId = customId.split('_')[3];
        const res = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, pId]);
        const p = res.rows[0];

        const panelEmbed = new EmbedBuilder()
            .setTitle(p.title)
            .setDescription(`Click the button below to start a support ticket.`)
            .setColor('#5865F2')
            .setFooter({ text: 'Made by: ukirama' });

        const button = new ButtonBuilder()
            .setCustomId(`ticket_open_${p.panel_id}`)
            .setLabel(p.button_label)
            .setStyle(ButtonStyle[p.button_style] || ButtonStyle.Primary)
            .setEmoji(p.button_emoji || '🎫');

        await interaction.channel.send({ embeds: [panelEmbed], components: [new ActionRowBuilder().addComponents(button)] });
        return await smartReply(interaction, { embeds: [success('Ticket panel has been posted in this channel.')] }, true);
    }
};