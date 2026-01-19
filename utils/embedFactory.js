const { EmbedBuilder } = require('discord.js');
const { emojis } = require('./config.js');

const createEmbed = (type, description) => {
    let color, titleEmoji;
    
    switch (type) {
        case 'success':
            color = 0x2ECC71; 
            titleEmoji = emojis?.check || '✅';
            break;
        case 'error':
            color = 0xE74C3C; 
            titleEmoji = emojis?.cross || '❌';
            break;
        default:
            color = 0x3498DB; 
            titleEmoji = 'ℹ️';
    }

    return new EmbedBuilder()
        .setColor(color)
        .setDescription(`${titleEmoji} ${description}`);
       
};

module.exports = {
    success: (text) => createEmbed('success', text),
    error: (text) => createEmbed('error', text),
    info: (text) => createEmbed('info', text)
};