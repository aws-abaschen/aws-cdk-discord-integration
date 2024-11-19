use async_once::AsyncOnce;
use aws_config::BehaviorVersion;
use aws_sdk_sfn::Client;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use lambda_http::{http::HeaderMap, run, service_fn, Body, Error, Request};

use lazy_static::lazy_static;
use rusty_interaction::types::interaction::{
    Interaction, InteractionResponseType, InteractionType,
};
use serde_json::{json, Value};
use std::env;

lazy_static! {
    static ref STATE_MACHINE_ARN: String =
        env::var("STATE_MACHINE_ARN").expect("STATE_MACHINE_ARN must be set");
    static ref PUBLIC_KEY: VerifyingKey = {
        let public_key_bytes = hex::decode(
            env::var("PUBLIC_KEY").expect("Expected PUBLIC_KEY to be set in the environment"),
        )
        .expect("Couldn't hex::decode the PUBLIC_KEY");

        if public_key_bytes.len() != 32 {
            panic!("PUBLIC_KEY must be exactly 32 bytes long");
        }

        let mut key_arr = [0u8; 32];
        key_arr.copy_from_slice(&public_key_bytes);

        VerifyingKey::from_bytes(&key_arr)
            .expect("Couldn't create a VerifyingKey from PUBLIC_KEY bytes")
    };
}

lazy_static! {
    static ref SFN_CLIENT: AsyncOnce<Client> = AsyncOnce::new(async {
        let config = aws_config::load_defaults(BehaviorVersion::latest()).await;
        Client::new(&config)
    });
}

pub fn validate_discord_signature(headers: &HeaderMap, body: &Body) -> bool {
    let sig_ed25519 = match headers.get("X-Signature-Ed25519") {
        Some(header_signature) => match hex::decode(header_signature) {
            Ok(decoded_header) => {
                if decoded_header.len() == 64 {
                    let mut sig_arr = [0u8; 64];
                    sig_arr.copy_from_slice(&decoded_header);
                    Signature::from_bytes(&sig_arr)
                } else {
                    return false;
                }
            }
            Err(_) => return false,
        },
        None => return false,
    };

    let sig_timestamp = match headers.get("X-Signature-Timestamp") {
        Some(timestamp) => timestamp,
        None => return false,
    };

    if let Body::Text(body) = body {
        let content = sig_timestamp
            .as_bytes()
            .iter()
            .chain(body.as_bytes().iter())
            .cloned()
            .collect::<Vec<u8>>();
        PUBLIC_KEY.verify(&content.as_slice(), &sig_ed25519).is_ok()
    } else {
        false
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    //tracing::init_default_subscriber();
    run(service_fn(func_handler)).await?;
    Ok(())
}

async fn func_handler(request: Request) -> Result<Value, Error> {
    let body = request.body();
    let headers = request.headers();

    if !validate_discord_signature(&headers, &body) {
        // Respond immediately if verification fails
        return Ok(json!({
            "type": 4,
             "data": {
                 "content": "invalid request"
                }
            }
        ));
    }
    //convert body to Interaction
    let event: Interaction =
        serde_json::from_slice::<Interaction>(body).expect("Couldn't parse body as Interaction");
    let state_machine_arn = STATE_MACHINE_ARN.clone();
    match SFN_CLIENT
        .get()
        .await
        .start_execution()
        //add body of request as input
        .input(
            json!({
                "webhookToken": event.token,
                "channel": event.channel_id,
                "guildId": event.guild_id,
                "applicationId": event.application_id,
                "interactionId": event.id,
                "memberId": event.member.as_ref().map(|m| m.user.id),
                "memberUsername": event.member.as_ref().map(|m| m.user.username.clone()),
                "type": event.r#type,
                "data": event.data.clone().unwrap()
            })
            .to_string(),
        )
        .state_machine_arn(state_machine_arn)
        .send()
        .await
    {
        Ok(_) => {
            let res = match event.r#type {
                InteractionType::Ping => json!({
                    "statusCode": 200,
                    "body": json!({
                        "type": InteractionResponseType::Pong,
                    }).to_string()
                }),
                InteractionType::MessageComponent | InteractionType::ApplicationCommand => json!({
                    "statusCode": 200,
                    "body": json!({
                        "type":  InteractionResponseType::DefferedChannelMessageWithSource,
                        "data": {
                            "content": "processing..."
                            }
                        }).to_string()
                }),
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
        Err(e) => {
            // Log the error and return a 200 response
            eprintln!("Error starting execution: {:?}", e);
            Ok(json!({
                "type": 4,
                 "data": {
                     "content": "invalid request"
                    }
                }
            ))
        }
    }
}
