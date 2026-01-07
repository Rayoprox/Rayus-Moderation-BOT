const { Events } = require('discord.js');
const antiNuke = require('../utils/antiNuke.js');

module.exports = {
    name: Events.GuildRoleDelete,
    async execute(role) {
        if (!role.guild) return;
        await antiNuke.handleDeletion(role.guild, 'ROLE');
    },
};