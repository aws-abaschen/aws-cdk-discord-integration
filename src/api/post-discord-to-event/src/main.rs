use async_once::AsyncOnce;
use aws_config::BehaviorVersion;
use aws_sdk_sfn::Client;
use ed25519_dalek::{Signature, VerifyingKey};
use lambda_http::{http::HeaderMap, run, service_fn, Body, Error, Request};

use lazy_static::lazy_static;
use rusty_interaction::types::interaction::{
    Interaction, InteractionResponseType, InteractionType,
};
use serde_json::{json, Value};
use std::env;

lazy_static! {
    static ref STATE_MACHINE_ARN: String = env::var("STATE_MACHINE_ARN")
        .map_err(|_| "STATE_MACHINE_ARN must be set")
        .unwrap_or_else(|e| {
            eprintln!("Error: {}", e);
            std::process::exit(1)
        });
    static ref VERIFIER: Verifier = {
        let public_key_bytes = env::var("PUBLIC_KEY")
            .map_err(|_| "PUBLIC_KEY must be set")
            .unwrap_or_else(|e| {
                eprintln!("Error: {}", e);
                std::process::exit(1)
            });
        Verifier::new(&public_key_bytes)
    };
    

    static ref PONG_RESPONSE: Value = json!({
        "statusCode": 200,
        "body": json!({
            "type": InteractionResponseType::Pong,
        }).to_string()
    });

    static ref PROCESSING_RESPONSE: Value = json!({
        "statusCode": 200,
        "body": json!({
            "type": InteractionResponseType::DefferedChannelMessageWithSource,
            "data": {
                "content": "processing..."
            }
        }).to_string()
    });

    static ref ERROR_STARTING_SFN: Value = json!({
        "statusCode": 200,
        "type": 4,
            "data": {
                "content": "error starting step function"
            }
        }
    );
    
    static ref SFN_CLIENT: AsyncOnce<Client> = AsyncOnce::new(async {
        let config = aws_config::load_defaults(BehaviorVersion::latest()).await;
        Client::new(&config)
    });
}

/// Parses a hex string into an array of `[u8]`
fn parse_hex<const N: usize>(s: &str) -> Option<[u8; N]> {
    if s.len() != N * 2 {
        return None;
    }

    let mut res = [0; N];
    for (i, byte) in res.iter_mut().enumerate() {
        *byte = u8::from_str_radix(s.get(2 * i..2 * (i + 1))?, 16).ok()?;
    }
    Some(res)
}

/// The byte array couldn't be parsed into a valid cryptographic public key.
#[derive(Debug)]
pub struct InvalidKey(ed25519_dalek::SignatureError);
impl std::fmt::Display for InvalidKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "invalid bot public key: {}", self.0)
    }
}
impl std::error::Error for InvalidKey {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.0)
    }
}

#[derive(Clone)]
pub struct Verifier {
    public_key: ed25519_dalek::VerifyingKey,
}

impl Verifier {
    /// Creates a new [`Verifier`] from the given public key hex string.
    ///
    /// Panics if the given key is invalid. For a low-level, non-panicking variant, see
    /// [`Self::try_new()`].
    #[must_use]
    pub fn new(public_key: &str) -> Self {
        Self::try_new(parse_hex(public_key).expect("public key must be a 64 digit hex string"))
            .expect("invalid public key")
    }

    /// Creates a new [`Verifier`] from the public key bytes.
    ///
    /// # Errors
    ///
    /// [`InvalidKey`] if the key isn't cryptographically valid.
    pub fn try_new(public_key: [u8; 32]) -> Result<Self, InvalidKey> {
        Ok(Self {
            public_key: VerifyingKey::from_bytes(&public_key).map_err(InvalidKey)?,
        })
    }

