use log::*;
use simplelog::{ColorChoice, ConfigBuilder, TermLogger, TerminalMode};
use std::str::FromStr;
use std::sync::Once;
use time::macros::format_description;

fn logger() -> anyhow::Result<()> {
    dotenv::dotenv().ok();
    let level = std::env::var("LOG_LEVEL").unwrap_or("INFO".to_string());
    let config = ConfigBuilder::new()
        .set_time_format_custom(format_description!("[hour]:[minute]:[second].[subsecond]"))
        .build();
    Ok(TermLogger::init(
        LevelFilter::from_str(&level)?,
        config,
        TerminalMode::Mixed,
        ColorChoice::Auto,
    )?)
}

static INIT_LOGGER: Once = Once::new();

pub fn init_logger() {
    INIT_LOGGER.call_once(|| {
        let _ = logger();
    });
}
