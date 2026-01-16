import { Client, GatewayIntentBits, Partials } from "discord.js";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// ---------- Bot Setup ----------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.Channel],
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const PREFIX = "!kiwibot ";

// ---------- Config Handling ----------
const CONFIG_FILE = path.resolve("./configs.json");

// Load existing configs from disk
let guildConfig = {};
if (fs.existsSync(CONFIG_FILE)) {
    try {
        guildConfig = JSON.parse(fs.readFileSync(CONFIG_FILE));
    } catch (err) {
        console.error("Failed to parse configs.json:", err);
        guildConfig = {};
    }
}

// Save configs to disk
function saveConfig() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(guildConfig, null, 2));
}

function getConfig(guildId) {
    if (!guildConfig[guildId]) {
        guildConfig[guildId] = {
            triggerWord: "cheese",
            triggerEmoji: "🧀",
            species: "kiwi",
        };
        saveConfig();
    }
    return guildConfig[guildId];
}

// ---------- Helpers ----------
function isAdmin(member) {
    return member.permissions.has("Administrator");
}

function hasCheeseText(message, config) {
    if (!message.content) return false;
    return (
        message.content.toLowerCase().includes(config.triggerWord.toLowerCase()) ||
        message.content.includes(config.triggerEmoji)
    );
}

function hasCheeseReaction(message, config) {
    return message.reactions.cache.some(
        r => r.emoji.name === config.triggerEmoji
    );
}

function getTargetEmojis(guild, config) {
    return guild.emojis.cache.filter(e =>
        e.name.toLowerCase().includes(config.species) &&
        e.name !== `${config.species}_sad`
    );
}

async function applyTargetReactions(message, config) {
    const emojis = getTargetEmojis(message.guild, config);
    for (const emoji of emojis.values()) {
        try {
            await message.react(emoji);
        } catch {
            console.error(`Failed to react with emoji: ${emoji.name}`);
        }
    }
}

async function clearTargetReactions(message, config) {
    const emojis = getTargetEmojis(message.guild, config);
    for (const emoji of emojis.values()) {
        const reaction = message.reactions.cache.get(emoji.id);
        if (reaction) {
            try {
                await reaction.users.remove(client.user.id);
            } catch { }
        }
    }
}

async function removeSadReaction(message, config) {
    const sadEmoji = message.guild.emojis.cache.find(
        e => e.name === `${config.species}_sad`
    );

    if (sadEmoji) {
        const reaction = message.reactions.cache.get(sadEmoji.id);
        if (reaction) {
            try {
                await reaction.users.remove(client.user.id);
            } catch { }
        }
    }

    const sad = message.reactions.cache.get("😢");
    if (sad) {
        try {
            await sad.users.remove(client.user.id);
        } catch { }
    }
}

async function reactSad(message, config) {
    const sadEmoji = message.guild.emojis.cache.find(
        e => e.name === `${config.species}_sad`
    );
    try {
        if (sadEmoji) {
            await message.react(sadEmoji);
        } else {
            await message.react("😢");
        }
    } catch { }
}

function isCheeseActive(message, config) {
    return hasCheeseText(message, config) || hasCheeseReaction(message, config);
}

// ---------- Core Logic ----------
async function evaluateMessage(message, isReactionRemove = false) {
    if (!message.guild) return;

    const config = getConfig(message.guild.id);
    const hasCheese = isCheeseActive(message, config);

    if (hasCheese) {
        await applyTargetReactions(message, config);
        await removeSadReaction(message, config);
        return;
    } else { // no cheese :'(
        await clearTargetReactions(message, config);
        if (!isReactionRemove) {
            await reactSad(message, config);
        }
    }
}

// ---------- Event Handlers ----------
client.on("messageCreate", async message => {
    if (!message.guild) return;

    // Prefix commands
    if (message.content.startsWith(PREFIX)) {
        const [cmd, ...args] = message.content.slice(PREFIX.length).split(/\s+/);
        const config = getConfig(message.guild.id);

        if (!isAdmin(message.member)) {
            await message.reply("only administrators can change kiwibot settings");
            return;
        }

        switch (cmd) {
            case "setword":
                if (args[0]) config.triggerWord = args[0];
                saveConfig();
                await message.reply(`trigger word set to **${config.triggerWord}**`);
                break;
            case "setemoji":
                if (args[0]) config.triggerEmoji = args[0];
                saveConfig();
                await message.reply(`trigger emoji set to ${config.triggerEmoji}`);
                break;
            case "setspecies":
                if (args[0]) config.species = args[0].toLowerCase();
                saveConfig();
                await message.reply(`species set to **${config.species}**`);
                break;
            case "status":
                await message.reply(
                    `word: **${config.triggerWord}**\n` +
                    `emoji: ${config.triggerEmoji}\n` +
                    `species: **${config.species}**`
                );
                break;
            case "commands":
                await message.reply(
                    "`!kiwibot setword <word>` - Set the trigger word\n" +
                    "`!kiwibot setemoji <emoji>` - Set the trigger emoji\n" +
                    "`!kiwibot setspecies <species>` - Set the species\n" +
                    "`!kiwibot status` - Show current settings\n" +
                    "`!kiwibot commands` - Show this help message"
                );
                break;
            default:
                await message.reply("unknown command, to see available commands use `!kiwibot commands`");
                break;
        }
        return;
    }

    await evaluateMessage(message, true);
});

client.on("messageUpdate", async (_, newMessage) => {
    if (newMessage.partial) await newMessage.fetch();
    await evaluateMessage(newMessage);
});

client.on("messageReactionAdd", async reaction => {
    if (reaction.partial) await reaction.fetch();
    const config = getConfig(reaction.message.guild.id);
    if (reaction.emoji.name === config.triggerEmoji) {
        await evaluateMessage(reaction.message);
    }
});

client.on("messageReactionRemove", async reaction => {
    if (reaction.partial) await reaction.fetch();
    const config = getConfig(reaction.message.guild.id);
    if (reaction.emoji.name === config.triggerEmoji) {
        await clearTargetReactions(reaction.message, config);
        await reactSad(reaction.message, config);
    }
});

client.once("clientReady", () => {
    console.log(`${client.user.tag} is sniffing for cheese`);
});

client.login(BOT_TOKEN);
