const express = require('express');
const path = require('path');
const db = require('./utils/db.js');

const app = express();
const PORT = process.env.WEB_PORT || 3000;

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', async (req, res) => {
    try {
        // Get basic stats
        const totalGuilds = (await db.query('SELECT COUNT(*) as count FROM guild_settings')).rows[0].count;
        const totalModlogs = (await db.query('SELECT COUNT(*) as count FROM modlogs')).rows[0].count;
        const activeTickets = (await db.query("SELECT COUNT(*) as count FROM tickets WHERE status = 'OPEN'")).rows[0].count;

        res.render('dashboard', {
            totalGuilds,
            totalModlogs,
            activeTickets
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Error loading dashboard');
    }
});

app.get('/guilds', async (req, res) => {
    try {
        const guilds = await db.query('SELECT guildid, prefix FROM guild_settings');
        res.render('guilds', { guilds: guilds.rows });
    } catch (error) {
        console.error('Guilds error:', error);
        res.status(500).send('Error loading guilds');
    }
});

app.get('/modlogs', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const modlogs = await db.query('SELECT * FROM modlogs ORDER BY timestamp DESC LIMIT $1', [limit]);
        res.render('modlogs', { modlogs: modlogs.rows });
    } catch (error) {
        console.error('Modlogs error:', error);
        res.status(500).send('Error loading modlogs');
    }
});

module.exports = app;