    /// Verifies a Discord request for authenticity, given the `X-Signature-Ed25519` HTTP header,
    /// `X-Signature-Timestamp` HTTP headers and request body.
    // We just need to differentiate "pass" and "failure". There's deliberately no data besides ().
    pub fn verify(&self, signature: &str, timestamp: &str, body: &[u8]) -> Result<(), ()> {
        use ed25519_dalek::Verifier as _;
        //trace body in the execution

        // Extract and parse signature
        let signature_bytes = parse_hex(signature).ok_or(())?;
        let sig = Signature::from_bytes(&signature_bytes);

        // Verify
        tracing::trace!("sig: {:?}", signature);
        tracing::trace!("timestamp: {:?}", timestamp);
        tracing::trace!("body: {:?}", body);

        let message_to_verify = [timestamp.as_bytes(), body].concat();
        self.public_key
            .verify(&message_to_verify, &sig)
            .map_err(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_hex() {
        assert_eq!(parse_hex::<4>("bf7dea78"), Some([0xBF, 0x7D, 0xEA, 0x78]));
        assert_eq!(parse_hex::<4>("bf7dea7"), None);
        assert_eq!(parse_hex::<4>("bf7dea789"), None);
        assert_eq!(parse_hex::<4>("bf7dea7x"), None);
        assert_eq!(parse_hex(""), Some([]));
    }

    #[test]
    fn test_parse_public_key() {
        assert_eq!(
            parse_hex::<32>("e16dd6b9e483616672cfa1e9982c9027857d9d60e18e03b73eb26f0a11273233"),
            Some([
                0xE1, 0x6D, 0xD6, 0xB9, 0xE4, 0x83, 0x61, 0x66, 0x72, 0xCF, 0xA1, 0xE9, 0x98, 0x2C,
                0x90, 0x27, 0x85, 0x7D, 0x9D, 0x60, 0xE1, 0x8E, 0x03, 0xB7, 0x3E, 0xB2, 0x6F, 0x0A,
                0x11, 0x27, 0x32, 0x33
            ])
        );
        assert_eq!(
            Verifier::new("e16dd6b9e483616672cfa1e9982c9027857d9d60e18e03b73eb26f0a11273233")
                .public_key,
            Verifier::try_new([
                0xE1, 0x6D, 0xD6, 0xB9, 0xE4, 0x83, 0x61, 0x66, 0x72, 0xCF, 0xA1, 0xE9, 0x98, 0x2C,
                0x90, 0x27, 0x85, 0x7D, 0x9D, 0x60, 0xE1, 0x8E, 0x03, 0xB7, 0x3E, 0xB2, 0x6F, 0x0A,
                0x11, 0x27, 0x32, 0x33
            ])
            .unwrap()
            .public_key
        );
    }

    //test validate discord signature
    #[test]
    fn test_validate_discord_signature() {
        let sig_ed25519 = "ced5a01161acd1cb3115abe922b5ebf1acff00f7f08175ab71ff5da03fafaf1a16c99f263cfbc616bf4c977e3d0720ad40d3e100aa5db1ab3a492ed453b53e0f";
        let sig_timestamp = "1732187098";
        let body = [123, 34, 97, 112, 112, 95, 112, 101, 114, 109, 105, 115, 115, 105, 111, 110, 115, 34, 58, 34, 53, 54, 50, 57, 52, 57, 57, 53, 51, 54, 48, 49, 53, 51, 54, 34, 44, 34, 97, 112, 112, 108, 105, 99, 97, 116, 105, 111, 110, 95, 105, 100, 34, 58, 34, 57, 56, 57, 49, 57, 53, 57, 56, 50, 53, 51, 49, 48, 57, 54, 54, 49, 54, 34, 44, 34, 97, 117, 116, 104, 111, 114, 105, 122, 105, 110, 103, 95, 105, 110, 116, 101, 103, 114, 97, 116, 105, 111, 110, 95, 111, 119, 110, 101, 114, 115, 34, 58, 123, 125, 44, 34, 101, 110, 116, 105, 116, 108, 101, 109, 101, 110, 116, 115, 34, 58, 91, 93, 44, 34, 105, 100, 34, 58, 34, 49, 51, 48, 57, 49, 49, 50, 51, 49, 53, 53, 50, 53, 57, 57, 50, 52, 53, 57, 34, 44, 34, 116, 111, 107, 101, 110, 34, 58, 34, 97, 87, 53, 48, 90, 88, 74, 104, 89, 51, 82, 112, 98, 50, 52, 54, 77, 84, 77, 119, 79, 84, 69, 120, 77, 106, 77, 120, 78, 84, 85, 121, 78, 84, 107, 53, 77, 106, 81, 49, 79, 84, 112, 121, 83, 69, 116, 86, 79, 70, 66, 109, 83, 50, 108, 114, 90, 71, 116, 113, 82, 109, 73, 121, 98, 109, 70, 121, 84, 69, 90, 75, 90, 122, 86, 69, 97, 88, 90, 73, 90, 110, 70, 52, 78, 48, 53, 117, 84, 87, 116, 109, 87, 88, 108, 70, 98, 49, 82, 49, 79, 69, 99, 50, 87, 85, 111, 121, 81, 49, 70, 118, 100, 122, 104, 80, 89, 107, 49, 75, 99, 86, 70, 82, 97, 48, 53, 114, 98, 88, 112, 116, 82, 50, 86, 97, 83, 86, 90, 74, 86, 71, 57, 51, 100, 85, 69, 121, 97, 48, 108, 83, 78, 108, 82, 110, 79, 85, 112, 90, 78, 50, 90, 110, 98, 49, 100, 108, 82, 109, 53, 115, 86, 48, 108, 77, 78, 110, 104, 80, 99, 70, 77, 53, 90, 51, 112, 89, 85, 85, 74, 111, 79, 72, 78, 122, 101, 84, 85, 52, 84, 68, 104, 51, 85, 68, 108, 48, 89, 122, 104, 50, 83, 81, 34, 44, 34, 116, 121, 112, 101, 34, 58, 49, 44, 34, 117, 115, 101, 114, 34, 58, 123, 34, 97, 118, 97, 116, 97, 114, 34, 58, 34, 99, 54, 97, 50, 52, 57, 54, 52, 53, 100, 52, 54, 50, 48, 57, 102, 51, 51, 55, 50, 55, 57, 99, 100, 50, 99, 97, 57, 57, 56, 99, 55, 34, 44, 34, 97, 118, 97, 116, 97, 114, 95, 100, 101, 99, 111, 114, 97, 116, 105, 111, 110, 95, 100, 97, 116, 97, 34, 58, 110, 117, 108, 108, 44, 34, 98, 111, 116, 34, 58, 116, 114, 117, 101, 44, 34, 99, 108, 97, 110, 34, 58, 110, 117, 108, 108, 44, 34, 100, 105, 115, 99, 114, 105, 109, 105, 110, 97, 116, 111, 114, 34, 58, 34, 48, 48, 48, 48, 34, 44, 34, 103, 108, 111, 98, 97, 108, 95, 110, 97, 109, 101, 34, 58, 34, 68, 105, 115, 99, 111, 114, 100, 34, 44, 34, 105, 100, 34, 58, 34, 54, 52, 51, 57, 52, 53, 50, 54, 52, 56, 54, 56, 48, 57, 56, 48, 52, 57, 34, 44, 34, 112, 117, 98, 108, 105, 99, 95, 102, 108, 97, 103, 115, 34, 58, 49, 44, 34, 115, 121, 115, 116, 101, 109, 34, 58, 116, 114, 117, 101, 44, 34, 117, 115, 101, 114, 110, 97, 109, 101, 34, 58, 34, 100, 105, 115, 99, 111, 114, 100, 34, 125, 44, 34, 118, 101, 114, 115, 105, 111, 110, 34, 58, 49, 125];
        assert_eq!(VERIFIER.verify(&sig_ed25519, &sig_timestamp, &body).is_ok(), true);
    }
}

pub fn validate_discord_signature(headers: &HeaderMap, body: &Body) -> bool {
    let sig_ed25519 = match headers.get("X-Signature-Ed25519") {
        Some(sig_ed25519) => sig_ed25519,
        None => return false,
    }
    .to_str()
    .unwrap_or("");

    let sig_timestamp = match headers.get("X-Signature-Timestamp") {
        Some(timestamp) => timestamp,
        None => return false,
    }
    .to_str()
    .unwrap_or("");

    return VERIFIER.verify(&sig_ed25519, &sig_timestamp, body).is_ok();
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        // disable printing the name of the module in every log line.
        .with_target(false)
        // disabling time is handy because CloudWatch will add the ingestion time.
        .without_time()
        .init();

    run(service_fn(func_handler)).await
}

async fn func_handler(request: Request) -> Result<Value, Error> {
    // Pre-allocate common response structures
    let invalid_response = json!({
        "type": 4,
        "data": {
            "content": "invalid request"
        }
    });

    let body = request.body();
    let headers = request.headers();

    if !validate_discord_signature(&headers, &body) {
        return Ok(json!({
            "type": 4,
            "data": {
                "content": "invalid signature"
            }
        }));
    }

    let event: Interaction = match serde_json::from_slice(body) {
        Ok(event) => event,
        Err(_) => return Ok(invalid_response),
    };

    let state_machine_arn = STATE_MACHINE_ARN.clone();
    let input = serde_json::to_string(&json!({
        "webhookToken": event.token,
        "channel": event.channel_id,
        "guildId": event.guild_id,
        "applicationId": event.application_id,
        "interactionId": event.id,
        "memberId": event.member.as_ref().map(|m| m.user.id),
        "memberUsername": event.member.as_ref().map(|m| m.user.username.clone()),
        "type": event.r#type

    }))?;

    
            let res = match event.r#type {
                InteractionType::Ping => PONG_RESPONSE.clone(),
                InteractionType::MessageComponent | InteractionType::ApplicationCommand => {
                    match SFN_CLIENT
                        .get()
                        .await
                        .start_execution()
                        .input(input)
                        .state_machine_arn(state_machine_arn)
                        .send()
                        .await
                    {
                        Ok(_) => {
                            PROCESSING_RESPONSE.clone()
                        }
                        Err(e) => {
                            // Log the error and return a 200 response
                            eprintln!("Error starting execution: {:?}", e);
                            ERROR_STARTING_SFN.clone()
                        }
                    }
                }
                _ => {
                    println!("Unknown interaction type");
                    json!({
                        "statusCode": 200,
                        "body": json!({ "errorMessage": "Unknown interaction type" }).to_string()
                    })
                }
            };
            Ok(res)
       
    }

