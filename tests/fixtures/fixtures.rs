use anchor_lang::solana_program::hash::hashv;
use anchor_lang::{prelude::*, solana_program::bpf_loader_upgradeable};
use dtfs::ID as DTF_ID;
use folio::ID as FOLIO_ID;

lazy_static::lazy_static! {
    static ref BPF_LOADER_UPGRADEABLE_ID: Pubkey = bpf_loader_upgradeable::id();
}

#[derive(Debug)]
pub struct TestAccount<T: Owner + AccountSerialize + AccountDeserialize + Clone> {
    pub data: Box<Vec<u8>>,
    pub lamports: Box<u64>,
    pub pubkey: Box<Pubkey>,
    pub owner: Box<Pubkey>,
    pub account_info: Option<Box<AccountInfo<'static>>>,
    pub account: Option<Box<Account<'static, T>>>,
}

impl<T: Owner + AccountSerialize + AccountDeserialize + Clone> TestAccount<T> {
    fn new() -> Self {
        Self {
            data: Box::new(vec![0; 1000]),
            lamports: Box::new(10_000),
            pubkey: Box::new(Pubkey::new_unique()),
            owner: Box::new(Pubkey::default()),
            account_info: None,
            account: None,
        }
    }

    fn discriminator(account_name: &str) -> [u8; 8] {
        let preimage = vec![account_name.as_bytes()];
        let mut discriminator = [0u8; 8];
        discriminator.copy_from_slice(&hashv(&preimage).to_bytes()[..8]);
        discriminator
    }

    pub fn pack_with_discriminator(&mut self, account_name: &str) {
        let mut data = Self::discriminator(account_name).to_vec();
        data.append(&mut self.data);
        self.data = Box::new(data);
    }

    pub fn setup(&mut self, owner: Pubkey, account_name: Option<&str>) {
        if let Some(name) = account_name {
            self.pack_with_discriminator(name);
        }

        *self.owner = owner;

        let data = Box::leak(self.data.clone().into_boxed_slice());
        let lamports = Box::leak(Box::new(*self.lamports));
        let pubkey = Box::leak(Box::new(*self.pubkey));
        let owner = Box::leak(Box::new(*self.owner));

        let account_info = AccountInfo::new(pubkey, false, false, lamports, data, owner, false, 0);

        let static_account_info = Box::leak(Box::new(account_info.clone()));
        self.account_info = Some(Box::new(account_info));

        if account_name.is_some() {
            let account = Account::try_from_unchecked(static_account_info).unwrap();
            self.account = Some(Box::new(account));
        }
    }
}

pub struct TestFixture<T: Owner + AccountSerialize + AccountDeserialize + Clone> {
    pub program_registrar: TestAccount<T>,
    pub dtf_program: TestAccount<T>,
}

impl<T: Owner + AccountSerialize + AccountDeserialize + Clone> TestFixture<T> {
    pub fn new() -> Self {
        Self {
            program_registrar: TestAccount::new(),
            dtf_program: TestAccount::new(),
        }
    }

    pub fn setup(&mut self) -> &Self {
        self.program_registrar
            .setup(FOLIO_ID, Some("ProgramRegistrar"));
        self.dtf_program.setup(DTF_ID, None);
        self
    }

    pub fn get_accounts(&self) -> (&Box<Account<'static, T>>, &Box<AccountInfo<'static>>) {
        (
            self.program_registrar.account.as_ref().unwrap(),
            self.dtf_program.account_info.as_ref().unwrap(),
        )
    }

    pub fn get_program_registrar(&self) -> &Box<Account<'static, T>> {
        self.program_registrar.account.as_ref().unwrap()
    }

    pub fn get_program_registrar_mut(&mut self) -> &mut Box<Account<'static, T>> {
        self.program_registrar.account.as_mut().unwrap()
    }

    pub fn get_dtf_program(&self) -> &Box<AccountInfo<'static>> {
        self.dtf_program.account_info.as_ref().unwrap()
    }
}

impl<T: Owner + AccountSerialize + AccountDeserialize + Clone> Default for TestFixture<T> {
    fn default() -> Self {
        Self::new()
    }
}
