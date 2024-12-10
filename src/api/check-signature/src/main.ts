import {
  CloudFrontHeaders,
  CloudFrontRequestEvent,
  CloudFrontRequestHandler,
  CloudFrontRequestResult,
  CloudFrontResultResponse
} from 'aws-lambda';
import { Buffer } from 'node:buffer';
import { verifyKey } from './crypto';

const pubKey: string = process.env.DISCORD_PUBLIC_KEY ?? '';

export const handler: CloudFrontRequestHandler = async (event: CloudFrontRequestEvent): Promise<CloudFrontRequestResult> => {
  const cf = event.Records[0].cf;
  const { headers, body, ...req }: { headers: CloudFrontHeaders, body?: { data: string } } = cf.request;
  console.log({
    body: body?.data ?? '',
    timestamp: headers["x-signature-timestamp"]?.[0].value,
    signature: headers["x-signature-ed25519"]?.[0].value
  })
  if (!body || headers["x-signature-timestamp"]?.length !== 1 || headers["x-signature-ed25519"]?.length !== 1) {
    console.log("Invalid request");
    console.log(JSON.stringify({ headers, ...req }));
    return {
      status: '400',
      body: JSON.stringify({ errorMessage: "Invalid request" })
    };
  }
  let isVerified = false;
  const checksum = {
    sig: headers["x-signature-ed25519"][0].value,
    timestamp: headers["x-signature-timestamp"][0].value
  };
  const hexBody = Buffer.from(body.data, "base64");
  try {
    isVerified = await verifyKey(
      hexBody,
      checksum.sig,
      checksum.timestamp,
      pubKey
    );
  } catch (e) {
    console.log(e);
    isVerified = false
  }
  if (!isVerified) {
    console.error('invalid-signature');
    return {
      status: '401',
      body: JSON.stringify({ errorMessage: "invalid signature" })
    };
  }

  const { type } = JSON.parse(hexBody.toString('utf8'));

  console.log(`responding to command ${type}`)
  if (type === 1) {
    const response: CloudFrontResultResponse = {
      status: '200',
      body: JSON.stringify({ type: 1 })
    };

    return response;
  }
  return cf.request;
}
