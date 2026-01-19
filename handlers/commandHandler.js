const { PermissionsBitField } = require('discord.js');
const db = require('../utils/db.js');
const { DEVELOPER_IDS, SUPREME_IDS, STAFF_COMMANDS } = require('../utils/config.js');
const { safeDefer } = require('../utils/interactionHelpers.js');
const { error } = require('../utils/embedFactory.js');
const guildCache = require('../utils/guildCache.js'); 

module.exports = async (interaction) => {
    const client = interaction.client; 
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    const { guild, user, member } = interaction;
    const isPublic = command.isPublic ?? false;

    if (!await safeDefer(interaction, false, !isPublic)) return;

   
    if (DEVELOPER_IDS.includes(user.id)) {
        return await command.execute(interaction);
    }

 
    if (command.data.name !== 'redeem') {
        const licRes = await db.query("SELECT expires_at FROM licenses WHERE guild_id = $1", [guild.id]);
        const hasLicense = licRes.rows.length > 0 && (licRes.rows[0].expires_at === null || parseInt(licRes.rows[0].expires_at) > Date.now());
        
        if (!hasLicense) {
            return interaction.editReply({ embeds: [error("🔒 **License Required**\nThis bot instance is locked. The owner must use `/redeem`.")] });
        }
    }

    if (SUPREME_IDS.includes(user.id)) {
        return await command.execute(interaction);
    }

    try {
        let guildData = guildCache.get(guild.id);
        if (!guildData) {
            const [settingsRes, permsRes] = await Promise.all([
                db.query('SELECT universal_lock, staff_roles FROM guild_settings WHERE guildid = $1', [guild.id]),
                db.query('SELECT command_name, role_id FROM command_permissions WHERE guildid = $1', [guild.id])
            ]);
            guildData = { settings: settingsRes.rows[0] || {}, permissions: permsRes.rows };
            guildCache.set(guild.id, guildData);
        }

        const universalLock = guildData.settings.universal_lock === true;
        const staffRoles = guildData.settings.staff_roles?.split(',') || [];
        const specificRoles = guildData.permissions.filter(p => p.command_name === command.data.name).map(r => r.role_id);
        
        let isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
        if (universalLock) isAdmin = false; 

        const isGlobalStaff = member.roles.cache.some(r => staffRoles.includes(r.id));
        const hasSpecificRules = specificRoles.length > 0;
        const hasSpecificPermission = hasSpecificRules && member.roles.cache.some(r => specificRoles.includes(r.id));

        let allowed = false;

        if (isAdmin) {
            allowed = true; 
        } else if (hasSpecificRules) {
            if (hasSpecificPermission) allowed = true;
        } else if (isGlobalStaff && STAFF_COMMANDS.includes(command.data.name)) {
            allowed = true;
        } else if (isPublic) {
            allowed = true;
        }

        if (!allowed) {
            const msg = universalLock && member.permissions.has(PermissionsBitField.Flags.Administrator)
                ? "🔒 **Universal Lockdown Active.**\nAdmin permissions are suspended by the Instance Owners."
                : "⛔ You don't have permission to use this.";
            return interaction.editReply({ embeds: [error(msg)] });
        }
    
        await command.execute(interaction);

    } catch (err) {
        console.error(`[HANDLER ERROR] ${interaction.commandName}:`, err);
        await interaction.editReply({ embeds: [error('An internal error occurred.')] }).catch(() => {});
    }
};