import { RESTPostAPIWebhookWithTokenJSONBody } from "discord-api-types/v10";
import { SlashCommandBuilder } from "discord.js";
import { InteractionEvent } from "../types";

export const handler = async (input: { interaction: InteractionEvent }): Promise<RESTPostAPIWebhookWithTokenJSONBody> => {
    throw new Error('You failed, and it\' awesome');
}
const name = "fail";
export default {
    name,
    command: new SlashCommandBuilder().setName(name).setDescription('Fail at doing nothing, you\'ve been warned'),
    execute: handler
};

