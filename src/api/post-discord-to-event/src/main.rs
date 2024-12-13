use aws_config::BehaviorVersion;
use aws_lambda_events::{apigw::{ApiGatewayProxyRequest, ApiGatewayProxyResponse}, encodings::Body, http::{header, HeaderMap, HeaderValue}};
use aws_sdk_sfn::{operation::start_execution::{StartExecutionError, StartExecutionOutput}, Client};

use lambda_runtime::{run, service_fn, Error, LambdaEvent};

use serde_json::json;
use serenity::all::{CreateInteractionResponse, CreateInteractionResponseMessage, Interaction, InteractionType};
use tracing::debug;
#[allow(unused_imports)]
use mockall::automock;

#[cfg(test)]
pub use MockRuntimeEnvironment as SFN;
#[cfg(not(test))]
pub use RuntimeEnvironment as SFN;

#[allow(dead_code)]
pub struct RuntimeEnvironment {
    state_machine_arn: String,
    client: aws_sdk_sfn::Client
}


#[cfg_attr(test, automock)]
impl RuntimeEnvironment {
    #[allow(dead_code)]
    pub fn new(state_machine_arn: String, client: aws_sdk_sfn::Client) -> Self {
        Self { state_machine_arn, client }
    }

    #[allow(dead_code)]
    pub async fn start_execution(
        &self,
        input: &str,
    ) -> Result<StartExecutionOutput, aws_sdk_sfn::error::SdkError<StartExecutionError>> {
        self.client
        .start_execution()
        .input(input)
        .state_machine_arn(self.state_machine_arn.clone())
        .send()
        .await
    }
}


#[tracing::instrument(skip(runtime))]
async fn function_handler(runtime: &SFN, event: LambdaEvent<ApiGatewayProxyRequest>) -> Result<ApiGatewayProxyResponse, Error> {
    //log the full event for debug
    let payload = event.payload;
    let body: Body = Body::from_maybe_encoded(payload.is_base64_encoded, payload.body.unwrap().as_str());
    let interaction: Interaction = serde_json::from_slice(&body).unwrap();
    debug!("Interaction: {:?}", interaction);

    let res:CreateInteractionResponse = match interaction.kind() {
        InteractionType::Ping => CreateInteractionResponse::Pong,
        InteractionType::Command => {
            let interaction = interaction.into_command().unwrap().clone();
            //if command name is ping we just answer with pong
            if interaction.data.name == "ping".to_string() {
                CreateInteractionResponse::Message(CreateInteractionResponseMessage::new().content("pong"))
            }else {
                let input = serde_json::to_string(&json!({
                    "webhookToken": interaction.token,
                    "channel": interaction.channel_id,
                    "guildId": interaction.guild_id,
                    "applicationId": interaction.application_id,
                    "interactionId": interaction.id,
                    "memberId": interaction.member.as_ref().map(|m| m.user.id),
                    "memberUsername": interaction.member.as_ref().map(|m| m.user.name.clone()),
                    "type": InteractionType::Command

                }))?;
                match runtime.start_execution(&input).await
                {
                    Ok(_) => 
                        CreateInteractionResponse::Defer(CreateInteractionResponseMessage::new().content("processing...")),
                    Err(e) => {
                        // Log the error and return a 200 response
                        eprintln!("Error starting execution: {:?}", e);
                        CreateInteractionResponse::Message(CreateInteractionResponseMessage::new().content("Error processing"))
                    }
                }
            }
        }
        _ => {
            CreateInteractionResponse::Message(CreateInteractionResponseMessage::new().content("Unknown command"))
        }
    };
    debug!("Response: {:?}", res);
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));

    Ok(ApiGatewayProxyResponse {
        body: Some(aws_lambda_events::encodings::Body::Text(serde_json::to_string(&res).expect("marshalling error"))),
        headers,
        status_code: 200,
        multi_value_headers: HeaderMap::new(),
        is_base64_encoded: false,
    })
    
       
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .json()
        .with_max_level(tracing::Level::TRACE)
        .without_time()
        .with_target(false)
        .init();
    //set log level for this handler to DEBUG
    
    let config = aws_config::load_defaults(BehaviorVersion::latest()).await;
    let client = Client::new(&config);
    
    let runtime_config = &SFN::new(std::env::var("STATE_MACHINE_ARN").expect("STATE_MACHINE_ARN not set"), client);

    run(service_fn(move |event: LambdaEvent<ApiGatewayProxyRequest>| async move {
        function_handler(runtime_config, event).await
    })).await
}
#[cfg(test)]
mod test {
    use std::sync::Arc;

    use super::*;
    use aws_lambda_events::http::{header, HeaderMap, HeaderValue};
    use mockall::predicate::eq;
    use serde::Deserialize;
    use serde_json::from_str;
    use lambda_runtime::{Config, Context};
    use tracing::info;

    #[derive(Deserialize)]
    struct InteractionResponseMessage {
        r#type: i32
    }

    fn _init_trace() {
        tracing_subscriber::fmt()
        .json()
        .with_max_level(tracing::Level::INFO)
        .without_time()
        .with_target(false)
        .init();
    }

    #[tokio::test]
    async fn test_start_execution() {
        _init_trace();
        let mut mock = MockRuntimeEnvironment::default();
        mock.expect_start_execution()
            .with(eq(""))
            .return_once(| _ | {
                Ok(StartExecutionOutput::builder()
                    .execution_arn("test")
                    .build().expect("Build invalid"))
            });
        let input: ApiGatewayProxyRequest = from_str(include_str!("tests/example.json")).expect("Invalid ApiGatewayProxyRequest JSON");
        let mut headers: HeaderMap = HeaderMap::new();
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert("lambda-runtime-deadline-ms", HeaderValue::from_static("15000"));
        headers.insert("lambda-runtime-invoked-function-arn", HeaderValue::from_static("temp-arn"));
        headers.insert("lambda-runtime-trace-id", HeaderValue::from_static("XXXX"));
                
        let env_config = Arc::new(Config::default());
        let client_context = Context::new("test_request_example", env_config, &headers).expect("invalid context");
        let mock_event = LambdaEvent::new(input, client_context);
            
        // Run the code we want to test with it
        let response = function_handler(&mock, mock_event)
            .await
            .unwrap();

        // Verify we got the correct total size back
        assert_eq!(200, response.status_code);
        let interaction_response: InteractionResponseMessage = serde_json::from_slice(&response.body.unwrap()).expect("Invalid JSON");
        assert_eq!(1, interaction_response.r#type);
    }


}


