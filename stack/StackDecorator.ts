import { CfnResource, IAspect, RemovalPolicy, Resource, TagManager } from "aws-cdk-lib";
import { IConstruct } from "constructs";

export class StackDecorator implements IAspect {

    visit(node: IConstruct) {
        if (node instanceof Resource) {
            if (TagManager.isTaggable(node)) {
                console.log('adding resource:type ' + node.constructor.name);
                node.tags.setTag('resource:type', node.constructor.name);
            }

        }
        if (node instanceof CfnResource || (node instanceof Resource && node.node.defaultChild)) {
            try {
                node.applyRemovalPolicy(RemovalPolicy.DESTROY);
            } catch (error) {
                console.warn('cannot apply RemovalPolicy to ' + node.constructor.name + '/' + node.node.id);
            }
        }

        if (TagManager.isTaggable(node)) {
            node.tags.setTag('app', 'chatbot');
        }

    }
}