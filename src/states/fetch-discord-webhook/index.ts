import { RouteBases, Routes } from 'discord-api-types/v10';

import { ResponseToDiscord } from '_types/discord-events.js'

export const handler = async (event: ResponseToDiscord): Promise<any> => {
        const { applicationId, data, webhookToken } = event;
        return fetch(`${RouteBases.api}/${Routes.webhook(applicationId, webhookToken)}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ...data,
                data: {
                    flags: []
                }
            })
        });

}