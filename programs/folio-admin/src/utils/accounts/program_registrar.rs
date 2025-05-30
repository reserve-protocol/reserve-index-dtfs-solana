use anchor_lang::prelude::*;
use shared::{check_condition, errors::ErrorCode};

use crate::state::ProgramRegistrar;
use anchor_lang::prelude::Pubkey;

impl ProgramRegistrar {
    /// Add one or multiple programs to the registrar.
    ///
    /// # Arguments
    /// * `program_ids` - The program ids to add to the registrar.
    ///
    /// Returns an error if there is not enough empty slots in the registrar.
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

    /// Remove one or multiple programs from the registrar.
    ///
    /// # Arguments
    /// * `program_ids` - The program ids to remove from the registrar.
    ///
    /// Returns an error if the program ids are not in the registrar.
    pub fn remove_from_registrar(&mut self, program_ids: Vec<Pubkey>) -> Result<()> {
        let mut new_programs = self.accepted_programs.to_vec();
        let mut found_count = 0;

        for program in new_programs.iter_mut() {
            if program_ids.contains(program) {
                found_count += 1;
                *program = Pubkey::default();
            }
        }

        // Verify we found all programs that were supposed to be removed
        check_condition!(found_count == program_ids.len(), ProgramNotInRegistrar);

        self.accepted_programs = new_programs.try_into().unwrap();
        Ok(())
    }

    /// Check if a program is in the registrar.
    ///
    /// # Arguments
    /// * `program_id` - The program id to check.
    ///
    /// Returns true if the program is in the registrar, false otherwise.
    pub fn is_in_registrar(&self, program_id: Pubkey) -> bool {
        self.accepted_programs.contains(&program_id)
    }
}
