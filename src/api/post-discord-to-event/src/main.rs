use aws_config::BehaviorVersion;
use aws_sdk_sfn::Client;

use lambda_runtime::{service_fn, Error, LambdaEvent};
use rusty_interaction::types::interaction::{
    Interaction, InteractionResponseType, InteractionType
};
use serde_json::{json, Value};
struct RuntimeEnvironment<'a> {
    state_machine_arn: String,
    client: &'a Client
}
async fn function_handler(runtime: &RuntimeEnvironment<'_>, event: LambdaEvent<Interaction>) -> Result<Value, Error> {
    let event = event.payload;

    let state_machine_arn = runtime.state_machine_arn.clone();
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
        InteractionType::Ping => Ok( json!({
            "type": InteractionResponseType::Pong
        })),
        InteractionType::MessageComponent | InteractionType::ApplicationCommand => {
            match runtime.client
                .start_execution()
                .input(input)
                .state_machine_arn(state_machine_arn)
                .send()
                .await
            {
                Ok(_) => 
                    Ok(json!({
                        "type": InteractionResponseType::DefferedChannelMessageWithSource,
                        "data": {
                            "content": "processing..."
                        }
                    })),
                Err(e) => {
                    // Log the error and return a 200 response
                    eprintln!("Error starting execution: {:?}", e);
                    Ok(json!({
                        "type": InteractionResponseType::ChannelMessageWithSource,
                        "data": {
                            "content": "Error starting execution"
                        }
                    }))
                }
            }
        }
        _ => {
            Ok(json!({
                "type": InteractionResponseType::ChannelMessageWithSource,
                "data": {
                    "content": "Unknown commad"
                }
            }))
        }
    };

    res
       
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .without_time()
        .with_target(false)
        .init();
    let config = aws_config::load_defaults(BehaviorVersion::latest()).await;
    let client = Client::new(&config);
    let runtime_config = RuntimeEnvironment {
        state_machine_arn: std::env::var("STATE_MACHINE_ARN").expect("STATE_MACHINE_ARN not set"),
        client: &client
    };

    let shared_config = &runtime_config;
    lambda_runtime::run(service_fn(move |event: LambdaEvent<Interaction>| async move {
        function_handler(&shared_config, event).await
    })).await
}
