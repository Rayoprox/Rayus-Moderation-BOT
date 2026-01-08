const { Events, PermissionsBitField, MessageFlags, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType } = require('discord.js');
const ms = require('ms');
const { emojis, SUPREME_IDS } = require('../utils/config.js');
const antiNuke = require('../utils/antiNuke.js');

const MAIN_GUILD_ID = process.env.DISCORD_GUILD_ID;
const APPEAL_GUILD_ID = process.env.DISCORD_APPEAL_GUILD_ID;
const DISCORD_MAIN_INVITE = process.env.DISCORD_MAIN_INVITE;

async function safeDefer(interaction, isUpdate = false, isEphemeral = false) {
    try {
        if (interaction.deferred || interaction.replied) return true;
        if (isUpdate) await interaction.deferUpdate();
        else await interaction.deferReply(isEphemeral ? { flags: [MessageFlags.Ephemeral] } : {});
        return true;
    } catch (error) { return false; }
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction) return;
        const db = interaction.client.db;
        const guildId = interaction.guild?.id;

        const setupCommand = interaction.client.commands.get('setup');
        const generateSetupContent = setupCommand?.generateSetupContent; 
        
        const logsPerPage = 5;

        // --- HELPER: LOG EMBED GENERATOR ---
        const generateLogEmbed = (logs, targetUser, page, totalPages, authorId, isWarningLog = false) => {
            const start = page * logsPerPage;
            const currentLogs = logs.slice(start, start + logsPerPage);
            const description = currentLogs.map(log => {
                const timestamp = Math.floor(Number(log.timestamp) / 1000);
                const action = log.action.charAt(0).toUpperCase() + log.action.slice(1).toLowerCase();
                const isRemoved = log.status === 'REMOVED' || log.status === 'VOIDED';
                const text = `**${action}** - <t:${timestamp}:f> (\`${log.caseid}\`)\n**Moderator:** ${log.moderatortag}\n**Reason:** ${log.reason}`;
                return isRemoved ? `~~${text}~~` : text;
            }).join('\n\n') || "No logs found.";

            const embed = new EmbedBuilder().setColor(isWarningLog ? 0xFFA500 : 0x3498DB).setTitle(`${isWarningLog ? emojis.warn : emojis.info} ${isWarningLog ? 'Warnings' : 'Moderation Logs'} for ${targetUser.tag}`).setDescription(description).setFooter({ text: `Page ${page + 1} of ${totalPages} | Total Logs: ${logs.length}` });
            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`${isWarningLog ? 'warns' : 'modlogs'}_prev_${targetUser.id}_${authorId}`).setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
                new ButtonBuilder().setCustomId(`${isWarningLog ? 'warns' : 'modlogs'}_next_${targetUser.id}_${authorId}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1),
                new ButtonBuilder().setCustomId(`modlogs_purge-prompt_${targetUser.id}_${authorId}`).setLabel('Purge All').setStyle(ButtonStyle.Danger).setDisabled(isWarningLog)
            );
            return { embed, components: [buttons] };
        };

        // ====================================================
        //                 COMMAND HANDLING
        // ====================================================
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) return;

            // 1. Supreme Bypass
            if (SUPREME_IDS && SUPREME_IDS.includes(interaction.user.id)) {
                try {
                    // CORRECCIÓN: Eliminada la excepción de setup. Ahora TODOS se difieren.
                    if (!await safeDefer(interaction, false, !command.isPublic)) return;
                    
                    await command.execute(interaction);
                } catch(e) { console.error(e); }
                return;
            }

            // 2. Universal Lock Check
            const settingsRes = await db.query('SELECT universal_lock FROM guild_settings WHERE guildid = $1', [guildId]);
            const isLocked = settingsRes.rows[0]?.universal_lock;
            
            if (isLocked) {
                const perms = await db.query('SELECT role_id FROM command_permissions WHERE guildid=$1 AND command_name=$2', [guildId, command.data.name]);
                const allowedRoles = perms.rows.map(r => r.role_id);
                const hasWhitelist = interaction.member.roles.cache.hasAny(...allowedRoles);

                if (!hasWhitelist && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ content: `${emojis.error} **ACCESS DENIED.** Server is in Lockdown.`, flags: [MessageFlags.Ephemeral] });
                }
            } else {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    const perms = await db.query('SELECT role_id FROM command_permissions WHERE guildid=$1 AND command_name=$2', [guildId, command.data.name]);
                    if (perms.rows.length > 0 && !interaction.member.roles.cache.hasAny(...perms.rows.map(r=>r.role_id))) {
                        return interaction.reply({ content: `${emojis.error} You do not have permission.`, flags: [MessageFlags.Ephemeral] });
                    }
                }
            }

            // 3. Execution & Logging
            try {
                // CORRECCIÓN: Eliminada la excepción de setup. El handler global maneja el defer.
                if (!await safeDefer(interaction, false, !command.isPublic)) return;
                
                await command.execute(interaction);

                const cmdLogResult = await db.query('SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2', [interaction.guild.id, 'cmdlog']);
                if (cmdLogResult.rows.length > 0) {
                    const ch = interaction.guild.channels.cache.get(cmdLogResult.rows[0].channel_id);
                    if (ch) {
                        let optionsList = interaction.options.data.map(opt => `${opt.name}: ${opt.value}`).join(', ');
                        const logEmbed = new EmbedBuilder().setColor(0x3498DB).setTitle('Command Executed').setDescription(`User: <@${interaction.user.id}>\nCommand: \`/${interaction.commandName} ${optionsList}\``).setTimestamp();
                        ch.send({ embeds: [logEmbed] }).catch(() => {});
                    }
                }
            } catch (error) {
                console.error(`Error executing /${interaction.commandName}:`, error);
                if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: `❌ Error executing command.`, flags: [MessageFlags.Ephemeral] });
            }
            return;
        }

        // ====================================================
        //            BUTTONS, MENUS & MODALS
        // ====================================================
        if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
            const { customId, values } = interaction;
            const parts = customId.split('_');

            // --- SETUP: NAVIGATION & ACTIONS ---
            if (customId === 'cancel_setup') {
                if (!await safeDefer(interaction, false)) return;
                await interaction.deleteReply().catch(() => {}); 
                return;
            }

            if (customId === 'delete_all_data') {
                if (!await safeDefer(interaction, true)) return;
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
                await db.query('DELETE FROM log_channels WHERE guildid = $1', [guildId]);
                await db.query('DELETE FROM guild_settings WHERE guildid = $1', [guildId]);
                await db.query('DELETE FROM command_permissions WHERE guildid = $1', [guildId]);
                await db.query('DELETE FROM automod_rules WHERE guildid = $1', [guildId]);
                await db.query('DELETE FROM pending_appeals WHERE guildid = $1', [guildId]);
                await db.query('DELETE FROM guild_backups WHERE guildid = $1', [guildId]);
                await interaction.editReply({ content: '✅ All data reset.', embeds: [], components: [] });
                return;
            }

            if (customId === 'setup_back_to_main') {
                if (!await safeDefer(interaction, true)) return;
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ embeds: [embed], components });
                return;
            }

            // --- SETUP: CHANNELS ---
            if (customId === 'setup_channels') {
                if (!await safeDefer(interaction, true)) return;
                const buttons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('set_modlog').setLabel('Mod Log').setStyle(ButtonStyle.Secondary), 
                    new ButtonBuilder().setCustomId('set_cmdlog').setLabel('Cmd Log').setStyle(ButtonStyle.Secondary), 
                    new ButtonBuilder().setCustomId('set_banappeal').setLabel('Appeals').setStyle(ButtonStyle.Secondary)
                );
                const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('📺 Log Channels')], components: [buttons, back] });
                return;
            }

            if (['set_modlog', 'set_cmdlog', 'set_banappeal'].includes(customId)) {
                if (!await safeDefer(interaction, true)) return;
                const type = customId.replace('set_', '');
                const menu = new ChannelSelectMenuBuilder().setCustomId(`select_${type}_channel`).setPlaceholder('Select channel...').addChannelTypes(ChannelType.GuildText);
                const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`Set ${type} Channel`)], components: [new ActionRowBuilder().addComponents(menu), back] });
                return;
            }

            if (interaction.isChannelSelectMenu() && customId.endsWith('_channel') && !customId.includes('antinuke')) {
                if (!await safeDefer(interaction, true)) return;
                const type = customId.replace('select_', '').replace('_channel', '');
                await db.query(`INSERT INTO log_channels (guildid, log_type, channel_id) VALUES ($1, $2, $3) ON CONFLICT(guildid, log_type) DO UPDATE SET channel_id = $3`, [guildId, type, values[0]]);
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ embeds: [embed], components });
                return;
            }

            // --- SETUP: STAFF ROLES ---
            if (customId === 'setup_staff_roles') {
                if (!await safeDefer(interaction, true)) return;
                const menu = new RoleSelectMenuBuilder().setCustomId('select_staff_roles').setPlaceholder('Select staff roles...').setMinValues(0).setMaxValues(25);
                const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('👑 Staff Roles')], components: [new ActionRowBuilder().addComponents(menu), back] });
                return;
            }

            if (interaction.isRoleSelectMenu() && customId === 'select_staff_roles') {
                if (!await safeDefer(interaction, true)) return;
                await db.query(`INSERT INTO guild_settings (guildid, staff_roles) VALUES ($1, $2) ON CONFLICT(guildid) DO UPDATE SET staff_roles = $2`, [guildId, values.join(',')]);
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ content: '✅ Staff Roles updated.', embeds: [embed], components });
                return;
            }

            // --- SETUP: PERMISSIONS ---
            if (customId === 'setup_permissions') {
                if (!await safeDefer(interaction, true)) return;
                const cmds = Array.from(interaction.client.commands.keys()).filter(cmd => !['setup', 'help', 'ping'].includes(cmd)).map(cmd => ({ label: `/${cmd}`, value: cmd }));
                const menu = new StringSelectMenuBuilder().setCustomId('select_command_perms').setPlaceholder('Select command...').addOptions(cmds);
                const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🛡️ Permissions')], components: [new ActionRowBuilder().addComponents(menu), back] });
                return;
            }

            if (interaction.isStringSelectMenu() && customId === 'select_command_perms') {
                if (!await safeDefer(interaction, true)) return;
                const commandName = values[0];
                const menu = new RoleSelectMenuBuilder().setCustomId(`perms_role_select_${commandName}`).setPlaceholder(`Select roles for /${commandName}...`).setMinValues(0).setMaxValues(25);
                const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`Permissions for /${commandName}`).setDescription('Select roles that can use this command.')], components: [new ActionRowBuilder().addComponents(menu), back] });
                return;
            }

            if (interaction.isRoleSelectMenu() && customId.startsWith('perms_role_select_')) {
                if (!await safeDefer(interaction, true)) return;
                const commandName = customId.replace('perms_role_select_', '');
                await db.query('DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2', [guildId, commandName]);
                for (const roleId of values) {
                    await db.query('INSERT INTO command_permissions (guildid, command_name, role_id) VALUES ($1, $2, $3)', [guildId, commandName, roleId]);
                }
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ content: '✅ Permissions updated.', embeds: [embed], components });
                return;
            }

            // --- SETUP: AUTOMOD ---
            if (customId === 'setup_automod') {
                if (!await safeDefer(interaction, true)) return;
                const { embed } = await generateSetupContent(interaction, guildId);
                const rules = embed.data.fields.find(f => f.name.includes('Automod'));
                const rulesEmbed = new EmbedBuilder().setTitle('🤖 Automod').setDescription(rules ? rules.value : 'No rules.').setColor(0x2ECC71);
                const actions = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('automod_add_rule').setLabel('Add Rule').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('automod_remove_rule').setLabel('Remove Rule').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
                );
                await interaction.editReply({ embeds: [rulesEmbed], components: [actions] });
                return;
            }

            if (customId === 'automod_add_rule') {
                if (!await safeDefer(interaction, true)) return;
                const menu = new StringSelectMenuBuilder().setCustomId('automod_action_select').setPlaceholder('1. Select punishment type...').addOptions([{ label: 'Ban (Permanent/Temporary)', value: 'BAN' },{ label: 'Mute (Timed only)', value: 'MUTE' },{ label: 'Kick (Instant)', value: 'KICK' }]);
                const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_automod').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🤖 Add Automod Rule - Step 1/3').setDescription('Select action.')], components: [new ActionRowBuilder().addComponents(menu), back] });
                return;
            }

            if (customId === 'automod_action_select') {
                if (!await safeDefer(interaction, true)) return;
                const actionType = values[0];
                const warnOptions = Array.from({ length: 10 }, (_, i) => ({ label: `${i + 1} Warning${i > 0 ? 's' : ''}`, value: `${i + 1}:${actionType}` }));
                const menu = new StringSelectMenuBuilder().setCustomId('automod_warn_select').setPlaceholder(`2. Select warning count for ${actionType}...`).addOptions(warnOptions);
                const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_automod').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🤖 Add Automod Rule - Step 2/3').setDescription(`Action: **${actionType}**. Select warning count.`)], components: [new ActionRowBuilder().addComponents(menu), back] });
                return;
            }

            if (customId === 'automod_warn_select') {
                const [warnCountStr, actionType] = values[0].split(':');
                const warnCount = parseInt(warnCountStr, 10);
                if (actionType === 'KICK') {
                    await interaction.deferUpdate();
                    const maxOrderResult = await db.query('SELECT MAX(rule_order) FROM automod_rules WHERE guildid = $1', [guildId]);
                    const nextRuleOrder = (maxOrderResult.rows[0].max || 0) + 1;
                    await db.query(`INSERT INTO automod_rules (guildid, rule_order, warnings_count, action_type) VALUES ($1, $2, $3, $4) ON CONFLICT (guildid, warnings_count) DO UPDATE SET rule_order = EXCLUDED.rule_order, action_type = EXCLUDED.action_type`, [guildId, nextRuleOrder, warnCount, actionType]);
                    const { embed, components } = await generateSetupContent(interaction, guildId);
                    await interaction.editReply({ content: `✅ Rule Saved (Kick).`, embeds: [embed], components });
                } else {
                    const modal = new ModalBuilder().setCustomId(`automod_duration_modal:${warnCountStr}:${actionType}`).setTitle(`Set Duration for ${actionType}`);
                    const durationInput = new TextInputBuilder().setCustomId('duration_value').setLabel(`Duration (e.g., 7d, 1h)`).setPlaceholder(`Max: ${actionType === 'MUTE' ? '28d' : 'Permanent (0)'}`).setStyle(TextInputStyle.Short).setRequired(true);
                    modal.addComponents(new ActionRowBuilder().addComponents(durationInput));
                    await interaction.showModal(modal);
                }
                return;
            }

            if (customId.startsWith('automod_duration_modal:')) {
                if (!await safeDefer(interaction, false, true)) return;
                const [, warnCountStr, actionType] = customId.split(':');
                const durationStr = interaction.fields.getTextInputValue('duration_value').trim();
                const warnCount = parseInt(warnCountStr, 10);
                let finalDuration = durationStr;
                
                if (durationStr !== '0') {
                    const durationMs = ms(durationStr);
                    if (!durationMs || durationMs < 5000 || durationMs > 2419200000) return interaction.editReply({ content: `${emojis.error} Invalid duration.` });
                } else if (actionType === 'MUTE') return interaction.editReply({ content: `${emojis.error} MUTE cannot be permanent.` });
                else if (actionType === 'BAN' && durationStr === '0') finalDuration = null;

                const maxOrderResult = await db.query('SELECT MAX(rule_order) FROM automod_rules WHERE guildid = $1', [guildId]);
                const nextRuleOrder = (maxOrderResult.rows[0].max || 0) + 1;
                await db.query(`INSERT INTO automod_rules (guildid, rule_order, warnings_count, action_type, action_duration) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (guildid, warnings_count) DO UPDATE SET rule_order = EXCLUDED.rule_order, action_type = EXCLUDED.action_type, action_duration = EXCLUDED.action_duration`, [guildId, nextRuleOrder, warnCount, actionType, finalDuration]);
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ content: `${emojis.success} Automod rule saved.`, embeds: [embed], components });
                return;
            }

            if (customId === 'automod_remove_rule') {
                if (!await safeDefer(interaction, false, true)) return;
                const rulesResult = await db.query('SELECT rule_order, warnings_count, action_type FROM automod_rules WHERE guildid = $1 ORDER BY warnings_count ASC', [guildId]);
                if (rulesResult.rows.length === 0) return interaction.editReply({ content: '❌ No rules found.' });
                const options = rulesResult.rows.map(r => ({ label: `Rule #${r.rule_order}: ${r.warnings_count} warns -> ${r.action_type}`, value: r.rule_order.toString() }));
                const menu = new StringSelectMenuBuilder().setCustomId('automod_select_remove').setPlaceholder('Select rule...').addOptions(options);
                return interaction.editReply({ content: 'Select rule to delete:', components: [new ActionRowBuilder().addComponents(menu)] });
            }

            if (customId === 'automod_select_remove') {
                if (!await safeDefer(interaction, true)) return;
                const ruleOrder = parseInt(values[0], 10);
                await db.query('DELETE FROM automod_rules WHERE guildid = $1 AND rule_order = $2', [guildId, ruleOrder]);
                const remaining = await db.query('SELECT id FROM automod_rules WHERE guildid=$1 ORDER BY warnings_count', [guildId]);
                for (let i = 0; i < remaining.rows.length; i++) await db.query('UPDATE automod_rules SET rule_order=$1 WHERE id=$2', [i + 1, remaining.rows[i].id]);
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ content: `✅ Rule deleted.`, embeds: [embed], components });
                return;
            }

            // --- SETUP: ANTINUKE ---
            if (customId === 'setup_antinuke') {
                if (!await safeDefer(interaction, true)) return;
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.editReply({ content: `${emojis.error} Need Administrator.` });
                
                const settingsRes = await db.query('SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1', [guildId]);
                const isEnabled = settingsRes.rows[0]?.antinuke_enabled;
                const embed = new EmbedBuilder().setTitle(`${emojis.warn} Anti-Nuke`).setDescription(`Status: **${isEnabled ? 'ENABLED' : 'DISABLED'}**`).setColor(isEnabled ? 0x2ECC71 : 0xE74C3C);
                const rows = [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('antinuke_toggle').setLabel(isEnabled ? 'Disable' : 'Enable').setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary)
                    ),
                    new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('select_antinuke_channel').setPlaceholder('Alert Channel').setChannelTypes(ChannelType.GuildText))
                ];
                await interaction.editReply({ embeds: [embed], components: rows });
                return;
            }

            if (customId === 'antinuke_toggle') {
                if (!await safeDefer(interaction, true)) return;
                const settingsRes = await db.query('SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1', [guildId]);
                const newStatus = !settingsRes.rows[0]?.antinuke_enabled;
                await db.query(`INSERT INTO guild_backups (guildid, antinuke_enabled, threshold_count, threshold_time) VALUES ($1, $2, 5, 10) ON CONFLICT (guildid) DO UPDATE SET antinuke_enabled = $2`, [guildId, newStatus]);
                if (newStatus) antiNuke.createBackup(interaction.guild);
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ content: `Anti-Nuke **${newStatus ? 'ENABLED' : 'DISABLED'}**.`, embeds: [embed], components });
                return;
            }

            if (customId === 'select_antinuke_channel') {
                if (!await safeDefer(interaction, true)) return;
                await db.query(`INSERT INTO log_channels (guildid, log_type, channel_id) VALUES ($1, 'antinuke', $2) ON CONFLICT(guildid, log_type) DO UPDATE SET channel_id = $2`, [guildId, values[0]]);
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ embeds: [embed], components });
                return;
            }

            // --- MOD LOGS & WARNS SYSTEM ---
            if (customId.startsWith('modlogs_') || customId.startsWith('warns_')) {
                 const [prefix, action, userId, authorId] = parts;
                 if (interaction.user.id !== authorId) return interaction.reply({ content: `${emojis.error} Only command author.`, flags: [MessageFlags.Ephemeral] });

                 if (action === 'next' || action === 'prev') {
                    if (!await safeDefer(interaction, true)) return;
                    const targetUser = await interaction.client.users.fetch(userId);
                    const isWarn = prefix === 'warns';
                    const logs = (await db.query(`SELECT * FROM modlogs WHERE userid=$1 AND guildid=$2 ${isWarn?"AND action='WARN'":""} ORDER BY timestamp DESC`, [userId, guildId])).rows;
                    const totalPages = Math.ceil(logs.length / logsPerPage);
                    let currentPage = parseInt(interaction.message.embeds[0].footer.text.split(' ')[1], 10) - 1;
                    currentPage += (action === 'next' ? 1 : -1);
                    const { embed, components } = generateLogEmbed(logs, targetUser, currentPage, totalPages, authorId, isWarn);
                    await interaction.editReply({ embeds: [embed], components });
                    return;
                 }

                 if (action === 'purge-prompt') {
                    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: `Need Admin.`, flags: [MessageFlags.Ephemeral] });
                    await interaction.deferReply({ ephemeral: true });
                    const buttons = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`modlogs_purge-confirm_${userId}_${authorId}`).setLabel('CONFIRM PURGE').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`modlogs_purge-cancel_${userId}_${authorId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
                    return interaction.editReply({ content: `${emojis.warn} **DELETE ALL LOGS?** This is irreversible.`, components: [buttons] });
                }

                if (action === 'purge-confirm') {
                    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
                    await interaction.deferUpdate();
                    const active = await db.query("SELECT * FROM modlogs WHERE userid=$1 AND guildid=$2 AND status='ACTIVE' AND action IN ('BAN','TIMEOUT')", [userId, guildId]);
                    if (active.rows.length > 0) return interaction.editReply({ content: `${emojis.error} User has active punishments. Remove them first.`, components: [] });
                    await db.query("DELETE FROM modlogs WHERE userid=$1 AND guildid=$2", [userId, guildId]);
                    await interaction.editReply({ content: `${emojis.success} Logs purged.`, components: [] });
                    const purgedEmbed = new EmbedBuilder().setTitle(`Logs Purged`).setDescription(`By <@${interaction.user.id}>`).setColor(0xAA0000);
                    await interaction.message.edit({ embeds: [purgedEmbed], components: [] }).catch(()=>{});
                    return;
                }

                if (action === 'purge-cancel') return interaction.update({ content: `Cancelled.`, components: [] });

                if (prefix === 'warns' && action === 'remove-start') {
                    await interaction.deferReply({ ephemeral: true });
                    const activeWarns = await db.query("SELECT caseid, reason FROM modlogs WHERE userid=$1 AND guildid=$2 AND action='WARN' AND status='ACTIVE' ORDER BY timestamp DESC", [userId, guildId]);
                    if (activeWarns.rows.length === 0) return interaction.editReply({ content: `No active warnings.` });
                    const options = activeWarns.rows.map(w => ({ label: `Case ${w.caseid}`, description: w.reason.substring(0, 50), value: w.caseid }));
                    const menu = new StringSelectMenuBuilder().setCustomId(`warns_remove-select_${userId}_${authorId}`).setPlaceholder('Select warning to annul...').addOptions(options);
                    return interaction.editReply({ components: [new ActionRowBuilder().addComponents(menu)] });
                }

                if (prefix === 'warns' && action === 'remove-select') {
                    await interaction.deferUpdate();
                    const caseId = values[0];
                    const log = (await db.query("SELECT * FROM modlogs WHERE caseid=$1", [caseId])).rows[0];
                    await db.query("UPDATE modlogs SET status='REMOVED' WHERE caseid=$1", [caseId]);
                    if (log?.logmessageid) {
                         const chRes = await db.query("SELECT channel_id FROM log_channels WHERE log_type='modlog' AND guildid=$1", [guildId]);
                         const ch = interaction.guild.channels.cache.get(chRes.rows[0]?.channel_id);
                         if (ch) {
                             const msg = await ch.messages.fetch(log.logmessageid).catch(()=>{});
                             if (msg) await msg.edit({ embeds: [EmbedBuilder.from(msg.embeds[0]).setColor(0x95A5A6).setTitle(`${emojis.warn} Case Annulled`)] });
                         }
                    }
                    await interaction.editReply({ content: `${emojis.success} Warning \`${caseId}\` annulled.`, components: [] });
                    return;
                }
            }

            // --- APPEAL SYSTEM ---
            if (customId === 'start_appeal_process') {
                if (!await safeDefer(interaction, false, true)) return;
                const btn = new ButtonBuilder().setCustomId(`appeal:open_form:${interaction.user.id}`).setLabel('Open Form').setStyle(ButtonStyle.Success);
                
                try {
                    if (interaction.guild.id !== APPEAL_GUILD_ID) return interaction.editReply({ content: `${emojis.error} Wrong server.` });
                    const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID).catch(() => null);
                    if (!mainGuild) return interaction.editReply({ content: `Main Guild Error.` });
                    const isBanned = await mainGuild.bans.fetch(interaction.user.id).catch(() => null);
                    
                    if (!isBanned) {
                        await db.query("DELETE FROM pending_appeals WHERE userid=$1", [interaction.user.id]);
                        return interaction.editReply({ content: `${emojis.error} You are not banned.` });
                    }

                    const pending = await db.query("SELECT * FROM pending_appeals WHERE userid=$1 AND guildid=$2", [interaction.user.id, MAIN_GUILD_ID]);
                    if (pending.rows.length > 0) return interaction.editReply({ content: `${emojis.error} Appeal already pending.` });

                    const banLog = (await db.query("SELECT endsat FROM modlogs WHERE userid=$1 AND action='BAN' AND status='ACTIVE' ORDER BY timestamp DESC LIMIT 1", [interaction.user.id])).rows[0];
                    if (banLog?.endsat) return interaction.editReply({ content: `${emojis.error} Temporary bans cannot be appealed.` });

                    const bl = await db.query("SELECT * FROM appeal_blacklist WHERE userid=$1", [interaction.user.id]);
                    if (bl.rows.length > 0) return interaction.editReply({ content: `${emojis.error} You are blacklisted from appeals.` });

                    await interaction.editReply({ content: `${emojis.success} Verified.`, components: [new ActionRowBuilder().addComponents(btn)] });
                } catch (e) { console.error(e); await interaction.editReply({ content: `Error verifying.` }); }
                return;
            }

            if (customId.startsWith('appeal:open_form:')) {
                const uid = customId.split(':')[2];
                if (interaction.user.id !== uid) return interaction.reply({ content: `Not your session.`, flags: [MessageFlags.Ephemeral] });
                const modal = new ModalBuilder().setCustomId('appeal:submit').setTitle('Ban Appeal');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q1').setLabel('Why were you banned?').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q2').setLabel('Why unban you?').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q3').setLabel('Extras').setStyle(TextInputStyle.Paragraph).setRequired(false))
                );
                await interaction.showModal(modal);
                return;
            }

            if (customId === 'appeal:submit') {
                if (!await safeDefer(interaction, false, true)) return;
                const q1 = interaction.fields.getTextInputValue('q1');
                const q2 = interaction.fields.getTextInputValue('q2');
                const q3 = interaction.fields.getTextInputValue('q3');

                const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID);
                const chRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid=$1 AND log_type='banappeal'", [MAIN_GUILD_ID]);
                const ch = mainGuild.channels.cache.get(chRes.rows[0]?.channel_id);
                if (!ch) return interaction.editReply(`Appeal channel missing.`);

                const caseId = `APP-${Date.now()}`;
                const embed = new EmbedBuilder().setTitle(`📝 NEW APPEAL`).setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                    .addFields({ name: 'Why?', value: q1 }, { name: 'Unban Reason?', value: q2 }, { name: 'Extras', value: q3 || 'N/A' }).setColor(0x5865F2);
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`appeal:accept:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('Accept').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`appeal:reject:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`appeal:blacklist:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('Blacklist').setStyle(ButtonStyle.Secondary)
                );

                const msg = await ch.send({ embeds: [embed], components: [row] });
                await db.query(`INSERT INTO pending_appeals (userid, guildid, appeal_messageid) VALUES ($1, $2, $3)`, [interaction.user.id, MAIN_GUILD_ID, msg.id]);
                await interaction.editReply({ content: `${emojis.success} Appeal submitted.` });
                return;
            }

            if (customId.startsWith('appeal:')) {
                const [, decision, , userId, gid] = customId.split(':');
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) return interaction.reply({ content: `No perms.`, flags: [MessageFlags.Ephemeral] });
                await interaction.deferUpdate();

                const user = await interaction.client.users.fetch(userId);
                const guild = await interaction.client.guilds.fetch(gid);
                const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setFooter({ text: `${decision.toUpperCase()} by ${interaction.user.tag}` }).setTimestamp();
                await db.query("DELETE FROM pending_appeals WHERE userid=$1", [userId]);

                if (decision === 'accept') {
                    await guild.members.unban(userId, `Appeal Accepted by ${interaction.user.tag}`);
                    newEmbed.setColor(0x2ECC71);
                    await user.send(`Appeal Accepted. Rejoin: ${DISCORD_MAIN_INVITE}`).catch(()=>{});
                    // Log unban to modlog would go here
                } else if (decision === 'reject') {
                    newEmbed.setColor(0xE74C3C);
                    await user.send(`Appeal Rejected.`).catch(()=>{});
                } else if (decision === 'blacklist') {
                    newEmbed.setColor(0x000000);
                    await db.query("INSERT INTO appeal_blacklist (userid, guildid) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, gid]);
                    await user.send(`Appeal Rejected & Blacklisted.`).catch(()=>{});
                }
                await interaction.editReply({ embeds: [newEmbed], components: [] });
                return;
            }
        }
    },
};