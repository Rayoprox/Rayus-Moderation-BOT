require('dotenv').config();

console.log(`--- BOT STARTING UP at ${new Date().toISOString()} ---`);
const http = require('http');
const { Client, Collection, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./utils/db.js'); 
const { startScheduler, resumePunishmentsOnStart } = require('./utils/temporary_punishment_handler.js');
const { initLogger } = require('./utils/logger.js');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildBans
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.User]
});

client.commands = new Collection();
client.db = db; 

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);
const commandsToDeploy = []; 

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            commandsToDeploy.push(command.data.toJSON());
        } else {
            console.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
    } else {
        client.on(event.name, (...args) => event.execute(...args)); 
    }
}


(async () => {
    try {
       
        if (initLogger) {
            await initLogger();
            console.log('✅ Persistent Logger initialized');
        }

        await db.ensureTables();
        console.log('✅ All tables ensured in PostgreSQL.');

    
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        try {
            console.log(`Started refreshing ${commandsToDeploy.length} application (/) commands.`);
            
           
            await rest.put(
                Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
                { body: commandsToDeploy },
            );

            console.log('✅ Successfully reloaded application (/) commands.');
        } catch (error) {
            console.error('❌ Error deploying commands:', error);
        }
        
        await client.login(process.env.DISCORD_TOKEN);
        
        const webApp = require('./web.js');
        webApp.locals.botClient = client;

        const PORT = process.env.PORT || 3001; 
        webApp.listen(PORT, () => {
            console.log(`🌐 Web dashboard running on port ${PORT}`);
        });

        startScheduler(client);
        await resumePunishmentsOnStart(client);

    } catch (error) {
        console.error('❌ Failed to connect to database or login to Discord:', error);
    }
})();

process.on('unhandledRejection', (reason, promise) => {
    if (reason?.code === 10062 || reason?.code === 40060 || reason?.code === 10008) return;
    console.error(' [ANTI-CRASH] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err, origin) => {
    console.error(' [ANTI-CRASH] Uncaught Exception:', err);
    console.error('Origen:', origin);
});

process.on('uncaughtExceptionMonitor', (err, origin) => {
    console.error(' [ANTI-CRASH] Monitor:', err);
});