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
use std::{env, fmt};

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
        Self::try_new(&parse_hex::<PUBLIC_KEY_LENGTH>(public_key).expect("public key must be a 64 digit hex string"))
            .expect("invalid public key")
    }

    /// Creates a new [`Verifier`] from the public key bytes.
    ///
    /// # Errors
    ///
    /// [`InvalidKey`] if the key isn't cryptographically valid.
    pub fn try_new(public_key: &[u8; PUBLIC_KEY_LENGTH]) -> Result<Self, InvalidKey> {
        Ok(Self {
            public_key: VerifyingKey::from_bytes(public_key).map_err(InvalidKey)?,
        })
    }

    /// Verifies a Discord request for authenticity, given the `X-Signature-Ed25519` HTTP header,
    /// `X-Signature-Timestamp` HTTP headers and request body.
    // We just need to differentiate "pass" and "failure". There's deliberately no data besides ().
    pub fn verify(&self, signature: &str, timestamp: &str, body: &[u8]) -> Result<(), ()> {
        use ed25519_dalek::Verifier as _;
        //trace body in the execution

        // Extract and parse signature
        let signature_bytes = parse_hex::<64>(signature).ok_or(())?;
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

    pub fn verify_bytes(&self, signature_bytes: &[u8;SIGNATURE_LENGTH], timestamp: &str, body: &[u8]) -> Result<(), ()> {
        use ed25519_dalek::Verifier as _;
        //trace body in the execution

        // Extract and parse signature
        let sig = Signature::from_bytes(signature_bytes);

        // Verify
        tracing::trace!("sig: {:?}", signature_bytes);
        tracing::trace!("timestamp: {:?}", timestamp);
        tracing::trace!("body: {:?}", body);

        let message_to_verify = [timestamp.as_bytes(), body].concat();
        self.public_key
            .verify(&message_to_verify, &sig)
            .map_err(|_| ())
    }


    
}

