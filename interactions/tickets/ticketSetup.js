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
    TextInputStyle 
} = require('discord.js');
const { safeDefer } = require('../../utils/interactionHelpers.js');
const { success, error } = require('../../utils/embedFactory.js');


async function showPanelDashboard(interaction, db, guildId, panelId, isNew = false) {
    const res = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, panelId]);
    if (res.rows.length === 0) return interaction.editReply({ embeds: [error('Panel not found.')] });
    const p = res.rows[0];

    const embed = new EmbedBuilder()
        .setTitle(`⚙️ Configure Panel: ${p.title}`)
        .setDescription(`**ID:** \`${p.panel_id}\`\n\nUse the buttons below to customize every aspect of this ticket panel.`)
        .addFields(
            { name: '🎨 Appearance', value: `Title: ${p.title}\nButton: ${p.button_emoji} ${p.button_label} (${p.button_style})`, inline: true },
            { name: '👥 Roles', value: `Support: ${p.support_role_id ? `<@&${p.support_role_id}>` : '`None`'}\nBlacklist: ${p.blacklist_role_id ? `<@&${p.blacklist_role_id}>` : '`None`'}`, inline: true },
            { name: '⚙️ General', value: `Category: ${p.ticket_category_id ? `<#${p.ticket_category_id}>` : '`None`'}\nLogs: ${p.log_channel_id ? `<#${p.log_channel_id}>` : '`None`'}`, inline: false }
        )
        .setColor('#2B2D31');

    if (isNew) embed.setDescription(`✅ **Panel Created!**\nNow configure the details below.\n\n**ID:** \`${p.panel_id}\``);

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tkt_embed_${panelId}`).setLabel('Embed & Msg').setStyle(ButtonStyle.Primary).setEmoji('🎨'),
        new ButtonBuilder().setCustomId(`tkt_roles_${panelId}`).setLabel('Roles').setStyle(ButtonStyle.Primary).setEmoji('👥'),
        new ButtonBuilder().setCustomId(`tkt_btn_${panelId}`).setLabel('Button Style').setStyle(ButtonStyle.Primary).setEmoji('🔘'),
        new ButtonBuilder().setCustomId(`tkt_gen_${panelId}`).setLabel('General').setStyle(ButtonStyle.Primary).setEmoji('⚙️')
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tkt_preview_${panelId}`).setLabel('Send/Preview Panel').setStyle(ButtonStyle.Success).setEmoji('📨'),
        new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Back to List').setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

