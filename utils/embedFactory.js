// utils/embedFactory.js
const { EmbedBuilder } = require('discord.js');
const { emojis } = require('./config.js');

// Paleta de colores "Flat UI" (Más modernos)
const COLORS = {
    SUCCESS: 0x2ECC71, // Verde Esmeralda
    ERROR: 0xE74C3C,   // Rojo Alizarin
    WARNING: 0xF1C40F, // Amarillo Girasol
    INFO: 0x3498DB     // Azul Peter River
};

module.exports = {
    // ✅ Para mensajes de éxito (Ej: "Usuario baneado", "Configuración guardada")
    success: (text) => {
        return new EmbedBuilder()
            .setColor(COLORS.SUCCESS)
            .setDescription(`${emojis.success || '✅'} ${text}`);
    },

    // ❌ Para errores (Ej: "Duración inválida", "No tienes permisos")
    error: (text) => {
        return new EmbedBuilder()
            .setColor(COLORS.ERROR)
            .setDescription(`${emojis.error || '❌'} ${text}`);
    },

    // ⚠️ Para advertencias
    warning: (text) => {
        return new EmbedBuilder()
            .setColor(COLORS.WARNING)
            .setDescription(`${emojis.warn || '⚠️'} ${text}`);
    },

    // ℹ️ Para información simple
    info: (text) => {
        return new EmbedBuilder()
            .setColor(COLORS.INFO)
            .setDescription(`${emojis.info || 'ℹ️'} ${text}`);
    }
};