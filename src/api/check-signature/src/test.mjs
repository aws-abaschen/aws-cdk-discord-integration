import nacl from "tweetnacl-es6";

const test = {
    body: 'eyJhcHBfcGVybWlzc2lvbnMiOiI1NjI5NDk5NTM2MDE1MzYiLCJhcHBsaWNhdGlvbl9pZCI6Ijk4OTE5NTk4MjUzMTA5NjYxNiIsImF1dGhvcml6aW5nX2ludGVncmF0aW9uX293bmVycyI6e30sImVudGl0bGVtZW50cyI6W10sImlkIjoiMTMwOTYwOTYwMjI2MTk3OTE2OSIsInRva2VuIjoiYVc1MFpYSmhZM1JwYjI0Nk1UTXdPVFl3T1RZd01qSTJNVGszT1RFMk9UcFdVVkJ2Y1RFNVNrVk1XRFV4U1VOSVIzZExWbkZJTTJsM2NsVmlPVWg0ZDFkc2RWZGlPVVpYWm05aVl6TkZSVk5ZYTBNeFkwMDBOSE5UV2xVMFRFUldVR3hyVnpCblNIUk5ibmxwTjFWSlltMW1Za05GTVVOclR6RndkRXBSZFZSVk9XaFhXVUZPY1VkSldFcHNZVXhHZUhSUFJUUm5TRVI2Um5kc1dGSXhaUSIsInR5cGUiOjEsInVzZXIiOnsiYXZhdGFyIjoiYzZhMjQ5NjQ1ZDQ2MjA5ZjMzNzI3OWNkMmNhOTk4YzciLCJhdmF0YXJfZGVjb3JhdGlvbl9kYXRhIjpudWxsLCJib3QiOnRydWUsImNsYW4iOm51bGwsImRpc2NyaW1pbmF0b3IiOiIwMDAwIiwiZ2xvYmFsX25hbWUiOiJEaXNjb3JkIiwiaWQiOiI2NDM5NDUyNjQ4NjgwOTgwNDkiLCJwcmltYXJ5X2d1aWxkIjpudWxsLCJwdWJsaWNfZmxhZ3MiOjEsInN5c3RlbSI6dHJ1ZSwidXNlcm5hbWUiOiJkaXNjb3JkIn0sInZlcnNpb24iOjF9',
    timestamp: '1732305661',
    signature: '8fc6d56c4a5900a219ea5c68aee2f70069e2396505b24c9c575e00b5298fe6f53295b3a7aea8abc987e1b40ba8f59ce8eaf0ade92b89ee4ab7bccf459d09710f'
}
const PUBLIC_KEY = 'e16dd6b9e483616672cfa1e9982c9027857d9d60e18e03b73eb26f0a11273233'
// const rawbody = Buffer.from(test.body, 'base64');
// const body = rawbody.toString();
// console.log(body);

// const message = Buffer.from(test.timestamp + body);

// const isVerified = nacl.sign.detached.verify(
//     message,
//     Buffer.from(test.signature, "hex"),
//     Buffer.from(pubkey, "hex")
// );


// if (isVerified)
//     console.log('ok');
// else console.error('fail to verify request');

// Your public key can be found on your application in the Developer Portal

const signature = test.signature;
const timestamp = test.timestamp;
const rawbody = Buffer.from(test.body, 'base64');
const body = rawbody.toString();

const isVerified = nacl.sign.detached.verify(
    Buffer.from(timestamp + body),
    Buffer.from(signature, "hex"),
    Buffer.from(PUBLIC_KEY, "hex")
);

if (!isVerified) {
    console.log('fail to verify request');
}
