import { APIInteractionResponseChannelMessageWithSource, InteractionResponseType, MessageFlags, RESTPostAPIWebhookWithTokenJSONBody, Routes } from "discord-api-types/v10";
import { InteractionEvent } from "./types";
import { error } from "console";


const method = 'POST';
const base = 'https://discord.com/api';
export const handler = async (input: { interaction: InteractionEvent, response: { error?: { errorMessage: string } } & RESTPostAPIWebhookWithTokenJSONBody }) => {
    const { applicationId, interactionToken } = input.interaction;
    const res = input.response.error ? { content: input.response.error.errorMessage } : input.response
    const message: APIInteractionResponseChannelMessageWithSource = {
        type: InteractionResponseType.ChannelMessageWithSource,
        ...res,
        data: {

        }
    };

    console.log(`${method} ${base}${Routes.webhook(applicationId, interactionToken)}`, JSON.stringify(message));
    const response = await fetch(`${base}${Routes.webhook(applicationId, interactionToken)}`, {
        method,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
    });
    if (!response.ok) {
        console.error(response.json())
        throw new Error(`Response status: ${response.status}`);
    }

    return await response.json();

};
