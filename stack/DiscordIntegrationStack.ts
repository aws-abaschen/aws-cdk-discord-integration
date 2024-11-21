import { Aspects, CfnOutput, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { AuthorizationType, LambdaIntegration, MethodLoggingLevel, RestApi } from "aws-cdk-lib/aws-apigateway";

import { Certificate, CertificateValidation, KeyAlgorithm } from "aws-cdk-lib/aws-certificatemanager";
import { ManagedPolicy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Code, CodeSigningConfig, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { S3EventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { ApiGateway } from "aws-cdk-lib/aws-route53-targets";
import { Bucket, EventType } from "aws-cdk-lib/aws-s3";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Platform, SigningProfile } from "aws-cdk-lib/aws-signer";
import { DefinitionBody, LogLevel, StateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";
import { StackDecorator } from "./StackDecorator";
import { NodetsFunction } from "./NodetsFunction";
import { RustFunction } from 'cargo-lambda-cdk';

export interface InteractionStackProps extends StackProps {
    domainName: string
    zoneDomain: string
}


export class InteractionStack extends Stack {

    constructor(scope: Construct, id: string, props: InteractionStackProps) {
        super(scope, id, props);

        const discordIntegrationSecret = Secret.fromSecretNameV2(this, 'DiscordIntegrationSecret', 'discord/integration');

        const signingProfile = new SigningProfile(this, 'SigningProfile', {
            platform: Platform.AWS_LAMBDA_SHA384_ECDSA,
        });

        const codeSigningConfig = new CodeSigningConfig(this, 'CodeSigningConfig', {
            signingProfiles: [signingProfile],
        });

        Aspects.of(this).add(new StackDecorator());

        const fqdn = `${props.domainName}.${props.zoneDomain}`;
        const hostedZone = HostedZone.fromLookup(this, 'apiHostedZone', {
            domainName: props.zoneDomain,
            privateZone: false
        });

        const certificate = new Certificate(this, `${fqdn}-crt`, {
            domainName: fqdn,
            validation: CertificateValidation.fromDns(hostedZone),
            certificateName: fqdn,
            subjectAlternativeNames: [fqdn],
            keyAlgorithm: KeyAlgorithm.EC_SECP384R1
        });

        // new Metric({
        //     namespace: 'AWS/Route53',
        //     metricName: 'DNSQueries',
        //     dimensionsMap: {
        //         HostedZoneId: hostedZone.hostedZoneId
        //     },
        // });

        //create standard lambda execution role
        const apiGatewayExecuteRole = new Role(this, `DiscordIntegrationRestAPIRole`, {
            assumedBy: new ServicePrincipal('apigateway.amazonaws.com'),
            description: 'DiscordIntegration - Role for RestAPI'
        });
        const stepfunctionsExecuteRole = new Role(this, `DiscordIntegrationStateMachineRole`, {
            assumedBy: new ServicePrincipal('states.amazonaws.com'),
            description: 'DiscordIntegration - Role for StateMachine'
        });

        const api = new RestApi(this, 'bot-rest-api', {
            deployOptions: {
                stageName: 'v1',
                dataTraceEnabled: true,
                loggingLevel: MethodLoggingLevel.INFO,
                metricsEnabled: true,
                tracingEnabled: true,
            },
            domainName: {
                domainName: fqdn,
                certificate
            },
            defaultMethodOptions: {
                authorizationType: AuthorizationType.NONE
            },
            // defaultCorsPreflightOptions: {
            //     allowOrigins: ['discord.com', 'discordapi.com'],
            //     allowMethods: ["POST", "GET"]
            // }
        });
        const aRecord = new ARecord(this, `${props.domainName}-record`, {
            target: RecordTarget.fromAlias(new ApiGateway(api)),
            recordName: fqdn,
            zone: hostedZone
        });

        const stateMachine = new StateMachine(this, 'discordIntegration-state-machine', {
            role: stepfunctionsExecuteRole,
            definitionBody: DefinitionBody.fromFile('src/discord-state-machine.json'),
            //TODO subs
            //definitionSubstitutions: {},
            tracingEnabled: true,
            logs: {
                level: LogLevel.ALL, destination: new LogGroup(this, 'state-machine-log', {
                    removalPolicy: RemovalPolicy.DESTROY
                })
            },
        });

        const discordIntegrationResource = api.root.addResource('discord', {
            defaultCorsPreflightOptions: {
                allowOrigins: ['discord.com', 'discordapi.com'],
                allowMethods: ["POST"]
            }
        });
        const lambdaApiSrc = 'src/api';
        const fnDiscordToEvent_Role = new Role(this, `fn-role-discord-to-event`, {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
            inlinePolicies: {
                stateMachineAllow: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            actions: ['states:StartExecution'],
                            resources: [stateMachine.stateMachineArn]
                        })
                    ]
                })
            }
        });
        const fnDiscordToEvent = new RustFunction(this, 'discordToEventFunction', {
            manifestPath: `${lambdaApiSrc}/post-discord-to-event/Cargo.toml`,
            memorySize: 256,
            description: 'Register event from Discord',
            role: fnDiscordToEvent_Role,
            environment: {
                STATE_MACHINE_ARN: stateMachine.stateMachineArn,
                PUBLIC_KEY: discordIntegrationSecret.secretValueFromJson('publicKey').unsafeUnwrap()
            },
            //paramsAndSecrets: ParamsAndSecretsLayerVersion.fromVersionArn('arn:aws:lambda:eu-north-1:427196147048:layer:AWS-Parameters-and-Secrets-Lambda-Extension-Arm64:8')
        });

        discordIntegrationSecret.grantRead(fnDiscordToEvent);
        discordIntegrationResource.addMethod('POST', new LambdaIntegration(fnDiscordToEvent));

        ///////////////////////////////////////////////////////////////////////////////////////
        //S3 Bucket for discord commands
        const s3Bucket = new Bucket(this, 'discord-command-definition', {
            autoDeleteObjects: true,
            removalPolicy: RemovalPolicy.DESTROY,
            enforceSSL: true
        });

        const fnRegisterDiscordCommands_Role = new Role(this, `fn-role-register-discord-command`, {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
            inlinePolicies: {
                stateMachineAllow: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            actions: ['states:StartExecution'],
                            resources: [stateMachine.stateMachineArn]
                        })
                    ]
                }),
                readDiscordSecret: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            actions: ['secretsmanager:GetSecretValue'],
                            resources: [discordIntegrationSecret.secretArn]
                        })
                    ]
                }),
                readCommandS3Bucket: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            actions: ['s3:GetObject'],
                            resources: [`${s3Bucket.bucketArn}/*`]
                        })
                    ]
                })
            }
        });

        const fnRegisterDiscordCommands = new NodetsFunction(this, 'registerDiscordCommands', {
            entry: 'src/events/s3-put-discord-command/index.ts',
            description: 'Register discord commands from s3 bucket',
            role: fnRegisterDiscordCommands_Role,
            logGroup: new LogGroup(this, 's3PutDiscordCommandLog', { logGroupName: '/discord/events/s3/put-discord-command' }),
            environment: {
                COMMAND_BUCKET: s3Bucket.bucketArn,
                DISCORD_AUTH_SECRET: discordIntegrationSecret.secretName
            }
        });

        // listen to bucket object event put
        const s3PutEventSource = new S3EventSource(s3Bucket, {
            events: [
                EventType.OBJECT_CREATED_PUT
            ],
            filters: [{ suffix: '.json' }]
        });

        fnRegisterDiscordCommands.addEventSource(s3PutEventSource);
        ///////////////////////////////////////////////////////////////////////

        ///// Back channel

        // readdirSync('src/states/', { withFileTypes: true })
        //     .filter(dirent => dirent.isDirectory())
        //     .map(dirent => dirent.name)
        //     .map(name => {
        //         const custom = fnCommandsCustomProps[name];
        //         const lambdaProps = custom?.props ?? { ...this.lambdaDefault };
        //         const onCreate = custom?.onCreate;
        //         const fn = new NodetsFunction(this, `fn-discord-command-${name}-queue`, {
        //             ...lambdaProps,
        //             entry: `discord/commands/${name}/index.ts`,
        //             description: `Discord '${name}' command handler`,
        //             functionName: `fn-discord-command-${name}-queue`,
        //             role: this.createLambdaRole(`DiscordCommand${name}`),
        //             onSuccess: new SqsDestination(this.sendToDiscordQueue),
        //             onFailure: new SqsDestination(failedCommandHandlerQueue.queue),
        //         });

        //         // SNS command==ping to fnSNSPingCommandToSQS
        //         const deadletter = createDeadletter(this, `not-delivered-discord-command-${name}`).queue;
        //         this.topic.addSubscription(new LambdaSubscription(fn, {
        //             filterPolicy: {
        //                 command: SubscriptionFilter.stringFilter({
        //                     allowlist: [name]
        //                 }),
        //             },
        //             deadLetterQueue: deadletter
        //         }));
        //         //deadletter.grantSendMessages(this.topic.topicArn);
        //         this.commands[name] = fn;
        //         if (onCreate) onCreate(fn);
        //         return fn;
        //     });

        // //monitor unknown commands
        // const unknownDiscord = createSqs(this, 'unknown-discord-command', {
        // })
        // this.topic.addSubscription(new SqsSubscription(unknownDiscord, {
        //     filterPolicy: {
        //         command: SubscriptionFilter.stringFilter({
        //             denylist: Object.keys(this.commands)
        //         }),
        //     },
        // }));

        // // API to fnDiscordToEvent
        // this.fnDiscordToEvent.grantInvoke(apiGatewayExecuteRole);
        // entrypoint.addMethod('POST', new LambdaIntegration(this.fnDiscordToEvent, {
        //     credentialsRole: apiGatewayExecuteRole,
        //     //official discord timeout for interaction
        //     timeout: Duration.seconds(10)
        // }));


        // // fnDiscordToEvent to SNS topic
        // this.topic.grantPublish(this.fnDiscordToEvent);

        //show some relevant outputs
        new CfnOutput(this, 'DiscordIntegrationSecretArn', { value: discordIntegrationSecret.secretArn });
        // bot domain record
        new CfnOutput(this, 'BotDomain', { value: aRecord.domainName });
    }
}