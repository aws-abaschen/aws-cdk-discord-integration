import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { ChatInputApplicationCommandData, REST, Routes } from "discord.js";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { S3Event } from 'aws-lambda';
import 'source-map-support/register';

const s3 = new S3Client();
const ssm = new SecretsManagerClient();

const bucket = process.env.COMMAND_BUCKET;
const tokenSecretKey = process.env.DISCORD_AUTH_SECRET;
let authSecret: string | undefined;
try {
    const resp = await ssm.send(new GetSecretValueCommand({
        SecretId: tokenSecretKey,

    }));
    authSecret = resp.SecretString;
} catch (error) {
    // For a list of exceptions thrown, see
    // https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html
    throw error;
}

if (!authSecret) {
    throw new Error(`invalid or missing discord token (secret: ${tokenSecretKey})`);
}
if (!bucket)
    throw new Error("missing bucket name env COMMAND_BUCKET");
const { applicationId, botToken } = JSON.parse(authSecret);

const discord = new REST().setToken(botToken);
export const handler = async (event: S3Event): Promise<any> => {

    // Get the object from the event and show its content type
    for (let i = 0; i < event.Records.length; i++) {
        const { s3: { object } } = event.Records[i];
        const key = decodeURIComponent(object.key.replace(/\+/g, ' '));
        if (!key.endsWith('.json')) {
            console.error('Invalid object key suffix');
        } else {
            const params = {
                Bucket: bucket,
                Key: key,
            };
            const guildId = key.replace(/\\.json$/, '')
            let bucketData: string | undefined;
            try {
                const response = await s3.send(new GetObjectCommand(params));
                bucketData = await response.Body?.transformToString();
            } catch (err) {
                console.log(err);
                const message = `Error getting object ${key} from bucket ${bucket}. Make sure they exist and your bucket is in the same region as this function.`;
                console.log(message);
                throw new Error(message);
            }
            try {
                if (bucketData) {
                    const commands: ChatInputApplicationCommandData[] = JSON.parse(bucketData);
                    await discord.put(
                        Routes.applicationGuildCommands(applicationId, guildId),
                        { body: commands },
                    );

                } else {
                    console.error('empty bucket')
                }
            } catch (err) {
                console.log(err);
                const message = `Error setting command`;
                console.log(message);
                throw new Error(message);
            }
        }
    };
};