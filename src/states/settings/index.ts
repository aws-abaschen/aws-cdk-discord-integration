import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { SNSEvent } from 'aws-lambda'
import { Client } from 'pg'
import { ResponseToDiscord } from '../../../Types'

const client = new SecretsManagerClient({});
const secret = await client.send(
    new GetSecretValueCommand({
        SecretId: process.env.databaseSecretArn,
    })
)
const secretValues = JSON.parse(secret.SecretString ?? '{}')

console.log('got secret for user ' + secretValues.username);


export const handler = async (event: SNSEvent): Promise<ResponseToDiscord> => {
    // connect to the database
    const db = new Client({
        host: secretValues.host,
        port: secretValues.port,
        user: secretValues.username,
        password: secretValues.password,
        database: 'chatbot'
    });
    const { MessageAttributes } = event.Records[0].Sns;
    // https://docs.aws.amazon.com/lambda/latest/dg/with-sns-create-package.html
    const {
        token: { Value: token },
        applicationId: { Value: applicationId }
    } = MessageAttributes;
    console.log('Connecting to ' + secretValues.host);
    await db.connect();
    console.log('Connected');
    // execute a query
    const res = await db.query('SELECT NOW()')
    console.log(res.rows[0].now);

    // disconnect from the database
    await db.end()

    return { applicationId, token, response: { content: 'db date: ' + res.rows[0].now } }
}
