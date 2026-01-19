const { 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, 
    TextInputBuilder, TextInputStyle, PermissionsBitField 
} = require('discord.js');
const discordTranscripts = require('discord-html-transcripts');
const { error, success } = require('../../utils/embedFactory.js');
const { smartReply } = require('../../utils/interactionHelpers.js');


async function findSystemMessage(channel, client) {
    try {
        const messages = await channel.messages.fetch({ limit: 50 });
        
        return messages.find(m => m.author.id === client.user.id && m.components.length > 0);
    } catch (e) {
        return null;
    }
}

async function closeTicket(interaction, client, db, reason = 'No reason provided') {
    const { channel, guild, user, member } = interaction;

    const ticketRes = await db.query('SELECT * FROM tickets WHERE channel_id = $1', [channel.id]);
    if (ticketRes.rows.length === 0) return channel.delete().catch(() => {});
    const ticket = ticketRes.rows[0];

    if (ticket.user_id === user.id && !member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const panelRes = await db.query('SELECT support_role_id FROM ticket_panels WHERE panel_id = $1', [ticket.panel_id]);
        const supportRole = panelRes.rows[0]?.support_role_id;
        
        const isStaff = supportRole && member.roles.cache.has(supportRole);
        if (!isStaff) {
             return await smartReply(interaction, { embeds: [error('⛔ **Access Denied:** Please wait for a Staff member to close this ticket.')] }, true);
        }
    }

    await channel.permissionOverwrites.set([
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageMessages] }
    ]);

    try {
      
        const transcript = await discordTranscripts.createTranscript(channel, {
            limit: -1, returnType: 'attachment', filename: `transcript-${channel.name}.html`, saveImages: true, poweredBy: false
        });

        
        const closeTime = Date.now();
        const durationText = `${Math.floor((closeTime - Number(ticket.created_at)) / 3600000)}h ${Math.floor(((closeTime - Number(ticket.created_at)) % 3600000) / 60000)}m`;

        const logEmbed = new EmbedBuilder()
            .setTitle('🎫 Ticket Closed')
            .setColor('#FF4B4B')
            .addFields(
                { name: 'Author', value: `<@${ticket.user_id}>`, inline: true },
                { name: 'Closed By', value: `<@${user.id}>`, inline: true },
                { name: 'Reason', value: `\`${reason}\``, inline: false },
                { name: 'Duration', value: `\`${durationText}\``, inline: true }
            )
            .setFooter({ text: `Ticket ID: ${channel.id}` }).setTimestamp();

        const panelRes = await db.query('SELECT log_channel_id FROM ticket_panels WHERE panel_id = $1', [ticket.panel_id]);
        if (panelRes.rows[0]?.log_channel_id) {
            const logCh = guild.channels.cache.get(panelRes.rows[0].log_channel_id);
            if (logCh) await logCh.send({ embeds: [logEmbed], files: [transcript] });
        }

        const authorUser = await client.users.fetch(ticket.user_id).catch(() => null);
        if (authorUser) {
            await authorUser.send({ 
                embeds: [new EmbedBuilder().setTitle('Ticket Closed').setDescription(`Your ticket in **${guild.name}** has been closed.`).addFields({name:'Reason', value: reason}).setColor('#5865F2')], 
                files: [transcript] 
            }).catch(() => {});
        }

        await db.query("UPDATE tickets SET status = 'CLOSED', closed_at = $1, closed_by = $2, close_reason = $3 WHERE channel_id = $4", [closeTime, user.id, reason, channel.id]);
        await channel.delete().catch(() => {});

    } catch (err) {
        console.error(err);
        await channel.delete().catch(() => {});
    }
}

async function claimTicket(interaction, client, db) {
    const { channel, user, guild, member } = interaction;

    const ticketRes = await db.query('SELECT * FROM tickets WHERE channel_id = $1', [channel.id]);
    const ticket = ticketRes.rows[0];
    const panelRes = await db.query('SELECT support_role_id FROM ticket_panels WHERE panel_id = $1', [ticket.panel_id]);
    const supportRoleId = panelRes.rows[0]?.support_role_id;

    const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
    const isSupport = supportRoleId && member.roles.cache.has(supportRoleId);

    if (ticket.user_id === user.id && !isSupport && !isAdmin) {
        return await smartReply(interaction, { embeds: [error('⛔ You cannot claim your own ticket.')] }, true);
    }

    if (!isSupport && !isAdmin) {
        return await smartReply(interaction, { embeds: [error('⛔ Only Support Staff can claim tickets.')] }, true);
    }

    if (ticket.participants && ticket.participants !== user.id && !isAdmin) {
        return await smartReply(interaction, { embeds: [error(`⛔ This ticket is already claimed by <@${ticket.participants}>.`)] }, true);
    }


    await db.query('UPDATE tickets SET participants = $1 WHERE channel_id = $2', [user.id, channel.id]);

   
    if (supportRoleId) {
        await channel.permissionOverwrites.edit(supportRoleId, { ViewChannel: true, SendMessages: false });
    }
    await channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, AttachFiles: true });

    const targetMsg = interaction.message || await findSystemMessage(channel, client);
    if (targetMsg) {
        const rows = targetMsg.components.map(row => {
            const newRow = ActionRowBuilder.from(row);
            newRow.components.forEach(c => {
                if (c.data.custom_id === 'ticket_action_claim') {
                    c.setCustomId('ticket_action_unclaim')
                     .setLabel('Unclaim Ticket')
                     .setStyle(ButtonStyle.Danger) // Rojo
                     .setEmoji('🔓');
                }
            });
            return newRow;
        });
        
        if (interaction.isButton && interaction.message) await interaction.update({ components: rows });
        else await targetMsg.edit({ components: rows });
    }

    if (!interaction.isButton || !interaction.message) {
        await smartReply(interaction, { embeds: [success(`**${user.tag}** has claimed this ticket.\nSupport role is now in read-only mode.`)] });
    } else {
        await channel.send({ embeds: [success(`**${user.tag}** has claimed this ticket.\nSupport role is now in read-only mode.`)] });
    }
}

