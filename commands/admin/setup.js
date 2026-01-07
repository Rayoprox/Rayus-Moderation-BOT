const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField, ChannelType, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');
const { emojis } = require('../../utils/config.js');
const TIMEOUT = 300_000; // 5 Minutos

const generateSetupContent = async (interaction, guildId) => {
    // Cargas paralelas para optimizar velocidad
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

    const permsByCommand = permissions.reduce((acc, perm) => {
        if (!acc[perm.command_name]) acc[perm.command_name] = [];
        acc[perm.command_name].push(`<@&${perm.role_id}>`);
        return acc;
    }, {});
    const permsConfig = Object.entries(permsByCommand).map(([cmd, roles]) => `\`/${cmd}\`: ${roles.join(', ')}`).join('\n') || 'No custom permissions set.';
    
   const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`⚙️ ${interaction.guild.name}'s Setup Panel`)
        .setDescription(`Configure the bot using the buttons below.`)
        .addFields(
            { name: `${emojis.channel} Log Channels`, value: `**Mod Log:** ${modLog ? `<#${modLog}>` : 'Not Set'}\n**Command Log:** ${cmdLog ? `<#${cmdLog}>` : 'Not Set'}\n**Ban Appeals:** ${banAppeal ? `<#${banAppeal}>` : 'Not Set'}\n**Anti-Nuke Log:** ${antiNukeLog ? `<#${antiNukeLog}>` : 'Not Set'}` },
            { name: `${emojis.role} Roles`, value: `**Staff Roles:** ${staffRoles}` }, 
            { name: `${emojis.lock} Command Permissions`, value: permsConfig },
            { name: `${emojis.rules} Automod Rules`, value: ruleSummary },
            { name: '☢️ Anti-Nuke System', value: isAntiNukeOn ? `✅ **ENABLED**` : '❌ **DISABLED**' }
        );

    const mainRows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_channels').setLabel('Log Channels').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('setup_staff_roles').setLabel('Staff Roles').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('setup_permissions').setLabel('Command Permissions').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('setup_automod').setLabel('Automod Rules').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('setup_antinuke').setLabel('Anti-Nuke').setStyle(isAntiNukeOn ? ButtonStyle.Success : ButtonStyle.Danger)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('delete_all_data').setLabel('Delete All Data').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('cancel_setup').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        )
    ];
    
    return { embed, components: mainRows };
};

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Shows the main setup panel for the bot.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    generateSetupContent,

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const { embed: mainEmbed, components: mainComponents } = await generateSetupContent(interaction, guildId);

        const response = await interaction.editReply({ 
            embeds: [mainEmbed], 
            components: mainComponents, 
            flags: [MessageFlags.Ephemeral] 
        });

        // LISTA BLANCA: Solo estos IDs serán manejados por este archivo.
        // El resto (Anti-Nuke, Automod Actions) los manejará interactionCreate.js
        const handledIds = [
            'cancel_setup', 
            'delete_all_data', 
            'setup_channels', 
            'set_modlog', 'set_cmdlog', 'set_banappeal',
            'setup_staff_roles', 
            'select_staff_roles',
            'setup_permissions', 
            'select_command_perms',
            'setup_automod', // Solo entrar al menú, no añadir/quitar reglas
            'setup_back_to_main'
        ];

        const collector = response.createMessageComponentCollector({ time: TIMEOUT });

        collector.on('end', () => interaction.editReply({ content: 'Setup panel has expired.', embeds: [], components: [] }).catch(() => {}));

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({ content: "❌ Only the user who ran the command can use this menu.", ephemeral: true });
            }

            // SI EL BOTÓN NO ESTÁ EN LA LISTA BLANCA, LO IGNORAMOS (Para que interactionCreate lo capture)
            if (!handledIds.includes(i.customId)) return;

            // Intentar deferir la actualización
            try { 
                await i.deferUpdate(); 
            } catch (e) { 
                return; // Si falla, asumimos que ya fue manejado o expiró
            }

            switch (i.customId) {
                case 'cancel_setup':
                    await i.editReply({ content: 'Setup cancelled.', embeds: [], components: [] }); 
                    return collector.stop();
                    
                case 'delete_all_data':
                    await db.query('DELETE FROM log_channels WHERE guildid = $1', [guildId]);
                    await db.query('DELETE FROM guild_settings WHERE guildid = $1', [guildId]);
                    await db.query('DELETE FROM command_permissions WHERE guildid = $1', [guildId]);
                    await db.query('DELETE FROM automod_rules WHERE guildid = $1', [guildId]);
                    await db.query('DELETE FROM pending_appeals WHERE guildid = $1', [guildId]);
                    await db.query('DELETE FROM guild_backups WHERE guildid = $1', [guildId]);
                    
                    await i.editReply({ content: '✅ All configuration data for this server has been deleted.', embeds: [], components: [] });
                    return collector.stop();
                    
                case 'setup_channels': {
                    const buttons = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('set_modlog').setLabel('Moderation Log').setStyle(ButtonStyle.Secondary), 
                        new ButtonBuilder().setCustomId('set_cmdlog').setLabel('Command Log').setStyle(ButtonStyle.Secondary), 
                        new ButtonBuilder().setCustomId('set_banappeal').setLabel('Ban Appeals').setStyle(ButtonStyle.Secondary)
                    );
                    const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                  
                    await i.editReply({ embeds: [new EmbedBuilder().setTitle('📺 Log Channel Setup').setDescription('Select a channel type to configure.')], components: [buttons, backButton] });
                    break;
                }
                
                case 'setup_staff_roles': {
                    const guildSettingsResult = await db.query('SELECT staff_roles FROM guild_settings WHERE guildid = $1', [guildId]);
                    const currentStaffRoles = guildSettingsResult.rows[0]?.staff_roles?.split(',').filter(r => r) || [];
                    
                    let menu = new RoleSelectMenuBuilder()
                        .setCustomId('select_staff_roles')
                        .setPlaceholder('Select staff roles...')
                        .setMinValues(0)
                        .setMaxValues(25);
                        
                    const backButton = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
                    );

                    await i.editReply({ 
                        embeds: [new EmbedBuilder().setTitle('👑 Staff Roles Setup').setDescription(`Select roles that are immune to moderation. Current: **${currentStaffRoles.length}** roles selected.`)], 
                        components: [new ActionRowBuilder().addComponents(menu), backButton] 
                    });
                    break;
                }
                
                case 'setup_permissions': {
                    const commandOptions = Array.from(interaction.client.commands.keys()).filter(cmd => cmd !== 'setup' && cmd !== 'help' && cmd !== 'ping').map(cmd => ({ label: `/${cmd}`, value: cmd }));
                    const menu = new StringSelectMenuBuilder().setCustomId('select_command_perms').setPlaceholder('Select a command to configure...').addOptions(commandOptions);
                    const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                    await i.editReply({ embeds: [new EmbedBuilder().setTitle('🛡️ Command Permissions').setDescription('Select a command to set role permissions.')], components: [new ActionRowBuilder().addComponents(menu), backButton] });
                    break;
                }
                
                case 'setup_automod': {
                    // Solo mostramos el menú, las acciones (añadir/quitar) las maneja interactionCreate.js
                    const { embed: currentEmbed } = await generateSetupContent(interaction, guildId);
                    const automodField = currentEmbed.data.fields.find(f => f.name.includes('Automod Rules'));
                    const ruleSummary = automodField ? automodField.value : '*No Automod rules set.*';
                    
                    const rulesEmbed = new EmbedBuilder()
                        .setTitle('🤖 Automod Rules Setup')
                        .setDescription(`Configure the automatic punishment thresholds based on active warnings.`)
                        .addFields({ name: 'Current Rules', value: ruleSummary })
                        .setColor(0x2ECC71);

                    const ruleActions = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('automod_add_rule').setLabel('➕ Add New Rule').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('automod_remove_rule').setLabel('➖ Remove Existing Rule').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
                    );

                    await i.editReply({ embeds: [rulesEmbed], components: [ruleActions] });
                    break;
                }
                
                case 'setup_back_to_main': {
                    const { embed: updatedEmbed, components: updatedComponents } = await generateSetupContent(interaction, guildId);
                    await i.editReply({ embeds: [updatedEmbed], components: updatedComponents });
                    break;
                }
                
                case 'set_modlog':
                case 'set_cmdlog':
                case 'set_banappeal': {
                    const logType = i.customId.replace('set_', '');
                    const menu = new ChannelSelectMenuBuilder().setCustomId(`select_${logType}_channel`).setPlaceholder('Select a channel...').addChannelTypes(ChannelType.GuildText);
                    const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels').setLabel('⬅️ Back to Log Options').setStyle(ButtonStyle.Secondary));
                    await i.editReply({ embeds: [new EmbedBuilder().setTitle(`📺 Select ${logType} channel`)], components: [new ActionRowBuilder().addComponents(menu), backButton] });
                    break;
                }
            }
        });
    },
};