const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const { join } = require('path');
const db = require('./utils/db');

const app = express();
const SCOPES = ['identify', 'guilds'];

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new Strategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: SCOPES
}, (_, __, profile, done) => process.nextTick(() => done(null, profile))));

app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.use(express.static(join(__dirname, 'public')));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } 
}));
app.use(passport.initialize());
app.use(passport.session());

const auth = (req, res, next) => req.isAuthenticated() ? next() : res.redirect('/auth/discord');

app.get('/auth/discord', passport.authenticate('discord', { scope: SCOPES }));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/logout', (req, res) => req.logout(() => res.redirect('/')));

app.get('/', auth, (req, res) => {
    res.redirect('/guilds');
});

app.get('/guilds', auth, async (req, res) => {
    try {
        const { botClient } = req.app.locals;
        const user = req.user;
        const userGuilds = user.guilds || [];

        const ALLOWED_GUILDS = [
            process.env.DISCORD_GUILD_ID,
            process.env.DISCORD_APPEAL_GUILD_ID
        ].filter(id => id); 

        const administrableGuilds = [];

        for (const uGuild of userGuilds) {
   
            if (!ALLOWED_GUILDS.includes(uGuild.id)) continue;

           
            const isAdmin = (uGuild.permissions & 0x8) === 0x8;
            
            if (isAdmin && botClient) {
                const guild = botClient.guilds.cache.get(uGuild.id);
                if (guild) {
                    const dbSettings = await db.query('SELECT prefix FROM guild_settings WHERE guildid = $1', [guild.id]);
                    
                    administrableGuilds.push({
                        id: guild.id,
                        name: guild.name,
                        icon: guild.iconURL({ extension: 'png', size: 128 }),
                        prefix: dbSettings.rows[0]?.prefix || '!',
                        memberCount: guild.memberCount,
                     
                        type: (guild.id === process.env.DISCORD_APPEAL_GUILD_ID) ? 'Appeals' : 'Main'
                    });
                }
            }
        }

        res.render('guilds', { 
            bot: botClient?.user, 
            user: req.user, 
            guilds: administrableGuilds 
        });

    } catch (e) {
        console.error(e);
        res.status(500).send('Error loading guilds');
    }
});


app.get('/manage/:guildId', auth, async (req, res) => {
    try {
        const { botClient } = req.app.locals;
        const guildId = req.params.guildId;

       
        if (guildId !== process.env.DISCORD_GUILD_ID && guildId !== process.env.DISCORD_APPEAL_GUILD_ID) {
            return res.redirect('/guilds');
        }

     
        const modlogs = await db.query('SELECT COUNT(*) as count FROM modlogs WHERE guildid = $1', [guildId]);
      
        let activeTickets = 0;
        try {
            const { rows } = await db.query("SELECT * FROM tickets WHERE status = 'OPEN' AND guild_id = $1", [guildId]);
            
            if (rows.length > 0 && botClient) {
            
                activeTickets = rows.filter(t => {
                    const cId = t.channel_id || t.channelid || t.id;
                    return cId && botClient.channels.cache.has(cId);
                }).length;
            }
        } catch (err) {
            console.warn("Error checking tickets:", err.message);
        }
      

        res.render('dashboard', {
            bot: botClient?.user,
            user: req.user,
            guildId: guildId, 
            totalModlogs: modlogs.rows[0].count,
            activeTickets
        });

    } catch (e) {
        console.error(e);
        res.status(500).send('Server Error');
    }
});

app.get('/modlogs/:guildId', auth, async (req, res) => {
    try {
        const { botClient } = req.app.locals;
        const guildId = req.params.guildId;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);

        if (guildId !== process.env.DISCORD_GUILD_ID && guildId !== process.env.DISCORD_APPEAL_GUILD_ID) {
            return res.redirect('/guilds');
        }
        
        const { rows } = await db.query('SELECT * FROM modlogs WHERE guildid = $1 ORDER BY timestamp DESC LIMIT $2', [guildId, limit]);
        
        res.render('modlogs', { 
            bot: botClient?.user, 
            user: req.user, 
            modlogs: rows,
            guildId: guildId 
        });
    } catch (e) { 
        console.error(e);
        res.status(500).send('Error'); 
    }
});

app.get('/transcript/:id', async (req, res) => {
    try {
        const ticketId = req.params.id;
        const result = await db.query('SELECT * FROM transcripts WHERE ticket_id = $1', [ticketId]);
        
        if (result.rows.length === 0) return res.status(404).send('<h1>404 - Transcript Not Found</h1>');

        const data = result.rows[0];
        if (data.messages && data.messages.html) return res.send(data.messages.html);
        return res.send('<h3>Transcript format is outdated.</h3>');

    } catch (error) { res.status(500).send('Internal Server Error'); }
});

module.exports = app;