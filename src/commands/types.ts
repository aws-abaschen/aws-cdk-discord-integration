import { InteractionType, APIInteractionResponse, RESTPostAPIWebhookWithTokenJSONBody } from "discord-api-types/v10";
import { SlashCommandBuilder } from "discord.js";

export type InteractionEvent = {
    interactionToken: string
    channel: string
    guildId: string
    applicationId: string
    interactionId: string
    memberId: string
    memberUsername: string
    type: InteractionType
    data?: any
}

export interface DiscordHandler {
    name: string,
    command: SlashCommandBuilder,
    execute: (input: { interaction: InteractionEvent }) => Promise<RESTPostAPIWebhookWithTokenJSONBody>
}