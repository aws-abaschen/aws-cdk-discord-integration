import { SlashCommandBuilder } from 'discord.js';
import * as fs from "node:fs";
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
const globalCommands = [
    new SlashCommandBuilder()
        .setName('ping').setDescription('Replies with pong!')
        .addBooleanOption(o =>
            o.setName('deferred').setDescription('Get a pong from the complete workflow')
        )
];
const globalCommandsJson = globalCommands.map(command => command.toJSON());
const globalCommandsJsonString = JSON.stringify(globalCommandsJson);
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