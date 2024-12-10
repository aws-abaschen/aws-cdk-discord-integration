#!/usr/bin/env -S yarn tsx
import { InteractionStack } from './DiscordIntegrationStack';

import { App } from "aws-cdk-lib";
import 'dotenv/config';

if (!process.env.DOMAIN_NAME) {
  console.error('missing environment variable DOMAIN_NAME')
  process.exit(2);
}

if (!process.env.PARAMETERS_ROOT || !process.env.SSM_KMS_KEY_ARN) {
  console.error('missing environment variable PARAMETERS_ROOT or SSM_KMS_KEY_ARN')
  process.exit(2);
}

if (!process.env.DISCORD_PUB_KEY) {
  console.error('missing environment variable DISCORD_PUB_KEY')
  process.exit(2);
}

const app = new App();
const defaultProps = {
  env: {
    account: process.env.AWS_ACCOUNT,
    region: process.env.AWS_REGION ?? 'eu-north-1',
  },
};
const base = new InteractionStack(app, 'discord-integration', {
  ...defaultProps,
  domainName: process.env.SUBDOMAIN_NAME ?? 'bot',
  zoneDomain: process.env.DOMAIN_NAME,
  discordParametersRoot: process.env.PARAMETERS_ROOT,
  ssmKmsKeyArn: process.env.SSM_KMS_KEY_ARN,
  discordPubKey: process.env.DISCORD_PUB_KEY
});


