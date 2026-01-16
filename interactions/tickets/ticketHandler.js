const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType, 
    PermissionsBitField,
    MessageFlags 
} = require('discord.js');
const { error, success } = require('../../utils/embedFactory.js');

async function handleTicketOpen(interaction, client) {
    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }
    } catch (err) {
        if (err.code === 10062) return; 
        console.error("Error deferring ticket open:", err);
        return;
    }

    const { customId, user, guild } = interaction;
    const db = client.db;
    
    const panelId = customId.replace('ticket_open_', '');

    const res = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guild.id, panelId]);
    if (res.rows.length === 0) {
        return interaction.editReply({ embeds: [error('Configuration Error: This ticket panel no longer exists in the database.')] }).catch(() => {});
    }
    const panel = res.rows[0];

    if (panel.blacklist_role_id && interaction.member.roles.cache.has(panel.blacklist_role_id)) {
        return interaction.editReply({ embeds: [error('⛔ You are blacklisted from creating tickets.')] }).catch(() => {});
    }

    const openTickets = await db.query("SELECT * FROM tickets WHERE user_id = $1 AND panel_id = $2 AND status = 'OPEN'", [user.id, panelId]);
    
    let realOpenCount = 0;
    
    for (const ticket of openTickets.rows) {
        const channelExists = guild.channels.cache.get(ticket.channel_id);
        
        if (!channelExists) {
            await db.query("UPDATE tickets SET status = 'CLOSED', close_reason = 'Channel manually deleted' WHERE channel_id = $1", [ticket.channel_id]);
        } else {
            realOpenCount++;
        }
    }

    const limit = panel.ticket_limit || 1;
    
    if (realOpenCount >= limit) {
        return interaction.editReply({ embeds: [error(`⚠️ You have reached the limit of **${limit}** open ticket(s) for this panel.`)] }).catch(() => {});
    }

    if (guild.channels.cache.size >= 495) {
        return interaction.editReply({ embeds: [error('⚠️ Server Error: Maximum channel limit reached.')] }).catch(() => {});
    }

    let category = guild.channels.cache.get(panel.ticket_category_id);
    if (category && category.children.cache.size >= 50) {
        return interaction.editReply({ embeds: [error('⚠️ System Error: The Ticket Category is full.')] }).catch(() => {});
    }

    try {
        const cleanName = user.username.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10);
        const ticketName = `ticket-${cleanName}`;

        const permissionOverwrites = [
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] },
            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageMessages] }
        ];

        if (panel.support_role_id) {
            permissionOverwrites.push({
                id: panel.support_role_id,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages]
            });
        }

        const ticketChannel = await guild.channels.create({
            name: ticketName,
            type: ChannelType.GuildText,
            parent: panel.ticket_category_id || null,
            permissionOverwrites: permissionOverwrites,
            topic: `Ticket opened by ${user.tag} | Panel: ${panel.title}`,
        });

        const welcomeEmbed = new EmbedBuilder()
            .setTitle(`${panel.button_emoji} ${panel.title}`)
            .setDescription(panel.welcome_message.replace('{user}', `<@${user.id}>`))
            .setColor(0x5865F2)
            .setFooter({ text: 'To close this ticket, click the button below.' })
            .setTimestamp();

        const closeBtn = new ButtonBuilder().setCustomId('ticket_action_close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒');
        const claimBtn = new ButtonBuilder().setCustomId('ticket_action_claim').setLabel('Claim Ticket').setStyle(ButtonStyle.Secondary).setEmoji('🙋‍♂️');

        await ticketChannel.send({ 
            content: panel.support_role_id ? `<@&${panel.support_role_id}>` : null, 
            embeds: [welcomeEmbed], 
            components: [new ActionRowBuilder().addComponents(closeBtn, claimBtn)] 
        });

        const now = Date.now();
        await db.query(`
            INSERT INTO tickets (guild_id, channel_id, user_id, panel_id, status, created_at)
            VALUES ($1, $2, $3, $4, 'OPEN', $5)
        `, [guild.id, ticketChannel.id, user.id, panelId, now]);
        
        await interaction.editReply({ 
            embeds: [success(`Ticket created successfully! Go to ${ticketChannel}`)], 
            components: [] 
        }).catch(() => {});

    } catch (err) {
        console.error("Ticket Creation Error:", err);
        if (!interaction.replied) {
            await interaction.editReply({ embeds: [error(`Failed to create ticket channel.\nError: ${err.message}`)] }).catch(() => {});
        }
    }
}

module.exports = { handleTicketOpen };