async function unclaimTicket(interaction, client, db) {
    const { channel, user, guild, member } = interaction;

    const ticketRes = await db.query('SELECT * FROM tickets WHERE channel_id = $1', [channel.id]);
    const ticket = ticketRes.rows[0];
    
    const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);

    if (ticket.participants !== user.id && !isAdmin) {
        return await smartReply(interaction, { embeds: [error('⛔ Only the staff member who claimed this ticket can unclaim it.')] }, true);
    }

    const panelRes = await db.query('SELECT support_role_id FROM ticket_panels WHERE panel_id = $1', [ticket.panel_id]);
    const supportRoleId = panelRes.rows[0]?.support_role_id;

    await db.query('UPDATE tickets SET participants = NULL WHERE channel_id = $1', [channel.id]);

    await channel.permissionOverwrites.delete(user.id);
    
    if (supportRoleId) {
        await channel.permissionOverwrites.edit(supportRoleId, { ViewChannel: true, SendMessages: true });
    }

    const targetMsg = interaction.message || await findSystemMessage(channel, client);
    if (targetMsg) {
        const rows = targetMsg.components.map(row => {
            const newRow = ActionRowBuilder.from(row);
            newRow.components.forEach(c => {
                if (c.data.custom_id === 'ticket_action_unclaim') {
                    c.setCustomId('ticket_action_claim')
                     .setLabel('Claim Ticket')
                     .setStyle(ButtonStyle.Secondary) // Gris
                     .setEmoji('🙋‍♂️');
                }
            });
            return newRow;
        });

        if (interaction.isButton && interaction.message) await interaction.update({ components: rows });
        else await targetMsg.edit({ components: rows });
    }

    if (!interaction.isButton || !interaction.message) {
        await smartReply(interaction, { embeds: [success(`Ticket **unclaimed** successfully. Support staff can speak again.`)] });
    } else {
        await channel.send({ embeds: [success(`Ticket **unclaimed** successfully. Support staff can speak again.`)] });
    }
}

async function handleTicketActions(interaction, client) {
    const { customId, user, channel, member } = interaction;
    const db = client.db;

    if (customId === 'ticket_action_close') {
        const ticketRes = await db.query('SELECT user_id, panel_id FROM tickets WHERE channel_id = $1', [channel.id]);
        if (!ticketRes.rows[0]) return;
        const ticket = ticketRes.rows[0];

        const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
        
        if (ticket.user_id === user.id && !isAdmin) {
            const panelRes = await db.query('SELECT support_role_id FROM ticket_panels WHERE panel_id = $1', [ticket.panel_id]);
            const supportRole = panelRes.rows[0]?.support_role_id;
            
            if (!supportRole || !member.roles.cache.has(supportRole)) {
                return await smartReply(interaction, { embeds: [error('⚠️ You cannot close your own ticket. Please wait for Staff.')] }, true);
            }
        }

        const modal = new ModalBuilder().setCustomId('ticket_close_modal').setTitle('Close Ticket');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel("Reason").setStyle(TextInputStyle.Paragraph).setRequired(false)));
        return await interaction.showModal(modal);
    }

    if (customId === 'ticket_close_modal') {
        const reason = interaction.fields.getTextInputValue('reason') || 'No reason provided';
        await smartReply(interaction, { embeds: [success('🔒 Closing ticket and archiving...').setFooter({ text: 'Made by: ukirama' })] });
        return await closeTicket(interaction, client, db, reason);
    }

    if (customId === 'ticket_action_claim') return await claimTicket(interaction, client, db);
    
    if (customId === 'ticket_action_unclaim') {
        const ticketRes = await db.query('SELECT participants FROM tickets WHERE channel_id = $1', [channel.id]);
        const claimerId = ticketRes.rows[0]?.participants;
        const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);

        if (claimerId && claimerId !== user.id && !isAdmin) {
             return await smartReply(interaction, { embeds: [error('⛔ Ticket is claimed by another staff member.')] }, true);
        }
        return await unclaimTicket(interaction, client, db);
    }
}

module.exports = { handleTicketActions, closeTicket, claimTicket, unclaimTicket };