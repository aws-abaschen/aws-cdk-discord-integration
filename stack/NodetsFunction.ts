import { SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { Architecture, Runtime, RuntimeFamily, Tracing } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, NodejsFunctionProps, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";


export interface NodetsFunctionProps extends NodejsFunctionProps {
    securityGroups?: SecurityGroup[]
}

export class NodetsFunction extends NodejsFunction {

    constructor(scope: Construct, id: string, props: NodetsFunctionProps) {
        super(scope, id, {
            architecture: Architecture.ARM_64,
            runtime: new Runtime('nodejs22.x', RuntimeFamily.NODEJS, { supportsInlineCode: true }),
            memorySize: 512,
            tracing: Tracing.ACTIVE,
            handler: 'index.handler',
            retryAttempts: 0,
            ...props,
            bundling: {
                minify: true,
                banner: 'import { createRequire } from \'module\'; const require = createRequire(import.meta.url);',
                mainFields: ['module', 'main'],
                target: 'node22',
                format: OutputFormat.ESM,
                ...props.bundling,
            },
        });
    }
}