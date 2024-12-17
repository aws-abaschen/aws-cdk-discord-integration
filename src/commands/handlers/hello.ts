import { SlashCommandBuilder } from "discord.js";
import { InteractionEvent } from "../types";
import { RESTPostAPIWebhookWithTokenJSONBody } from "discord-api-types/v10";

export const handler = async (input: { interaction: InteractionEvent }): Promise<RESTPostAPIWebhookWithTokenJSONBody> => {
    const response: RESTPostAPIWebhookWithTokenJSONBody = {
        content: `Hello <@${input.interaction.memberId}>!`,
    };
    return response;
}
const name = 'hello';

export default {
    name,
    command: new SlashCommandBuilder().setName(name).setDescription('Say hello'),
    execute: handler
};

