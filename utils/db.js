// rayoprox/roc-moderation-bot/ROC-Moderation-BOT-emoji-feature/utils/db.js

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL, 
    ssl: {
        rejectUnauthorized: false
    }
});

const db = {
    query: (text, params) => {
        return pool.query(text, params);
    },

    ensureTables: async () => {
        // --- Modlogs Table Definition (includes dmstatus and action_duration) ---
        const createModlogsTable = `
            CREATE TABLE IF NOT EXISTS modlogs (
                id SERIAL PRIMARY KEY,
                caseid TEXT UNIQUE NOT NULL,
                guildid TEXT NOT NULL,
                userid TEXT NOT NULL,
                usertag TEXT,
                modid TEXT NOT NULL,
                moderatortag TEXT,
                action TEXT NOT NULL,
                reason TEXT,
                timestamp BIGINT NOT NULL,
                dmstatus TEXT,  
                status TEXT DEFAULT 'ACTIVE',
                endsAt BIGINT,
                action_duration TEXT
            );`;
            
        // --- Other Tables Definitions ---
        const createLogChannelsTable = `
            CREATE TABLE IF NOT EXISTS log_channels (
                id SERIAL PRIMARY KEY, guildid TEXT UNIQUE NOT NULL, log_type TEXT NOT NULL, channel_id TEXT, UNIQUE (guildid, log_type)
            );`;
        const createGuildSettingsTable = `
            CREATE TABLE IF NOT EXISTS guild_settings (
                id SERIAL PRIMARY KEY, guildid TEXT UNIQUE NOT NULL, staff_roles TEXT, mod_immunity BOOLEAN DEFAULT TRUE
            );`;
        const createCommandPermissionsTable = `
            CREATE TABLE IF NOT EXISTS command_permissions (
                id SERIAL PRIMARY KEY, guildid TEXT NOT NULL, command_name TEXT NOT NULL, role_id TEXT NOT NULL, UNIQUE (guildid, command_name, role_id)
            );`;
        const createAutomodRulesTable = `
            CREATE TABLE IF NOT EXISTS automod_rules (
                id SERIAL PRIMARY KEY, guildid TEXT NOT NULL, rule_order INTEGER NOT NULL, warnings_count INTEGER NOT NULL, action_type TEXT NOT NULL, action_duration TEXT, UNIQUE (guildid, warnings_count)
            );`;
        const createAppealsBlacklistTable = `
            CREATE TABLE IF NOT EXISTS appeal_blacklist (
                id SERIAL PRIMARY KEY, userid TEXT NOT NULL, guildid TEXT NOT NULL, timestamp BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000, UNIQUE (userid, guildid)
            );`;
            
        // NEW TABLE: Tracks pending appeals
        const createPendingAppealsTable = `
            CREATE TABLE IF NOT EXISTS pending_appeals (
                userid TEXT NOT NULL,
                guildid TEXT NOT NULL,
                appeal_messageid TEXT,
                timestamp BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
                PRIMARY KEY (userid, guildid)
            );`;

        // 1. Create modlogs table
        await db.query(createModlogsTable);
        
        // 2. Add 'dmstatus' column if it doesn't exist (Backward compatibility)
        try {
             await db.query(`ALTER TABLE modlogs ADD COLUMN dmstatus TEXT`);
        } catch (e) {
             if (e.code !== '42701' && e.code !== '42P01') console.warn(`[WARN] Could not add dmstatus column: ${e.message}`);
        }

        // 3. Add 'action_duration' column if it doesn't exist (FIX FOR YOUR ERROR)
        try {
            await db.query(`ALTER TABLE modlogs ADD COLUMN action_duration TEXT`);
       } catch (e) {
            if (e.code !== '42701' && e.code !== '42P01') console.warn(`[WARN] Could not add action_duration column: ${e.message}`);
       }
        
        // 4. Create other tables
        await db.query(createLogChannelsTable);
        await db.query(createGuildSettingsTable);
        await db.query(createCommandPermissionsTable);
        await db.query(createAutomodRulesTable);
        await db.query(createAppealsBlacklistTable);
        await db.query(createPendingAppealsTable); 
        
        console.log('✅ PostgreSQL connected successfully.');
    }
};

module.exports = db;