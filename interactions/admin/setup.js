const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder, 
    RoleSelectMenuBuilder, 
    ChannelSelectMenuBuilder, 
    ChannelType, 
    PermissionsBitField 
} = require('discord.js');
const db = require('../../utils/db.js');
const { safeDefer } = require('../../utils/interactionHelpers.js');
const { success, error } = require('../../utils/embedFactory.js');
const { emojis, STAFF_COMMANDS } = require('../../utils/config.js');

const generateSetupContent = async (interaction, guildId) => {
    const e = emojis || {};
    const [logChannelsResult, guildSettingsResult, permissionsResult, rulesResult, antiNukeResult] = await Promise.all([
        db.query('SELECT * FROM log_channels WHERE guildid = $1', [guildId]),
        db.query('SELECT * FROM guild_settings WHERE guildid = $1', [guildId]),
        db.query('SELECT command_name, role_id FROM command_permissions WHERE guildid = $1 ORDER BY command_name', [guildId]),
        db.query('SELECT rule_order, warnings_count, action_type, action_duration FROM automod_rules WHERE guildid = $1 ORDER BY warnings_count ASC', [guildId]),
        db.query('SELECT antinuke_enabled, threshold_count, threshold_time FROM guild_backups WHERE guildid = $1', [guildId])
    ]);
    
    const logChannels = logChannelsResult.rows;
    const guildSettings = guildSettingsResult.rows[0] || {};
    const permissions = permissionsResult.rows;
    const rules = rulesResult.rows;
    const antiNukeSettings = antiNukeResult.rows[0] || {};
    
    const ruleSummary = rules.map(rule => `**#${rule.rule_order}**: ${rule.warnings_count} warns -> **${rule.action_type}**${rule.action_duration ? ` (${rule.action_duration})` : ''}`).join('\n') || '*No Automod rules set.*';
    const modLog = logChannels.find(c => c.log_type === 'modlog')?.channel_id;
    const cmdLog = logChannels.find(c => c.log_type === 'cmdlog')?.channel_id;
    const banAppeal = logChannels.find(c => c.log_type === 'banappeal')?.channel_id;
    const antiNukeLog = logChannels.find(c => c.log_type === 'antinuke')?.channel_id;
    const staffRoles = guildSettings.staff_roles ? guildSettings.staff_roles.split(',').map(r => `<@&${r}>`).join(', ') : 'Not Set';
    const isAntiNukeOn = antiNukeSettings.antinuke_enabled;

    const permsConfig = Object.entries(permissions.reduce((acc, p) => {
        (acc[p.command_name] = acc[p.command_name] || []).push(`<@&${p.role_id}>`);
        return acc;
    }, {})).map(([cmd, roles]) => `\`/${cmd}\`: ${roles.join(', ')}`).join('\n') || 'No custom permissions set.';

   const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`⚙️ ${interaction.guild.name}'s Setup Panel`)
        .setDescription(`Configure the bot using the buttons below.`)
        .addFields(
            { name: `${e.channel || '📺'} Log Channels`, value: `**Mod Log:** ${modLog ? `<#${modLog}>` : '❌'}\n**Command Log:** ${cmdLog ? `<#${cmdLog}>` : '❌'}\n**Ban Appeals:** ${banAppeal ? `<#${banAppeal}>` : '❌'}\n**Anti-Nuke Log:** ${antiNukeLog ? `<#${antiNukeLog}>` : '❌'}` },
            { name: `${e.role || '🛡️'} Roles`, value: `**Staff Roles:** ${staffRoles}` }, 
            { name: `${e.lock || '🔒'} Permissions`, value: permsConfig },
            { name: `${e.rules || '📜'} Automod Rules`, value: ruleSummary },
            { name: '☢️ Anti-Nuke', value: isAntiNukeOn ? `✅ **ENABLED**` : '❌ **DISABLED**' }
        );

    const mainRows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_channels').setLabel('Log Channels').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('setup_staff_roles').setLabel('Staff Roles').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('setup_permissions').setLabel('Permissions').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('setup_automod').setLabel('Automod').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('setup_antinuke').setLabel('Anti-Nuke').setStyle(isAntiNukeOn ? ButtonStyle.Success : ButtonStyle.Danger)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Ticket System').setStyle(ButtonStyle.Primary).setEmoji('🎫'),
            new ButtonBuilder().setCustomId('delete_all_data').setLabel('Reset Data').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('cancel_setup').setLabel('Close').setStyle(ButtonStyle.Secondary)
        )
    ];
    
    return { embed, components: mainRows };
};

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Shows the main setup panel.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    generateSetupContent,

    async execute(interaction) {
        if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isRoleSelectMenu() && !interaction.isChannelSelectMenu()) {
             // Es el slash command
            if (!await safeDefer(interaction, true)) return;
            const { embed, components } = await generateSetupContent(interaction, interaction.guild.id);
            await interaction.editReply({ embeds: [embed], components });
            return;
        }
        
        // Es un componente (Button/Select)
        const { customId, guild, client, values } = interaction;
        const guildId = guild.id;

        // HOME / BACK
        if (customId === 'setup_home' || customId === 'setup_back_to_main') {
            if (!await safeDefer(interaction, true)) return;
            const { embed, components } = await generateSetupContent(interaction, guildId);
            await interaction.editReply({ embeds: [embed], components });
            return;
        }

        // CLOSE
        if (customId === 'cancel_setup') {
            await interaction.deferUpdate(); 
            await interaction.deleteReply().catch(() => {});
            return;
        }

        // CHANNELS
        if (customId === 'setup_channels') {
            if (!await safeDefer(interaction, true)) return;
            const res = await db.query("SELECT log_type, channel_id FROM log_channels WHERE guildid = $1", [guildId]);
            const channels = {};
            res.rows.forEach(r => channels[r.log_type] = r.channel_id);
            const formatCh = (id) => id ? `<#${id}>` : '`Not Configured`';

            const embed = new EmbedBuilder().setTitle('📜 Logging Channels Config').setDescription('Current configuration for log channels.').setColor(0x3498DB)
                .addFields({ name: '🛡️ Moderation Logs', value: formatCh(channels['modlog']), inline: true }, { name: '🔨 Ban Appeals', value: formatCh(channels['banappeal']), inline: true }, { name: '💻 Command Logs', value: formatCh(channels['cmdlog']), inline: true }, { name: '☢️ Anti-Nuke Logs', value: formatCh(channels['antinuke']), inline: true });
            
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels_edit').setLabel('Edit Channels').setStyle(ButtonStyle.Primary).setEmoji('✏️'), new ButtonBuilder().setCustomId('setup_channels_delete').setLabel('Delete').setStyle(ButtonStyle.Danger).setEmoji('🗑️'), new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary));
            await interaction.editReply({ embeds: [embed], components: [row] });
            return;
        }

        if (customId === 'setup_channels_edit') {
            if (!await safeDefer(interaction, true)) return;
            const modlog = new ChannelSelectMenuBuilder().setCustomId('select_modlog_channel').setPlaceholder('Set ModLog Channel').setChannelTypes([ChannelType.GuildText]);
            const appeal = new ChannelSelectMenuBuilder().setCustomId('select_banappeal_channel').setPlaceholder('Set Ban Appeal Channel').setChannelTypes([ChannelType.GuildText]);
            const cmdlog = new ChannelSelectMenuBuilder().setCustomId('select_cmdlog_channel').setPlaceholder('Set Cmd Log Channel').setChannelTypes([ChannelType.GuildText]);
            const antinuke = new ChannelSelectMenuBuilder().setCustomId('select_antinuke_channel').setPlaceholder('Set Anti-Nuke Log Channel').setChannelTypes([ChannelType.GuildText]);
            const backButton = new ButtonBuilder().setCustomId('setup_channels').setLabel('⬅️ Back to View').setStyle(ButtonStyle.Secondary);
            await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✏️ Edit Logging Channels').setDescription('Select the channels below to update configuration.')], components: [new ActionRowBuilder().addComponents(modlog), new ActionRowBuilder().addComponents(appeal), new ActionRowBuilder().addComponents(cmdlog), new ActionRowBuilder().addComponents(antinuke), new ActionRowBuilder().addComponents(backButton)] });
            return;
        }

        if (customId === 'setup_channels_delete') {
            if (!await safeDefer(interaction, true)) return;
            const res = await db.query("SELECT log_type FROM log_channels WHERE guildid = $1", [guildId]);
            if (res.rows.length === 0) return interaction.editReply({ embeds: [error("No channels configured to delete.")], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels').setLabel('Back').setStyle(ButtonStyle.Secondary))]});
            const options = res.rows.map(r => ({ label: `Delete ${r.log_type.toUpperCase()}`, value: r.log_type, emoji: '🗑️' }));
            const menu = new StringSelectMenuBuilder().setCustomId('select_delete_channel').setPlaceholder('Select channel to REMOVE config').addOptions(options);
            const backButton = new ButtonBuilder().setCustomId('setup_channels').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
            await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🗑️ Delete Channel Config').setDescription('Select the log type to remove from database.').setColor(0xE74C3C)], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
            return;
        }

        if (interaction.isStringSelectMenu() && customId === 'select_delete_channel') {
            await safeDefer(interaction, true);
            await db.query("DELETE FROM log_channels WHERE guildid = $1 AND log_type = $2", [guildId, values[0]]);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels').setLabel('Return to View').setStyle(ButtonStyle.Primary));
            await interaction.editReply({ embeds: [success(`Configuration for **${values[0]}** deleted.`)], components: [row] });
            return;
        }

        if (interaction.isChannelSelectMenu() && customId.endsWith('_channel')) {
            await safeDefer(interaction, true);
            const logType = customId.replace('select_', '').replace('_channel', '');
            await db.query(`INSERT INTO log_channels (guildid, log_type, channel_id) VALUES ($1, $2, $3) ON CONFLICT(guildid, log_type) DO UPDATE SET channel_id = $3`, [guildId, logType, values[0]]);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels').setLabel('Return to Channels View').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('setup_channels_edit').setLabel('Keep Editing').setStyle(ButtonStyle.Secondary));
            await interaction.editReply({ embeds: [success(`Channel for **${logType}** updated to <#${values[0]}>`)], components: [row] });
            return;
        }

        // STAFF ROLES
        if (customId === 'setup_staff_roles') {
            if (!await safeDefer(interaction, true)) return;
            const res = await db.query("SELECT staff_roles FROM guild_settings WHERE guildid = $1", [guildId]);
            const roleIds = (res.rows[0]?.staff_roles || '').split(',').filter(x => x);
            const description = roleIds.length > 0 ? roleIds.map(id => `• <@&${id}>`).join('\n') : '`No Staff Roles Configured`';
            const allowedCmds = STAFF_COMMANDS.map(c => `\`${c}\``).join(', ');

            const embed = new EmbedBuilder().setTitle('🛡️ Staff Roles Config').setDescription(`Roles configured here will bypass Automod and have access to **Staff Commands**.\n\n**Current Staff Roles:**\n${description}`).addFields({ name: '✅ Granted Commands (Default)', value: allowedCmds || 'None defined in config.' }).setColor(0xF1C40F);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_staff_edit').setLabel('Edit Roles').setStyle(ButtonStyle.Primary).setEmoji('✏️'), new ButtonBuilder().setCustomId('setup_staff_delete_all').setLabel('Delete All').setStyle(ButtonStyle.Danger).setEmoji('🗑️'), new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary));
            await interaction.editReply({ embeds: [embed], components: [row] });
            return;
        }

        if (customId === 'setup_staff_edit') {
            if (!await safeDefer(interaction, true)) return;
            const menu = new RoleSelectMenuBuilder().setCustomId('select_staff_roles').setPlaceholder('Add or Remove Staff Roles...').setMinValues(0).setMaxValues(25);
            const backButton = new ButtonBuilder().setCustomId('setup_staff_roles').setLabel('⬅️ Back to View').setStyle(ButtonStyle.Secondary);
            await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✏️ Edit Staff Roles').setDescription('Select ALL roles that should be Staff. Unselecting a role removes it.')], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
            return;
        }

        if (customId === 'setup_staff_delete_all') {
            if (!await safeDefer(interaction, true)) return;
            await db.query("UPDATE guild_settings SET staff_roles = NULL WHERE guildid = $1", [guildId]);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_staff_roles').setLabel('Return to View').setStyle(ButtonStyle.Primary));
            await interaction.editReply({ embeds: [success(`All Staff Roles have been removed.`)], components: [row] });
            return;
        }

        if (interaction.isRoleSelectMenu() && customId === 'select_staff_roles') {
            await safeDefer(interaction, true);
            await db.query(`INSERT INTO guild_settings (guildid, staff_roles) VALUES ($1, $2) ON CONFLICT(guildid) DO UPDATE SET staff_roles = $2`, [guildId, values.join(',')]);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_staff_roles').setLabel('Return to Staff View').setStyle(ButtonStyle.Primary));
            await interaction.editReply({ embeds: [success(`Staff Roles updated successfully. (${values.length} roles active)`)], components: [row] });
            return;
        }

        // PERMISSIONS
        if (customId === 'setup_permissions') {
            if (!await safeDefer(interaction, true)) return;
            const res = await db.query("SELECT command_name, role_id FROM command_permissions WHERE guildid = $1 ORDER BY command_name", [guildId]);
            const perms = {};
            res.rows.forEach(r => { if (!perms[r.command_name]) perms[r.command_name] = []; perms[r.command_name].push(r.role_id); });
            let description = Object.keys(perms).length === 0 ? '`No specific command permissions configured.`' : Object.entries(perms).map(([cmd, roles]) => `**/${cmd}**: ${roles.map(r => `<@&${r}>`).join(', ')}`).join('\n');
            
            const embed = new EmbedBuilder().setTitle('🔐 Command Permissions Config').setDescription(`Specific role overrides for commands (Bypass defaults & Lockdown).\n\n${description}`).setColor(0xE74C3C);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_perms_edit_select').setLabel('Add/Edit Override').setStyle(ButtonStyle.Primary).setEmoji('✏️'), new ButtonBuilder().setCustomId('setup_perms_delete').setLabel('Delete').setStyle(ButtonStyle.Danger).setEmoji('🗑️'), new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary));
            await interaction.editReply({ embeds: [embed], components: [row] });
            return;
        }

        if (customId === 'setup_perms_edit_select') {
            if (!await safeDefer(interaction, true)) return;
            const commands = client.commands.filter(c => c.data.name !== 'setup').map(c => ({ label: `/${c.data.name}`, value: c.data.name })).slice(0, 25);
            const menu = new StringSelectMenuBuilder().setCustomId('select_command_perms').setPlaceholder('Select command to edit...').addOptions(commands);
            const backButton = new ButtonBuilder().setCustomId('setup_permissions').setLabel('⬅️ Back to View').setStyle(ButtonStyle.Secondary);
            await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✏️ Select Command').setDescription('Which command do you want to modify permissions for?')], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
            return;
        }

        if (customId === 'setup_perms_delete') {
            if (!await safeDefer(interaction, true)) return;
            const res = await db.query("SELECT DISTINCT command_name FROM command_permissions WHERE guildid = $1", [guildId]);
            if (res.rows.length === 0) return interaction.editReply({ embeds: [error("No custom permissions configured to delete.")], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_permissions').setLabel('Back').setStyle(ButtonStyle.Secondary))]});
            const options = res.rows.map(r => ({ label: `Reset /${r.command_name}`, value: r.command_name, emoji: '🗑️' })).slice(0, 25);
            const menu = new StringSelectMenuBuilder().setCustomId('select_delete_perm').setPlaceholder('Select command to RESET').addOptions(options);
            const backButton = new ButtonBuilder().setCustomId('setup_permissions').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
            await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🗑️ Delete Permission Config').setDescription('Select the command to remove all overrides (Reset to default).').setColor(0xE74C3C)], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
            return;
        }

        if (interaction.isStringSelectMenu() && customId === 'select_delete_perm') {
            await safeDefer(interaction, true);
            await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, values[0]]);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_permissions').setLabel('Return to View').setStyle(ButtonStyle.Primary));
            await interaction.editReply({ embeds: [success(`Permissions for **/${values[0]}** have been reset to default.`)], components: [row] });
            return;
        }

        if (interaction.isStringSelectMenu() && customId === 'select_command_perms') {
            await safeDefer(interaction, true);
            const cmdName = values[0];
            const res = await db.query("SELECT role_id FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
            const currentRoles = res.rows.map(r => `<@&${r.role_id}>`).join(', ') || 'None';
            const menu = new RoleSelectMenuBuilder().setCustomId(`perms_role_select_${cmdName}`).setPlaceholder(`Allowed roles for /${cmdName}`).setMinValues(0).setMaxValues(25);
            const backButton = new ButtonBuilder().setCustomId('setup_perms_edit_select').setLabel('⬅️ Back to Commands').setStyle(ButtonStyle.Secondary);
            await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`🔐 Permissions for /${cmdName}`).setDescription(`Current Allowed Roles: ${currentRoles}\n\n**Select NEW list of allowed roles.**\n(Leave empty to remove all overrides)`)], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
            return;
        }

        if (interaction.isRoleSelectMenu() && customId.startsWith('perms_role_select_')) {
            await safeDefer(interaction, true);
            const cmdName = customId.replace('perms_role_select_', '');
            await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
            for (const rId of values) { await db.query("INSERT INTO command_permissions (guildid, command_name, role_id) VALUES ($1, $2, $3)", [guildId, cmdName, rId]); }
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_permissions').setLabel('Return to Permissions View').setStyle(ButtonStyle.Primary));
            await interaction.editReply({ embeds: [success(`Permissions for **/${cmdName}** updated.`)], components: [row] });
            return;
        }

        // ANTI NUKE
        if (customId === 'setup_antinuke') {
            if (!await safeDefer(interaction, true)) return;
            const res = await db.query("SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1", [guildId]);
            const isEnabled = res.rows[0]?.antinuke_enabled || false;
            const embed = new EmbedBuilder().setTitle('🛡️ Anti-Nuke System').setDescription(`The Anti-Nuke system automatically backups the server state (Roles, Channels) daily and allows restoration.\n\n**Status:** ${isEnabled ? '✅ ENABLED' : '❌ DISABLED'}`).setColor(isEnabled ? 0x2ECC71 : 0xE74C3C);
            const toggleBtn = new ButtonBuilder().setCustomId('antinuke_toggle').setLabel(isEnabled ? 'Disable System' : 'Enable System').setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success);
            const backBtn = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary);
            await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(toggleBtn, backBtn)] });
            return;
        }

        if (customId === 'antinuke_toggle') {
            if (!await safeDefer(interaction, true)) return;
            const res = await db.query("SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1", [guildId]);
            const newState = !(res.rows[0]?.antinuke_enabled || false);
            await db.query(`INSERT INTO guild_backups (guildid, antinuke_enabled) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET antinuke_enabled = $2`, [guildId, newState]);
            const embed = new EmbedBuilder().setTitle('🛡️ Anti-Nuke System').setDescription(`**Status:** ${newState ? '✅ ENABLED' : '❌ DISABLED'}`).setColor(newState ? 0x2ECC71 : 0xE74C3C);
            const toggleBtn = new ButtonBuilder().setCustomId('antinuke_toggle').setLabel(newState ? 'Disable System' : 'Enable System').setStyle(newState ? ButtonStyle.Danger : ButtonStyle.Success);
            const backBtn = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary);
            await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(toggleBtn, backBtn)] });
            return;
        }

        // DELETE ALL
        if (customId === 'delete_all_data') {
            if (!await safeDefer(interaction, false, true)) return; 
            const confirmBtn = new ButtonBuilder().setCustomId('confirm_delete_data').setLabel('CONFIRM DELETION').setStyle(ButtonStyle.Danger);
            const cancelBtn = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
            await interaction.editReply({ embeds: [error('⚠️ **DANGER ZONE** ⚠️\nThis will delete ALL configuration, logs, rules and appeals for this server.\nThis action cannot be undone.')], components: [new ActionRowBuilder().addComponents(confirmBtn, cancelBtn)] });
            return;
        }

        if (customId === 'confirm_delete_data') {
            if (!await safeDefer(interaction, true)) return;
            await db.query("DELETE FROM automod_rules WHERE guildid = $1", [guildId]);
            await db.query("DELETE FROM modlogs WHERE guildid = $1", [guildId]);
            await db.query("DELETE FROM command_permissions WHERE guildid = $1", [guildId]);
            await db.query("DELETE FROM log_channels WHERE guildid = $1", [guildId]);
            await db.query("DELETE FROM guild_settings WHERE guildid = $1", [guildId]);
            await db.query("DELETE FROM appeal_blacklist WHERE guildid = $1", [guildId]);
            await db.query("DELETE FROM pending_appeals WHERE guildid = $1", [guildId]);
            await db.query("DELETE FROM guild_backups WHERE guildid = $1", [guildId]); 
            await db.query("DELETE FROM ticket_panels WHERE guild_id = $1", [guildId]);
            await db.query("DELETE FROM tickets WHERE guild_id = $1", [guildId]);

            await interaction.editReply({ embeds: [success('All data for this guild has been wiped from the database.')], components: [] });
            return;
        }
    },
};