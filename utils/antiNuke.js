const { AuditLogEvent, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const db = require('./db.js');

// Cache en memoria para velocidad máxima (evita consultar DB en cada borrado)
// Map<GuildID, Map<UserID, { count: number, timer: NodeJS.Timeout }>>
const deletionCache = new Map();

async function createBackup(guild) {
    if (!guild) return;
    try {
        const channels = guild.channels.cache.map(c => ({
            name: c.name,
            type: c.type,
            parentId: c.parentId, // ID de la categoría (necesitará remapeo al restaurar)
            parentName: c.parent ? c.parent.name : null, // Guardamos el nombre por si la categoría cambia de ID
            position: c.position,
            permissionOverwrites: c.permissionOverwrites.cache.map(p => ({
                id: p.id, // Rol o Usuario ID (Ojo: si el rol se borra, esto falla. Mejor guardar nombre del rol si es posible, pero ID es estándar)
                allow: p.allow.bitfield.toString(),
                deny: p.deny.bitfield.toString(),
                type: p.type
            }))
        }));

        const roles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).map(r => ({
            name: r.name,
            color: r.color,
            hoist: r.hoist,
            permissions: r.permissions.bitfield.toString(),
            position: r.position
        }));

        const backupData = { channels, roles, timestamp: Date.now() };

        // Guardar en DB
        await db.query(`
            INSERT INTO guild_backups (guildid, data, last_backup) 
            VALUES ($1, $2, $3) 
            ON CONFLICT (guildid) DO UPDATE 
            SET data = $2, last_backup = $3
        `, [guild.id, backupData, Date.now()]);

        console.log(`[BACKUP] Guild ${guild.name} backup completed.`);
    } catch (e) {
        console.error(`[BACKUP ERROR] Guild ${guild.id}:`, e);
    }
}

async function restoreGuild(guild) {
    try {
        const result = await db.query('SELECT data FROM guild_backups WHERE guildid = $1', [guild.id]);
        if (result.rows.length === 0) return console.log('[RESTORE] No backup found.');
        
        const { roles, channels } = result.rows[0].data;
        console.log(`[RESTORE] Starting restoration for ${guild.name}...`);

        // 1. Restaurar Roles (Primero, para poder asignar permisos a canales)
        // Mapeo de OldID -> NewID sería ideal, pero complejo. Restauramos por nombre.
        for (const r of roles) {
            const exists = guild.roles.cache.find(role => role.name === r.name);
            if (!exists) {
                await guild.roles.create({
                    name: r.name,
                    color: r.color,
                    hoist: r.hoist,
                    permissions: BigInt(r.permissions),
                    reason: 'Anti-Nuke Restoration'
                }).catch(() => {});
            }
        }

        // 2. Restaurar Categorías primero
        const categories = channels.filter(c => c.type === ChannelType.GuildCategory);
        for (const c of categories) {
            if (!guild.channels.cache.find(ch => ch.name === c.name && ch.type === c.type)) {
                await guild.channels.create({ name: c.name, type: c.type, reason: 'Anti-Nuke Restoration' }).catch(() => {});
            }
        }

        // 3. Restaurar Canales normales
        const textVoiceChannels = channels.filter(c => c.type !== ChannelType.GuildCategory);
        for (const c of textVoiceChannels) {
            if (!guild.channels.cache.find(ch => ch.name === c.name && ch.type === c.type)) {
                // Intentar encontrar la categoría padre nueva
                const parent = c.parentName ? guild.channels.cache.find(cat => cat.name === c.parentName && cat.type === ChannelType.GuildCategory) : null;
                
                await guild.channels.create({
                    name: c.name,
                    type: c.type,
                    parent: parent ? parent.id : null,
                    reason: 'Anti-Nuke Restoration'
                }).catch(() => {});
                // Pequeña pausa para evitar Rate Limits agresivos
                await new Promise(r => setTimeout(r, 500)); 
            }
        }
        console.log('[RESTORE] Process finished.');
    } catch (e) {
        console.error('[RESTORE ERROR]', e);
    }
}

async function handleDeletion(guild, type) {
    // 1. Verificar si Anti-Nuke está activado
    const settings = await db.query('SELECT antinuke_enabled, threshold_count, threshold_time FROM guild_backups WHERE guildid = $1', [guild.id]);
    if (settings.rows.length === 0 || !settings.rows[0].antinuke_enabled) return;

    const { threshold_count, threshold_time } = settings.rows[0];

    // 2. Buscar al culpable en Audit Logs
    const auditType = type === 'CHANNEL' ? AuditLogEvent.ChannelDelete : AuditLogEvent.RoleDelete;
    const logs = await guild.fetchAuditLogs({ limit: 1, type: auditType }).catch(() => null);
    if (!logs) return;
    
    const entry = logs.entries.first();
    if (!entry || Date.now() - entry.createdTimestamp > 5000) return; // Si el log es muy viejo, ignorar
    
    const executor = entry.executor;
    if (!executor || executor.bot) return; // Ignorar bots para evitar bucles (aunque cuidado con self-bots)

    // 3. Lógica de Conteo (Rate Limit Check)
    if (!deletionCache.has(guild.id)) deletionCache.set(guild.id, new Map());
    const guildCache = deletionCache.get(guild.id);

    if (!guildCache.has(executor.id)) {
        guildCache.set(executor.id, { 
            count: 1, 
            timer: setTimeout(() => guildCache.delete(executor.id), threshold_time * 1000) 
        });
    } else {
        const userData = guildCache.get(executor.id);
        userData.count++;
        
        if (userData.count >= threshold_count) {
            // 🚨 NUKE DETECTADO 🚨
            clearTimeout(userData.timer);
            guildCache.delete(executor.id);
            await triggerProtection(guild, executor);
        }
    }
}

async function triggerProtection(guild, user) {
    console.log(`[ANTI-NUKE] Triggered by ${user.tag} in ${guild.name}`);

    // 1. BAN HAMMER
    if (guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
        await guild.members.ban(user.id, { reason: 'Anti-Nuke System Triggered: Mass Deletion Detected' }).catch(e => console.error("Failed to ban nuker:", e));
    }

    // 2. LOGGING
    const logChannelRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'antinuke'", [guild.id]);
    if (logChannelRes.rows.length > 0) {
        const channel = guild.channels.cache.get(logChannelRes.rows[0].channel_id);
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle('🛡️ ANTI-NUKE TRIGGERED')
                .setColor(0xFF0000)
                .setDescription(`**User:** ${user.tag} (\`${user.id}\`)\n**Action:** Mass Deletion\n**Status:** User Banned. Starting Server Restoration...`)
                .setTimestamp();
            await channel.send({ embeds: [embed] }).catch(() => {});
        }
    }

    // 3. RESTORE
    await restoreGuild(guild);
}

module.exports = { createBackup, handleDeletion };