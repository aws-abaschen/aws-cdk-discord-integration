#!/usr/bin/env -S yarn tsx
import { InteractionStack } from './DiscordIntegrationStack';

import { App } from "aws-cdk-lib";
import 'dotenv/config';

if (!process.env.DOMAIN_NAME) {
  console.error('missing environment variable DOMAIN_NAME')
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
  zoneDomain: process.env.DOMAIN_NAME
});


