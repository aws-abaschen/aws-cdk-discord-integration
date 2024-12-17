import { Aspects, CfnOutput, RemovalPolicy, SecretValue, Stack, StackProps } from "aws-cdk-lib";
import { AuthorizationType, LambdaIntegration, MethodLoggingLevel, RestApi } from "aws-cdk-lib/aws-apigateway";

import { PassthroughBehavior } from "aws-cdk-lib/aws-apigatewayv2";
import { Certificate, CertificateValidation, KeyAlgorithm } from "aws-cdk-lib/aws-certificatemanager";
import { AllowedMethods, CacheCookieBehavior, CacheHeaderBehavior, CachePolicy, CacheQueryStringBehavior, Distribution, LambdaEdgeEventType, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { RestApiOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { ManagedPolicy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { Architecture, CodeSigningConfig, Runtime } from "aws-cdk-lib/aws-lambda";
import { S3EventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { Bucket, EventType } from "aws-cdk-lib/aws-s3";
import { Platform, SigningProfile } from "aws-cdk-lib/aws-signer";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Chain, Choice, Condition, DefinitionBody, Fail, IChainable, JsonPath, LogLevel, Pass, Result, StateMachine, TaskInput } from "aws-cdk-lib/aws-stepfunctions";
import { LambdaInvoke, HttpInvoke, HttpMethod, } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { RustFunction } from 'cargo-lambda-cdk';
import { Construct } from "constructs";
import { NodetsFunction } from "./NodetsFunction";
import { StackDecorator } from "./StackDecorator";
import { Commands } from '../src/commands/handlers';
import { RouteBases, Routes } from 'discord-api-types/rest/v10';

export interface InteractionStackProps extends StackProps {
    domainName: string
    zoneDomain: string
    discordParametersRoot: string
    ssmKmsKeyArn: string
    discordPubKey: string
}


export class InteractionStack extends Stack {

    constructor(scope: Construct, id: string, props: InteractionStackProps) {
        super(scope, id, props);
        const paramkeys = ['applicationId', 'clientId', 'publicKey', 'botToken', 'clientSecret'];
        const discordParameters: { applicationId: string, clientId: string, publicKey: string, botToken: string, clientSecret: string } =
            ['applicationId', 'clientId', 'publicKey'].map(name => StringParameter.valueForStringParameter(this, `${props.discordParametersRoot}/${name}`))
                .concat(['botToken', 'clientSecret'].map(name => SecretValue.ssmSecure(`${props.discordParametersRoot}/${name}`).unsafeUnwrap()))
                .reduce((acc, cur, idx) => {
                    const key = paramkeys[idx];
                    acc[key] = cur;
                    return acc;
                }, {} as any);

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
            keyAlgorithm: KeyAlgorithm.EC_PRIME256V1
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
            defaultMethodOptions: {
                authorizationType: AuthorizationType.NONE
            },
            binaryMediaTypes: ['*/*']
        });

        const verifierLogGroup = new LogGroup(this, 'verifier-log-group', {
            logGroupName: '/discord/lambda/verifier',
            removalPolicy: RemovalPolicy.DESTROY
        });

        const verifierRole = new Role(this, 'verifier-role', {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
            inlinePolicies: {
                stateMachineAllow: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                            resources: [verifierLogGroup.logGroupArn]
                        })
                    ]
                })
            }
        });
        const verifier = new NodetsFunction(this, 'view', {
            entry: 'src/api/check-signature/src/main.ts',
            bundling: {
                define: {
                    'process.env.DISCORD_PUBLIC_KEY': `'${props.discordPubKey}'`
                }
            },
            architecture: Architecture.X86_64,
            memorySize: 128,
            description: 'Check body signature',
            runtime: Runtime.NODEJS_20_X,
            logGroup: verifierLogGroup,
            role: verifierRole
        });

        const distribution = new Distribution(this, 'distribution', {
            defaultBehavior: {
                origin: new RestApiOrigin(api),
                cachePolicy: new CachePolicy(this, 'discord-integration-cache-policy', {
                    cachePolicyName: 'DiscordIntegrationCachePolicy',
                    comment: 'Cache policy for Discord Integration',
                    enableAcceptEncodingGzip: true,
                    enableAcceptEncodingBrotli: true,
                    cookieBehavior: CacheCookieBehavior.none(),
                    headerBehavior: CacheHeaderBehavior.allowList("x-signature-timestamp", "x-signature-ed25519"),
                    queryStringBehavior: CacheQueryStringBehavior.none()
                }),
                allowedMethods: AllowedMethods.ALLOW_ALL,
                viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,

                edgeLambdas: [
                    {
                        functionVersion: verifier.currentVersion,
                        eventType: LambdaEdgeEventType.VIEWER_REQUEST,
                        includeBody: true
                    }
                ]
            },
            enableLogging: true,
            domainNames: [fqdn],
            certificate: certificate
        });
        //allow distribution to write in loggroup
        verifierLogGroup.grantWrite(new ServicePrincipal('logs.amazonaws.com'));

        //create a route 53 ARecord for the distribution
        new ARecord(this, 'aliasRecord', {
            zone: hostedZone,
            target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
            recordName: fqdn
        });

        const start = Chain.start(new Pass(this, 'PassState'));
        start.next(this.createChoices());

        const stateMachine = new StateMachine(this, 'discordIntegration-state-machine', {
            role: stepfunctionsExecuteRole,
            definitionBody: DefinitionBody.fromChainable(start),
            stateMachineName: 'discordIntegration-state-machine',
            //TODO subs
            //definitionSubstitutions: {},
            tracingEnabled: true,
            logs: {
                level: LogLevel.ALL, destination: new LogGroup(this, 'state-machine-log', {
                    removalPolicy: RemovalPolicy.DESTROY
                })
            },
        });

        const discordIntegrationResource = api.root.addResource('discord').addResource('interactions', {
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
            },
            //paramsAndSecrets: ParamsAndSecretsLayerVersion.fromVersionArn('arn:aws:lambda:eu-north-1:427196147048:layer:AWS-Parameters-and-Secrets-Lambda-Extension-Arm64:8')
        });

        discordIntegrationResource.addMethod('POST', new LambdaIntegration(fnDiscordToEvent, {
            passthroughBehavior: PassthroughBehavior.WHEN_NO_MATCH,
            proxy: true,
            requestTemplates: { 'application/octet-stream': '$input.body', 'application/json': '$input.body' },

        }));

        ///////////////////////////////////////////////////////////////////////////////////////
        //S3 Bucket for discord commands
        const s3Bucket = new Bucket(this, 'discord-command-definition', {
            autoDeleteObjects: true,
            removalPolicy: RemovalPolicy.DESTROY,
            enforceSSL: true
        });

        //output bucketName
        new CfnOutput(this, 'discord-command-definition-bucket-name', {
            value: s3Bucket.bucketName
        });

        const ssmKey = Key.fromKeyArn(this, 'kms-ssm-key', props.ssmKmsKeyArn)

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
                        //allow usage of KMS key alias/aws/ssm to decrypt Secure Parameter
                        new PolicyStatement({
                            actions: ['kms:Decrypt'],
                            resources: [ssmKey.keyArn]
                        }),
                        new PolicyStatement({
                            actions: ['ssm:GetParametersByPath'],
                            resources: [
                                `arn:${this.partition}:ssm:${this.region}:${this.account}:parameter${props.discordParametersRoot}/*`
                            ]
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
                DISCORD_PARAMS: props.discordParametersRoot
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

    }

    createChoices(): IChainable {
        const root = new Choice(this, 'sfn-choice-from-command', {
            comment: 'Choice state for command',
        });
        const after = new Pass(this, 'sfn-pass-after-choice', {
            comment: 'Pass state after choice'
        });
        const catchErrorToContent = new Pass(this, 'sfn-catch-to-json', {
            parameters: {
                error: JsonPath.stringToJson(JsonPath.stringAt('$.error.Cause')),
            },
            resultPath: '$.response'
        });

        Commands.forEach(handler => {
            const handlerLambda = new NodetsFunction(this, `lambda-${handler.name}`, {
                entry: `src/commands/handlers/${handler.name}.ts`,
                description: `Discord '${handler.name}' command handler`,
                functionName: `fn-discord-command-${handler.name}-queue`
            });
            root.when(Condition.stringEquals('$.interaction.command', handler.name),
                new LambdaInvoke(this, `sfn-invoke-${handler.name}`, {
                    lambdaFunction: handlerLambda,
                    resultPath: '$.response',
                    resultSelector: {
                        "content.$": "$.Payload.content"
                    },

                })
                    .addCatch(catchErrorToContent, { resultPath: '$.error' })
                    .next(after));
        });
        root.otherwise(new Fail(this, 'UnknownCommand', {
            error: 'UnknownCommand',
            cause: 'Unknown command'
        }));
        const send = new LambdaInvoke(this, 'sfn-send-webhook', {
            lambdaFunction: new NodetsFunction(this, 'sfn-lambda-send-webhook', {
                entry: 'src/commands/discord-webhook-handler.ts',
                description: 'Send webhook to discord',
                functionName: 'fn-discord-command-send-webhook-queue'
            }),
            payloadResponseOnly: true,

        });
        //send response anyway
        catchErrorToContent.next(send);
        after.next(send);
        return root;
    }
}