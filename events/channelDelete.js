const { Events } = require('discord.js');
const antiNuke = require('../utils/antiNuke.js');

module.exports = {
    name: Events.ChannelDelete,
    async execute(channel) {
        if (!channel.guild) return;
        await antiNuke.handleDeletion(channel.guild, 'CHANNEL');
    },
};