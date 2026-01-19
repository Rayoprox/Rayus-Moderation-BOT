const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { emojis, SUPREME_IDS } = require('../../utils/config.js');
const { safeDefer } = require('../../utils/interactionHelpers.js');
const guildCache = require('../../utils/guildCache.js');
const { handleCommandSelect } = require('../../utils/setup_handle_command_select.js'); 
const { success } = require('../../utils/embedFactory.js');

module.exports = async (interaction) => {
    const { customId, guild, user, client, values } = interaction;
    const db = client.db;
    const guildId = guild.id;

    // --- SEGURIDAD: Solo Supreme IDs ---
    if (!SUPREME_IDS.includes(user.id)) {
        return interaction.reply({ 
            content: `${emojis.error} **ACCESS DENIED.** Only Bot Owners defined in \`.env\` can use this.`, 
            flags: [MessageFlags.Ephemeral] 
        });
    }

    // --- 1. BOTÓN: VOLVER AL PANEL PRINCIPAL ---
    if (customId === 'univ_back_main') {
        if (!await safeDefer(interaction, true)) return;
        
        // Ejecutamos el comando para repintar el panel principal
        const cmd = client.commands.get('universalpanel');
        if (cmd) await cmd.execute(interaction);
        return;
    }

    // --- 2. BOTÓN: TOGGLE LOCKDOWN ---
    if (customId === 'univ_toggle_lock') {
        if (!await safeDefer(interaction, true)) return;

        const res = await db.query("SELECT universal_lock FROM guild_settings WHERE guildid = $1", [guildId]);
        const currentLock = res.rows[0]?.universal_lock || false;
        const newLockState = !currentLock;
        
        await db.query(`INSERT INTO guild_settings (guildid, universal_lock) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET universal_lock = $2`, [guildId, newLockState]);
        guildCache.flush(guildId);

        // Recargamos
        const cmd = client.commands.get('universalpanel');
        if (cmd) await cmd.execute(interaction);
        return;
    }

    // --- 3. BOTÓN: CONFIGURAR ACCESO A /SETUP ---
    if (customId === 'univ_config_setup') {
        if (!await safeDefer(interaction, true)) return;

        // Simulamos la petición para obtener el menú de roles actual
        const mockInteraction = { values: ['setup'], client: client, guild: guild };
        const { embeds, components } = await handleCommandSelect(mockInteraction);
        
        // TRUCO MAESTRO: Cambiamos el ID del selector para que empiece por 'univ_'
        // Así el componentHandler nos lo devuelve AQUÍ y no al setup_permissions.js normal
        const roleSelectMenu = components[0].components[0];
        roleSelectMenu.setCustomId('univ_role_select_setup'); // <--- ID NUEVO Y AISLADO

        // Botón de volver aislado
        const backBtn = new ButtonBuilder()
            .setCustomId('univ_back_main')
            .setLabel('Back to Control Panel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('↩️');

        const navRow = new ActionRowBuilder().addComponents(backBtn);

        await interaction.editReply({ embeds: embeds, components: [components[0], navRow] });
        return;
    }

    // --- 4. GUARDAR ROLES (Lógica interna aislada) ---
    if (customId === 'univ_role_select_setup') {
        if (!await safeDefer(interaction, true)) return;

        // Guardamos los permisos manualmente aquí para no depender de setup_permissions.js
        const cmdName = 'setup';
        
        await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
        for (const rId of values) { 
            await db.query("INSERT INTO command_permissions (guildid, command_name, role_id) VALUES ($1, $2, $3)", [guildId, cmdName, rId]); 
        }
        guildCache.flush(guildId); 

        // Mensaje de éxito con botón para volver AL PANEL UNIVERSAL
        const backBtn = new ButtonBuilder()
            .setCustomId('univ_back_main')
            .setLabel('Return to Control Panel')
            .setStyle(ButtonStyle.Primary);

        const rolesFormatted = values.map(r => `<@&${r}>`).join(', ');
        
        await interaction.editReply({ 
            embeds: [success(`**Secure Access Updated**\n\nThe command \`/setup\` is now restricted to:\n${rolesFormatted || 'No roles (Admin only)'}`)], 
            components: [new ActionRowBuilder().addComponents(backBtn)] 
        });
        return;
    }
};