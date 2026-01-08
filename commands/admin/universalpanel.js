const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, RoleSelectMenuBuilder, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');
const { SUPREME_IDS, emojis } = require('../../utils/config.js');

module.exports = {
    deploy: 'main', 
    data: new SlashCommandBuilder()
        .setName('universalpanel')
        .setDescription('👑 Advanced Control Panel (Restricted Access).'),

    async execute(interaction) {
      

        
        if (!SUPREME_IDS.includes(interaction.user.id)) {
            return interaction.editReply({ 
                content: `${emojis.error} **ACCESS DENIED.** You are not authorized to use this panel.`
            });
        }

        const guildId = interaction.guild.id;

      
        const res = await db.query('SELECT universal_lock FROM guild_settings WHERE guildid = $1', [guildId]);
        let isLocked = res.rows[0]?.universal_lock || false;

        const embed = new EmbedBuilder()
            .setTitle('👑 Management Control Panel')
            .setDescription(`Control the absolute permission state of the bot.\n\n**Current State:** ${isLocked ? `${emojis.lock} **RESTRICTED (Lockdown)**` : `${emojis.unlock} **DEFAULT (Standard)**`}`)
            .addFields(
                { name: `${emojis.unlock} Default YES`, value: 'Admins have full access. `/setup` works normally.' },
                { name: `${emojis.lock} Default NO`, value: 'Strict Mode. Admins have **NO** access unless explicitly whitelisted.' }
            )
            .setColor(isLocked ? 0xFF0000 : 0x00FF00);

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('univ_toggle_lock')
                .setLabel(isLocked ? 'Switch to: Unlock' : 'Switch to: Lockdown')
                .setEmoji(isLocked ? (emojis.unlock || '🔓') : (emojis.lock || '🔒'))
                .setStyle(isLocked ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('univ_edit_perms')
                .setLabel('Edit Permissions')
                .setStyle(ButtonStyle.Primary)
        );

    
        const response = await interaction.editReply({ 
            embeds: [embed], 
            components: [row1]
        });

        // Collector
        const collector = response.createMessageComponentCollector({ time: 300000 });

        collector.on('collect', async i => {
            if (i.customId === 'univ_toggle_lock') {
                isLocked = !isLocked;
                await db.query(`INSERT INTO guild_settings (guildid, universal_lock) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET universal_lock = $2`, [guildId, isLocked]);
                
                const newEmbed = EmbedBuilder.from(embed)
                    .setDescription(`Control the absolute permission state of the bot.\n\n**Current State:** ${isLocked ? `${emojis.lock} **RESTRICTED (Lockdown)**` : `${emojis.unlock} **DEFAULT (Standard)**`}`)
                    .setColor(isLocked ? 0xFF0000 : 0x00FF00);
                
                row1.components[0].setLabel(isLocked ? 'Switch to: Unlock' : 'Switch to: Lockdown')
                    .setEmoji(isLocked ? (emojis.unlock || '🔓') : (emojis.lock || '🔒'))
                    .setStyle(isLocked ? ButtonStyle.Success : ButtonStyle.Danger);
                
                await i.update({ embeds: [newEmbed], components: [row1] });
            }

            if (i.customId === 'univ_edit_perms') {
                const commands = Array.from(interaction.client.commands.keys()).map(c => ({ label: `/${c}`, value: c }));
                
                const cmdMenu = new StringSelectMenuBuilder()
                    .setCustomId('univ_select_cmd')
                    .setPlaceholder('Select a command to force permissions...')
                    .addOptions(commands.slice(0, 25)); 

                await i.update({ content: 'Select a command to override permissions:', embeds: [], components: [new ActionRowBuilder().addComponents(cmdMenu)] });
            }

            if (i.customId === 'univ_select_cmd') {
                const cmdName = i.values[0];
                const roleMenu = new RoleSelectMenuBuilder()
                    .setCustomId(`univ_role_${cmdName}`)
                    .setPlaceholder(`Select roles allowed to use /${cmdName}`)
                    .setMinValues(0)
                    .setMaxValues(25);
                
                await i.update({ content: `Select Roles for **/${cmdName}** (Whitelist).`, components: [new ActionRowBuilder().addComponents(roleMenu)] });
            }
        });
    }
};