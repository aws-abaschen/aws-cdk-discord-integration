import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetParametersByPathCommand, GetParametersByPathCommandOutput, SSMClient } from "@aws-sdk/client-ssm";
import { S3Event } from 'aws-lambda';
import { ChatInputApplicationCommandData, REST, Routes } from "discord.js";
import 'source-map-support/register';

const s3 = new S3Client();
//create ssm client
const ssm = new SSMClient();

const bucket = process.env.COMMAND_BUCKET;
const discordParams = process.env.DISCORD_PARAMS;
let authSecrets;
try {
    const resp: GetParametersByPathCommandOutput = await ssm.send(new GetParametersByPathCommand({
        Path: `${discordParams}/`,
        WithDecryption: true
    }));

    authSecrets = resp.Parameters?.reduce((acc, param) => {
        const key: string = param.Name?.split('/').pop() as string;
        if (!key) return acc;
        acc[key] = param.Value ?? "";
        return acc;
    }, {} as { [key: string]: string });
} catch (error) {
    // For a list of exceptions thrown, see
    // https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html
    throw error;
}

if (!authSecrets) {
    throw new Error(`invalid or missing discord token`);
}
if (!bucket)
    throw new Error("missing bucket name env COMMAND_BUCKET");
const { applicationId, botToken } = authSecrets;

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