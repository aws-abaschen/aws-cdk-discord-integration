import { SQSEvent, SQSRecord } from "aws-lambda";
import { RouteBases, Routes } from 'discord-api-types/v10';

import { ResponseToDiscord } from "../../@types/Types";

export const handler = async (event: SQSEvent): Promise<any> => {
    await Promise.all(event.Records.map((record: SQSRecord) => {
        const { applicationId, token, data }: ResponseToDiscord = JSON.parse(record.body).responsePayload
        //using fetch, send a PATCH request to the webhook url with the response data
        console.log('sending response to discord', JSON.stringify(data))

        return fetch(`${RouteBases.api}/${Routes.webhook(applicationId, token)}`, {
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

    }));
}