impl fmt::Display for Verifier {
    fn fmt(&self, fmt: &mut fmt::Formatter) -> fmt::Result {
        for byte in self.public_key.as_bytes() {
            // Decide if you want to pad the value or have spaces inbetween, etc.
            write!(fmt, "{:2X?}", byte)?;
        }
        Ok(())
    }
}
use ed25519_dalek::{PUBLIC_KEY_LENGTH, SIGNATURE_LENGTH};
#[cfg(test)]
mod tests {
    use super::*;
    use rand::{rngs::OsRng, RngCore};
    use ed25519_dalek::{Signer, SigningKey, SECRET_KEY_LENGTH};

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
            parse_hex::<PUBLIC_KEY_LENGTH>("e16dd6b9e483616672cfa1e9982c9027857d9d60e18e03b73eb26f0a11273233"),
            Some([
                0xE1, 0x6D, 0xD6, 0xB9, 0xE4, 0x83, 0x61, 0x66, 0x72, 0xCF, 0xA1, 0xE9, 0x98, 0x2C,
                0x90, 0x27, 0x85, 0x7D, 0x9D, 0x60, 0xE1, 0x8E, 0x03, 0xB7, 0x3E, 0xB2, 0x6F, 0x0A,
                0x11, 0x27, 0x32, 0x33
            ])
        );
        assert_eq!(
            Verifier::new("e16dd6b9e483616672cfa1e9982c9027857d9d60e18e03b73eb26f0a11273233")
                .public_key,
            Verifier::try_new(&[
                0xE1, 0x6D, 0xD6, 0xB9, 0xE4, 0x83, 0x61, 0x66, 0x72, 0xCF, 0xA1, 0xE9, 0x98, 0x2C,
                0x90, 0x27, 0x85, 0x7D, 0x9D, 0x60, 0xE1, 0x8E, 0x03, 0xB7, 0x3E, 0xB2, 0x6F, 0x0A,
                0x11, 0x27, 0x32, 0x33
            ])
            .unwrap()
            .public_key
        );
    }



    #[test]
    fn test_generate_discord_signature() {
        let sig_timestamp = "1732187098";
        let body = "{\"app_permissions\":\"562949953601536\",\"application_id\":\"989195982531096616\",\"authorizing_integration_owners\":{},\"entitlements\":[],\"id\":\"1309112315525992459\",\"token\":\"aW50ZXJhY3Rpb246MTMwOTExMjMxNTUyNTk5MjQ1OTpySEtVOFBmS2lrZGtqRmIybmFyTEZKZzVEaXZIZnF4N05uTWtmWXlFb1R1OEc2WUoyQ1FvdzhPYk1KcVFRa05rbXptR2VaSVZJVG93dUEya0lSNlRnOUpZN2Znb1dlRm5sV0lMNnhPcFM5Z3pYUUJoOHNzeTU4TDh3UDl0Yzh2SQ\",\"type\":1,\"user\":{\"avatar\":\"c6a249645d46209f337279cd2ca998c7\",\"avatar_decoration_data\":null,\"bot\":true,\"clan\":null,\"discriminator\":\"0000\",\"global_name\":\"Discord\",\"id\":\"643945264868098049\",\"public_flags\":1,\"system\":true,\"username\":\"discord\"},\"version\":1}".as_bytes();
        let message_to_verify = [sig_timestamp.as_bytes(), &body].concat();
        let mut key = [0u8; SECRET_KEY_LENGTH];
        OsRng.fill_bytes(&mut key);
        let mut csprng = OsRng;
        let signing_key: SigningKey = SigningKey::generate(&mut csprng);
        let signature: Signature = signing_key.sign(&message_to_verify);
        let verifying_key= signing_key.verifying_key();
        let public_key_bytes = Verifier::try_new(verifying_key.as_bytes()).unwrap();
        //check signature length and public key length
        assert_eq!(signature.to_bytes().len(), SIGNATURE_LENGTH, "Checking signature length of {}", signature.to_bytes().len());
        assert_eq!(public_key_bytes.public_key.to_bytes().len(), PUBLIC_KEY_LENGTH, "Checking public key length of {}", public_key_bytes.public_key.to_bytes().len());
        assert!(public_key_bytes.verify(&signature.to_string(), &sig_timestamp, &body).is_ok(), "Verifying signature of body");
    }

    //test validate discord signature
    #[test]
    fn test_validate_discord_signature() {
        let sig_ed25519 = "ced5a01161acd1cb3115abe922b5ebf1acff00f7f08175ab71ff5da03fafaf1a16c99f263cfbc616bf4c977e3d0720ad40d3e100aa5db1ab3a492ed453b53e0f";
        let sig_timestamp = "1732187098";
        let body_str = "{\"app_permissions\":\"562949953601536\",\"application_id\":\"989195982531096616\",\"authorizing_integration_owners\":{},\"entitlements\":[],\"id\":\"1309112315525992459\",\"token\":\"aW50ZXJhY3Rpb246MTMwOTExMjMxNTUyNTk5MjQ1OTpySEtVOFBmS2lrZGtqRmIybmFyTEZKZzVEaXZIZnF4N05uTWtmWXlFb1R1OEc2WUoyQ1FvdzhPYk1KcVFRa05rbXptR2VaSVZJVG93dUEya0lSNlRnOUpZN2Znb1dlRm5sV0lMNnhPcFM5Z3pYUUJoOHNzeTU4TDh3UDl0Yzh2SQ\",\"type\":1,\"user\":{\"avatar\":\"c6a249645d46209f337279cd2ca998c7\",\"avatar_decoration_data\":null,\"bot\":true,\"clan\":null,\"discriminator\":\"0000\",\"global_name\":\"Discord\",\"id\":\"643945264868098049\",\"public_flags\":1,\"system\":true,\"username\":\"discord\"},\"version\":1}";
        let verifier = Verifier::new("e16dd6b9e483616672cfa1e9982c9027857d9d60e18e03b73eb26f0a11273233");

        println!("Converting signature");
        let sig_ed25519_bytes = parse_hex::<SIGNATURE_LENGTH>(sig_ed25519).expect("Invalid signature");
        assert_eq!(sig_ed25519_bytes.len(), SIGNATURE_LENGTH, "Checking signature length of {}", sig_ed25519_bytes.len());
        println!("Checking public key");
        assert_eq!(verifier.public_key.to_bytes().len(), PUBLIC_KEY_LENGTH, "Checking public key length of {}", verifier.public_key.to_bytes().len());

        println!("sig_ed25519_bytes: {:?}", sig_ed25519_bytes);
        println!("Checking signature length of {}", sig_ed25519_bytes.len());
        println!("VERIFIER.public_key.to_bytes(): {:?}", verifier.public_key.to_bytes());
        println!("Checking public key length of {}", verifier.public_key.to_bytes().len());
        
        assert_eq!(verifier.verify(&sig_ed25519, &sig_timestamp, body_str.as_bytes()).is_ok(), true);
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

    assert!(match body {
        aws_lambda_events::encodings::Body::Binary(_) => true,
        _ => false
      }, "Check body is raw bytes");

    return VERIFIER.verify(&sig_ed25519, &sig_timestamp, body.as_ref()).is_ok();
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

