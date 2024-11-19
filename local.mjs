import { Routes } from 'discord-api-types/v10';
import { REST, SlashCommandBuilder } from 'discord.js'

import * as dotenv from 'dotenv';
dotenv.config();

const { token, applicationId, guildId } = { token: process.env.DISCORD_TOKEN, applicationId: process.env.DISCORD_APPLICATION_ID, guildId: '989196831508557836' };
/*
client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    console.log(interaction);
    if (interaction.commandName === 'ping') {
        await interaction.deferReply({ ephemeral: true });
        setTimeout(() => {
            interaction.editReply('cool')
        }, 5000)

    }
});

client.login(token);
*/
//console.log({ token, applicationId, guildId });
const discord = new REST().setToken(token);
const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong!'),
    new SlashCommandBuilder()
        .setName('example')
        .setDescription('showcase a gif swap')
        .addStringOption(o => o
            .setName('url')
            .setDescription('The gif url')
            .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Change bot and user settings')
        .addBooleanOption(o => o
            .setName('mention')
            .setDescription('Allow other users to use your face in swap (default: false)')
            .setRequired(false)
        )
        .addAttachmentOption((o) => o
            .setName('face')
            .setDescription('your face image')
            .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName('swap')
        .setDescription('Swap faces in a gif')
        .addSubcommand(c => c
            .setName('tenor')
            .setDescription('Search tenor api')
            .addStringOption(o => o
                .setName('query')
                .setDescription('enter query for tenor')
                .setAutocomplete(true)
                .setRequired(true)
            )
            .addUserOption(o => o
                .setName('user')
                .setDescription('Whose face are we swapping?')
                .setRequired(false)
            )
        )
        .addSubcommand(c => c
            .setName('gif')
            .setDescription('Swap a gif from url')
            .addStringOption(o => o
                .setName('url')
                .setDescription('The gif url')
                .setRequired(true)
            )
            .addUserOption(o => o
                .setName('user')
                .setDescription('Whose face are we swapping?')
                .setRequired(false)
            )
        )

]
await discord.put(
    Routes.applicationGuildCommands(applicationId, guildId),
    { body: commands.map((c) => c.toJSON()) },
);