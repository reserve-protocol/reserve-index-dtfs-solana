use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Invalid program count")]
    InvalidProgramCount,

    #[msg("Program not in registrar")]
    ProgramNotInRegistrar,

    #[msg("Invalid role")]
    InvalidRole,

    #[msg("Invalid bump")]
    InvalidBump,

    #[msg("Invalid PDA")]
    InvalidPda,

    #[msg("Invalid Actor PDA")]
    InvalidActorPda,

    #[msg("Invalid Program")]
    InvalidProgram,

    #[msg("Invalid Account Data")]
    InvalidAccountData,

    #[msg("Invalid Fee Recipient Count")]
    InvalidFeeRecipientCount,

    #[msg("Invalid Fee Per Second")]
    InvalidFeePerSecond,

    #[msg("Invalid Fee Recipient Shares")]
    InvalidFeeRecipientPortion,

    #[msg("Folio Not Initialized")]
    FolioNotInitialized,

    #[msg("Invalid Receiver Token Account")]
    InvalidReceiverTokenAccount,

    #[msg("Invalid Number of Remaining Accounts")]
    InvalidNumberOfRemainingAccounts,

    #[msg("Invalid Added Token Mints")]
    InvalidAddedTokenMints,

    #[msg("Invalid Removed Token Mints")]
    InvalidRemovedTokenMints,

    #[msg("Mint Mismatch")]
    MintMismatch,

    #[msg("Invalid Share Amount Provided")]
    InvalidShareAmountProvided,

    #[msg("Invalid Token Amount")]
    InvalidTokenAmount,

    #[msg("Invalid Folio Token Mint")]
    InvalidFolioTokenMint,

    #[msg("Pending Token Amounts Is Not Empty")]
    PendingBasketIsNotEmpty,
}

#[macro_export]
macro_rules! check_condition {
    ($condition:expr, $error:expr) => {
        if !$condition {
            return Err(error!(ErrorCode::$error));
        }
    };
}