module.exports = async (interaction) => {
    const { customId, guild, client, values, fields } = interaction;
    const db = client.db;
    const guildId = guild.id;

   
    if (customId === 'setup_tickets_menu') {
        if (!await safeDefer(interaction, true)) return;

        const panels = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 ORDER BY id ASC', [guildId]);
        
        const embed = new EmbedBuilder()
            .setTitle('🎫 Ticket System Configuration')
            .setDescription(`Manage your support ticket panels here.\n\n**Current Panels:**\n${panels.rows.length > 0 ? panels.rows.map(p => `• **${p.title}** (ID: \`${p.panel_id}\`)`).join('\n') : '_No panels created yet._'}`)
            .setColor('#5865F2')
            .setFooter({ text: 'You can have multiple panels for different purposes.' });

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket_panel_create').setLabel('Create New Panel').setStyle(ButtonStyle.Success).setEmoji('➕'),
            new ButtonBuilder().setCustomId('ticket_panel_edit_select').setLabel('Edit Panel').setStyle(ButtonStyle.Primary).setEmoji('✏️').setDisabled(panels.rows.length === 0),
            new ButtonBuilder().setCustomId('ticket_panel_delete_select').setLabel('Delete Panel').setStyle(ButtonStyle.Danger).setEmoji('🗑️').setDisabled(panels.rows.length === 0),
            new ButtonBuilder().setCustomId('setup_home').setLabel('Back to Setup').setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ embeds: [embed], components: [buttons] });
        return;
    }

   
    if (customId === 'ticket_panel_create') {
        const modal = new ModalBuilder().setCustomId('ticket_panel_create_modal').setTitle('Create Ticket Panel');
        const idInput = new TextInputBuilder().setCustomId('panel_unique_id').setLabel("Panel ID (Unique, e.g., 'support')").setStyle(TextInputStyle.Short).setPlaceholder('support').setRequired(true).setMaxLength(20);
        const titleInput = new TextInputBuilder().setCustomId('panel_title').setLabel("Embed Title").setStyle(TextInputStyle.Short).setPlaceholder('Support Tickets').setRequired(true).setMaxLength(100);

        modal.addComponents(new ActionRowBuilder().addComponents(idInput), new ActionRowBuilder().addComponents(titleInput));
        await interaction.showModal(modal);
        return;
    }


    if (customId === 'ticket_panel_create_modal') {
        if (!await safeDefer(interaction, true)) return;

        const panelId = fields.getTextInputValue('panel_unique_id').toLowerCase().replace(/[^a-z0-9-_]/g, '');
        const title = fields.getTextInputValue('panel_title');

        const check = await db.query('SELECT id FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, panelId]);
        if (check.rows.length > 0) return interaction.editReply({ embeds: [error(`A panel with ID \`${panelId}\` already exists. Please choose a unique ID.`)] });

        await db.query(`INSERT INTO ticket_panels (guild_id, panel_id, title) VALUES ($1, $2, $3)`, [guildId, panelId, title]);
        return showPanelDashboard(interaction, db, guildId, panelId, true);
    }

   
    if (customId === 'ticket_panel_edit_select') {
        if (!await safeDefer(interaction, true)) return;
        const panels = await db.query('SELECT panel_id, title FROM ticket_panels WHERE guild_id = $1', [guildId]);
        
        const menu = new StringSelectMenuBuilder()
            .setCustomId('ticket_panel_select_action')
            .setPlaceholder('Select a panel to configure...')
            .addOptions(panels.rows.map(p => ({ label: p.title, value: p.panel_id, description: `ID: ${p.panel_id}` })));

        const backBtn = new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Back').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✏️ Edit Panel').setDescription('Select the panel you wish to configure.')], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backBtn)] });
        return;
    }

    if (interaction.isStringSelectMenu() && customId === 'ticket_panel_select_action') {
        if (!await safeDefer(interaction, true)) return;
        return showPanelDashboard(interaction, db, guildId, values[0]);
    }

    if (customId.startsWith('tkt_embed_') && !customId.startsWith('tkt_embed_save_')) {
        const panelId = customId.replace('tkt_embed_', '');
        const res = await db.query('SELECT title, description, welcome_message, banner_url FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, panelId]);
        const p = res.rows[0];

        const modal = new ModalBuilder().setCustomId(`tkt_embed_save_${panelId}`).setTitle('Edit Panel Appearance');
        const titleInput = new TextInputBuilder().setCustomId('e_title').setLabel("Panel Title").setStyle(TextInputStyle.Short).setValue(p.title).setRequired(true).setMaxLength(256);
        const descInput = new TextInputBuilder().setCustomId('e_desc').setLabel("Panel Description").setStyle(TextInputStyle.Paragraph).setValue(p.description || '').setRequired(true).setMaxLength(2000);
        const welcomeInput = new TextInputBuilder().setCustomId('e_welcome').setLabel("Ticket Welcome Message").setStyle(TextInputStyle.Paragraph).setValue(p.welcome_message || '').setPlaceholder('Hello {user}, wait for staff...').setRequired(true).setMaxLength(1000);
        const bannerInput = new TextInputBuilder().setCustomId('e_banner').setLabel("Banner URL (Optional)").setStyle(TextInputStyle.Short).setValue(p.banner_url || '').setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(titleInput), new ActionRowBuilder().addComponents(descInput), new ActionRowBuilder().addComponents(welcomeInput), new ActionRowBuilder().addComponents(bannerInput));
        await interaction.showModal(modal);
        return;
    }

    if (customId.startsWith('tkt_embed_save_')) {
        if (!await safeDefer(interaction, true)) return;
        const panelId = customId.replace('tkt_embed_save_', '');
        await db.query(`UPDATE ticket_panels SET title = $1, description = $2, welcome_message = $3, banner_url = $4 WHERE guild_id = $5 AND panel_id = $6`, [fields.getTextInputValue('e_title'), fields.getTextInputValue('e_desc'), fields.getTextInputValue('e_welcome'), fields.getTextInputValue('e_banner') || null, guildId, panelId]);
        return showPanelDashboard(interaction, db, guildId, panelId);
    }

    if (customId.startsWith('tkt_roles_')) {
        if (!await safeDefer(interaction, true)) return;
        const panelId = customId.replace('tkt_roles_', '');

        const supportMenu = new RoleSelectMenuBuilder().setCustomId(`tkt_role_support_${panelId}`).setPlaceholder('Select Support Role (Staff)').setMinValues(0).setMaxValues(1);
        const blacklistMenu = new RoleSelectMenuBuilder().setCustomId(`tkt_role_blacklist_${panelId}`).setPlaceholder('Select Blacklist Role (Banned)').setMinValues(0).setMaxValues(1);
        const dashboardBtn = new ButtonBuilder().setCustomId(`tkt_back_${panelId}`).setLabel('Back to Dashboard').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('👥 Roles Configuration').setDescription('Configure who can manage tickets and who is blocked.').setColor('#F1C40F')], components: [new ActionRowBuilder().addComponents(supportMenu), new ActionRowBuilder().addComponents(blacklistMenu), new ActionRowBuilder().addComponents(dashboardBtn)] });
        return;
    }

    if (interaction.isRoleSelectMenu() && customId.startsWith('tkt_role_')) {
        await safeDefer(interaction, true);
        const isSupport = customId.includes('_support_');
        const panelId = customId.replace(isSupport ? 'tkt_role_support_' : 'tkt_role_blacklist_', ''); 
        
        const roleId = values[0] || null;
        const col = isSupport ? 'support_role_id' : 'blacklist_role_id';
        await db.query(`UPDATE ticket_panels SET ${col} = $1 WHERE guild_id = $2 AND panel_id = $3`, [roleId, guildId, panelId]);
        await interaction.editReply({ content: `✅ **${isSupport ? 'Support' : 'Blacklist'} Role** updated!` });
        return showPanelDashboard(interaction, db, guildId, panelId);
    }

    
    if (customId.startsWith('tkt_btn_label_')) {
        const panelId = customId.replace('tkt_btn_label_', '');
        const res = await db.query('SELECT button_label, button_emoji FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, panelId]);
        const p = res.rows[0];

        const modal = new ModalBuilder().setCustomId(`tkt_btn_save_text_${panelId}`).setTitle('Edit Button Text');
        const labelIn = new TextInputBuilder().setCustomId('b_label').setLabel('Button Label').setValue(p.button_label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80);
        const emojiIn = new TextInputBuilder().setCustomId('b_emoji').setLabel('Button Emoji (Paste valid emoji)').setValue(p.button_emoji).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20);

        modal.addComponents(new ActionRowBuilder().addComponents(labelIn), new ActionRowBuilder().addComponents(emojiIn));
        await interaction.showModal(modal);
        return;
    }

    if (customId.startsWith('tkt_btn_save_text_')) {
        if (!await safeDefer(interaction, true)) return;
        const panelId = customId.replace('tkt_btn_save_text_', '');
        await db.query(`UPDATE ticket_panels SET button_label = $1, button_emoji = $2 WHERE guild_id = $3 AND panel_id = $4`, [fields.getTextInputValue('b_label'), fields.getTextInputValue('b_emoji'), guildId, panelId]);
        return showPanelDashboard(interaction, db, guildId, panelId);
    }

    if (customId.startsWith('tkt_btn_') && !customId.startsWith('tkt_btn_label_') && !customId.startsWith('tkt_btn_save_') && !customId.startsWith('tkt_btn_style_')) {
        if (!await safeDefer(interaction, true)) return;
        const panelId = customId.replace('tkt_btn_', '');

        const styleMenu = new StringSelectMenuBuilder().setCustomId(`tkt_btn_style_save_${panelId}`).setPlaceholder('Select Button Color/Style').addOptions([{ label: 'Primary (Blue)', value: 'Primary', emoji: '🔵' }, { label: 'Secondary (Gray)', value: 'Secondary', emoji: '🔘' }, { label: 'Success (Green)', value: 'Success', emoji: '🟢' }, { label: 'Danger (Red)', value: 'Danger', emoji: '🔴' }]);
        const editLabelBtn = new ButtonBuilder().setCustomId(`tkt_btn_label_${panelId}`).setLabel('Edit Label & Emoji').setStyle(ButtonStyle.Primary).setEmoji('📝');
        const dashboardBtn = new ButtonBuilder().setCustomId(`tkt_back_${panelId}`).setLabel('Back').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🔘 Button Configuration').setDescription('Customize how the "Open Ticket" button looks.').setColor('#5865F2')], components: [new ActionRowBuilder().addComponents(styleMenu), new ActionRowBuilder().addComponents(editLabelBtn, dashboardBtn)] });
        return;
    }

    if (interaction.isStringSelectMenu() && customId.startsWith('tkt_btn_style_save_')) {
        await safeDefer(interaction, true);
        const panelId = customId.replace('tkt_btn_style_save_', '');
        await db.query(`UPDATE ticket_panels SET button_style = $1 WHERE guild_id = $2 AND panel_id = $3`, [values[0], guildId, panelId]);
        return showPanelDashboard(interaction, db, guildId, panelId);
    }


    if (customId.startsWith('tkt_gen_') && !customId.includes('_cat_') && !customId.includes('_log_')) {
        if (!await safeDefer(interaction, true)) return;
        const panelId = customId.replace('tkt_gen_', '');

        const catMenu = new ChannelSelectMenuBuilder().setCustomId(`tkt_gen_cat_${panelId}`).setPlaceholder('Select Ticket Category').setChannelTypes([ChannelType.GuildCategory]);
        const logMenu = new ChannelSelectMenuBuilder().setCustomId(`tkt_gen_log_${panelId}`).setPlaceholder('Select Log Channel').setChannelTypes([ChannelType.GuildText]);
        const dashboardBtn = new ButtonBuilder().setCustomId(`tkt_back_${panelId}`).setLabel('Back').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('⚙️ General Settings').setDescription('Set where the tickets will be created and where logs will be sent.').setColor('#95A5A6')], components: [new ActionRowBuilder().addComponents(catMenu), new ActionRowBuilder().addComponents(logMenu), new ActionRowBuilder().addComponents(dashboardBtn)] });
        return;
    }

    if (interaction.isChannelSelectMenu() && customId.startsWith('tkt_gen_')) {
        await safeDefer(interaction, true);
        const isCat = customId.includes('_cat_');
        const panelId = customId.replace(isCat ? 'tkt_gen_cat_' : 'tkt_gen_log_', '');
        const col = isCat ? 'ticket_category_id' : 'log_channel_id';
        await db.query(`UPDATE ticket_panels SET ${col} = $1 WHERE guild_id = $2 AND panel_id = $3`, [values[0], guildId, panelId]);
        return showPanelDashboard(interaction, db, guildId, panelId);
    }

    if (customId.startsWith('tkt_preview_')) {
        if (!await safeDefer(interaction, true)) return;
        const panelId = customId.replace('tkt_preview_', '');
        const channelMenu = new ChannelSelectMenuBuilder().setCustomId(`tkt_send_final_${panelId}`).setPlaceholder('Select channel to send the Panel').setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
        const cancelBtn = new ButtonBuilder().setCustomId(`tkt_back_${panelId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('📨 Deploy Ticket Panel').setDescription('Where do you want to send this Ticket Panel?').setColor('#2ECC71')], components: [new ActionRowBuilder().addComponents(channelMenu), new ActionRowBuilder().addComponents(cancelBtn)] });
        return;
    }

    if (customId.startsWith('tkt_send_final_')) {
        if (!await safeDefer(interaction, true)) return;
        const panelId = customId.replace('tkt_send_final_', '');
        const targetChannel = guild.channels.cache.get(values[0]);
        if (!targetChannel) return interaction.editReply({ embeds: [error("Channel not found.")] });

        const res = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, panelId]);
        const p = res.rows[0];

        const panelEmbed = new EmbedBuilder()
            .setTitle(p.title)
            .setDescription(p.description)
            .setColor(p.button_style === 'Danger' ? 0xE74C3C : p.button_style === 'Success' ? 0x2ECC71 : 0x5865F2)
            .setFooter({ text: 'Powered by Universal Piece System' });
        
        if (p.banner_url) panelEmbed.setImage(p.banner_url);

        const openBtn = new ButtonBuilder().setCustomId(`ticket_open_${panelId}`).setLabel(p.button_label).setEmoji(p.button_emoji).setStyle(ButtonStyle[p.button_style]);

        try {
            await targetChannel.send({ embeds: [panelEmbed], components: [new ActionRowBuilder().addComponents(openBtn)] });
            await interaction.editReply({ embeds: [success(`Panel **${p.title}** sent to ${targetChannel} successfully!`)], components: [] });
        } catch (err) {
            await interaction.editReply({ embeds: [error(`Failed to send panel. Check my permissions in ${targetChannel}.\nError: ${err.message}`)] });
        }
        return;
    }

    if (customId.startsWith('tkt_back_')) {
        if (!await safeDefer(interaction, true)) return;
        return showPanelDashboard(interaction, db, guildId, customId.replace('tkt_back_', ''));
    }

    if (customId === 'ticket_panel_delete_select') {
        if (!await safeDefer(interaction, true)) return;
        const panels = await db.query('SELECT panel_id, title FROM ticket_panels WHERE guild_id = $1', [guildId]);
        if (panels.rows.length === 0) return interaction.editReply({ embeds: [error('No panels to delete.')], components: []});

        const menu = new StringSelectMenuBuilder().setCustomId('ticket_panel_delete_confirm').setPlaceholder('Select panel to DELETE permanently...').addOptions(panels.rows.map(p => ({ label: p.title, value: p.panel_id, emoji: '🗑️' })));
        const backBtn = new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Cancel').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🗑️ Delete Panel').setDescription('Warning: This action cannot be undone.').setColor('#E74C3C')], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backBtn)] });
        return;
    }

    if (interaction.isStringSelectMenu() && customId === 'ticket_panel_delete_confirm') {
        if (!await safeDefer(interaction, true)) return;
        const panelId = values[0];
        await db.query('DELETE FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, panelId]);
        const backBtn = new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Return to Menu').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [success(`Ticket Panel \`${panelId}\` has been deleted.`)], components: [new ActionRowBuilder().addComponents(backBtn)] });
        return;
    }
};