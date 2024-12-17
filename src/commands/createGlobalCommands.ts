import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as fs from "node:fs";
import { Commands } from './handlers';
const globalCommandsJsonString = JSON.stringify(Commands.map(o => o.command).map(command => command.toJSON()));
//fs.writeFileSync('global.json', globalCommandsJsonString);

// push file to s3

//readbucket name from cdk metadata
const cdkMetadata = JSON.parse(fs.readFileSync('cdk.out/output.json', 'utf8'));
const bucket = cdkMetadata['discord-integration']['discordcommanddefinitionbucketname'];
const key = 'global.json';
const client = new S3Client({
    region: process.env.AWS_REGION
});

try {
    const res = await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: globalCommandsJsonString
    }));
    console.log(res);
} catch (error) {
    console.log(error);
}