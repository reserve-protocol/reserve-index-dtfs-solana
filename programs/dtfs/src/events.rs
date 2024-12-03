use anchor_lang::prelude::*;

#[event]
pub struct ExampleEvent {
    pub example_field: u64,
}
