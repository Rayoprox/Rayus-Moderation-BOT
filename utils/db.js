const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

const createTables = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS modlogs (
                caseid VARCHAR(50) PRIMARY KEY,
                guildid VARCHAR(20),
                action VARCHAR(20),
                userid VARCHAR(20),
                usertag VARCHAR(100),
                moderatorid VARCHAR(20),
                moderatortag VARCHAR(100),
                reason TEXT,
                timestamp BIGINT,
                status VARCHAR(20) DEFAULT 'ACTIVE',
                endsat BIGINT DEFAULT NULL,
                logmessageid VARCHAR(30) DEFAULT NULL
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS automod_rules (
                id SERIAL PRIMARY KEY,
                guildid VARCHAR(20),
                rule_order INT,
                warnings_count INT,
                action_type VARCHAR(20),
                action_duration VARCHAR(20),
                UNIQUE(guildid, warnings_count)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS log_channels (
                guildid VARCHAR(20),
                log_type VARCHAR(20),
                channel_id VARCHAR(20),
                PRIMARY KEY (guildid, log_type)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS command_permissions (
                id SERIAL PRIMARY KEY,
                guildid VARCHAR(20),
                command_name VARCHAR(50),
                role_id VARCHAR(20)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS guild_settings (
                guildid VARCHAR(20) PRIMARY KEY,
                staff_roles TEXT
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS pending_appeals (
                userid VARCHAR(20),
                guildid VARCHAR(20),
                appeal_messageid VARCHAR(30),
                PRIMARY KEY (userid, guildid)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS appeal_blacklist (
                userid VARCHAR(20),
                guildid VARCHAR(20),
                PRIMARY KEY (userid, guildid)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS guild_backups (
                guildid VARCHAR(20) PRIMARY KEY,
                data JSONB,
                last_backup BIGINT,
                antinuke_enabled BOOLEAN DEFAULT FALSE,
                threshold_count INT DEFAULT 5,
                threshold_time INT DEFAULT 10
            )
        `);

        console.log('✅ All tables ensured in PostgreSQL.');
    } catch (error) {
        console.error('Error creating tables:', error);
    }
};

const checkConnection = async () => {
    try {
        const client = await pool.connect();
        console.log('HTTP Server running on port 3000 for 24/7 heartbeat.');
        console.log('🔍 Scanning columns...');
        await createTables();
        console.log('✅ Database repair complete. System ready.');
        client.release();
    } catch (err) {
        console.error('Database connection error:', err);
    }
};

checkConnection();

module.exports = {
    query: (text, params) => pool.query(text, params),
};