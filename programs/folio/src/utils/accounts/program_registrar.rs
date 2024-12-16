use anchor_lang::prelude::*;
use shared::{check_condition, errors::ErrorCode};

use crate::state::ProgramRegistrar;
use anchor_lang::prelude::Pubkey;

impl ProgramRegistrar {
    pub fn add_to_registrar(&mut self, program_ids: &mut Vec<Pubkey>) -> Result<()> {
        let empty_slots = self
            .accepted_programs
            .iter()
            .filter(|&&pubkey| pubkey == Pubkey::default())
            .count();

        check_condition!(empty_slots >= program_ids.len(), InvalidProgramCount);

        for pubkey in self.accepted_programs.iter_mut() {
            if *pubkey == Pubkey::default() {
                if let Some(new_key) = program_ids.pop() {
                    *pubkey = new_key;
                } else {
                    break;
                }
            }
        }

        Ok(())
    }

    pub fn remove_from_registrar(&mut self, program_ids: Vec<Pubkey>) -> Result<()> {
        let mut new_programs = self.accepted_programs.to_vec();

        new_programs.iter_mut().for_each(|program| {
            if program_ids.contains(program) {
                *program = Pubkey::default();
            }
        });

        self.accepted_programs = new_programs.try_into().unwrap();

        Ok(())
    }

    pub fn is_in_registrar(&self, program_id: Pubkey) -> bool {
        self.accepted_programs.contains(&program_id)
    }
}
