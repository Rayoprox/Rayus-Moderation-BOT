require('dotenv').config();

console.log(`--- BOT STARTING UP at ${new Date().toISOString()} ---`);
const { Client, Collection, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./utils/db.js'); 
const { startScheduler, resumePunishmentsOnStart } = require('./utils/temporary_punishment_handler.js');
const { initLogger } = require('./utils/logger.js');

if (!process.env.DISCORD_TOKEN) {
    console.error("❌Discord Toeken");
    process.exit(1);
}

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

const mainGuildCommands = [];
const appealGuildCommands = [];
const globalCommands = []; 

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);

            switch (command.deploy) {
                case 'main':
                    mainGuildCommands.push(command.data.toJSON());
                    break;
                case 'appeal':
                    appealGuildCommands.push(command.data.toJSON());
                    break;
                case 'all': 
                case 'global': 
                    globalCommands.push(command.data.toJSON());
                    break;
                default:
                    console.warn(`[WARNING] El comando ${command.data.name} no tiene propiedad "deploy" válida. Se ignorará en el deploy.`);
                    break;
            }
        } else {
            console.warn(`[WARNING] El comando en ${filePath} le falta "data" o "execute".`);
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
        console.log('🔄 Started refreshing application (/) commands.');


        if (process.env.DISCORD_GUILD_ID && mainGuildCommands.length > 0) {
            try {
                await rest.put(
                    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
                    { body: mainGuildCommands },
                );
                console.log(`✅ [MAIN] Successfully reloaded ${mainGuildCommands.length} commands.`);
            } catch (e) { console.error(`❌ [MAIN] Error deploy: ${e.message}`); }
        }


        if (process.env.DISCORD_APPEAL_GUILD_ID && appealGuildCommands.length > 0) {
            try {
                await rest.put(
                    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_APPEAL_GUILD_ID),
                    { body: appealGuildCommands },
                );
                console.log(`✅ [APPEAL] Successfully reloaded ${appealGuildCommands.length} commands.`);
            } catch (e) { console.error(`❌ [APPEAL] Error deploy: ${e.message}`); }
        }


        if (globalCommands.length > 0) {
            try {
                await rest.put(
                    Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
                    { body: globalCommands },
                );
                console.log(`✅ [GLOBAL] Successfully reloaded ${globalCommands.length} commands.`);
            } catch (e) { console.error(`❌ [GLOBAL] Error deploy: ${e.message}`); }
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
        console.error('❌ CRITICAL ERROR during startup:', error);
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