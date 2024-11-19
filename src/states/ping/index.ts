import { SNSEvent } from "aws-lambda";
import { ResponseToDiscord } from "../../../Types";

const response = { content: 'hello there' };
/**
 * function triggered by a ping discord command that will write an event to the response queue
 */
export const handler = async (event: SNSEvent): Promise<ResponseToDiscord> => {
    const { MessageAttributes } = event.Records[0].Sns;
    // https://docs.aws.amazon.com/lambda/latest/dg/with-sns-create-package.html
    const {
        token: { Value: token },
        applicationId: { Value: applicationId }
    } = MessageAttributes;

    try {
        console.log(`responding to ping for ${applicationId}`);
        return {
            token: token,
            applicationId: applicationId,
            response

        };
    } catch (e) {
        console.log(e);
        throw new Error('could not send to queue');
    }

}