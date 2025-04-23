#[cfg(test)]
mod tests {
    use crate::shared::logger::init_logger;
    use anchor_lang::__private::bytemuck;

    use anchor_lang::prelude::*;
    use anchor_lang::{AccountSerialize, Discriminator, ZeroCopy};
    use folio::state::*;
    use log::info;

    fn ident_name<'a, T: ?Sized + 'a>() -> String {
        let full_ident_name = std::any::type_name::<T>();
        match full_ident_name.rsplit_once("::") {
            Some((_path, ident_name)) => ident_name.to_string(),
            None => full_ident_name.to_string(),
        }
    }

    fn serialize_account<T: Discriminator + AccountSerialize + Default>() -> Vec<u8> {
        let account = T::default();
        let mut account_data = vec![];
        account
            .try_serialize(&mut account_data)
            .expect("Failed to serialize account");
        let discrim = T::DISCRIMINATOR.to_vec();
        [discrim, account_data].concat()
    }
    fn deserialize_account<T: AccountDeserialize>(data: &mut &[u8]) -> T {
        T::try_deserialize(data).expect("Failed to deserialize account")
    }

    fn serialize_zero_copy_account<T: ZeroCopy + Discriminator + AccountDeserialize + Default>(
    ) -> Vec<u8> {
        let account = T::default();
        let account_data = bytemuck::bytes_of(&account).to_vec();
        let discrim = T::DISCRIMINATOR.to_vec();
        [discrim, account_data].concat()
    }
    fn deserialize_zero_copy_account<T: AccountDeserialize + Discriminator + ZeroCopy>(
        data: &mut &[u8],
    ) -> T {
        let type_name = ident_name::<T>();
        let alignment = std::mem::align_of::<T>();
        let ptr = data[8..].as_ptr();

        fn is_aligned_for<T>(ptr: *const u8) -> bool {
            let alignment = std::mem::align_of::<T>();
            (ptr as usize) % alignment == 0
        }

        if !is_aligned_for::<T>(ptr) {
            info!("{} unaligned: {}", type_name, alignment);
            bytemuck::try_pod_read_unaligned(&data[8..])
                .expect("Failed to deserialize unaligned unaligned zero-copy account")
        } else {
            info!("{} aligned: {}", type_name, alignment);
            T::try_deserialize(data).expect("Failed to deserialize aligned zero-copy account")
        }
    }

    #[test]
    fn folio() {
        init_logger();
        let data = serialize_zero_copy_account::<Folio>();
        let _rehydrated = deserialize_zero_copy_account::<Folio>(&mut &data[..]);
    }

    #[test]
    fn auction() {
        init_logger();
        let data = serialize_zero_copy_account::<Auction>();
        let _rehydrated = deserialize_zero_copy_account::<Auction>(&mut &data[..]);
    }

    #[test]
    fn user_pending_basket() {
        init_logger();
        let data = serialize_zero_copy_account::<UserPendingBasket>();
        let _rehydrated = deserialize_zero_copy_account::<UserPendingBasket>(&mut &data[..]);
    }

    #[test]
    fn folio_basket() {
        init_logger();
        let data = serialize_zero_copy_account::<FolioBasket>();
        let _rehydrated = deserialize_zero_copy_account::<FolioBasket>(&mut &data[..]);
    }

    #[test]
    fn actor() {
        init_logger();
        let data = serialize_account::<Actor>();
        let _rehydrated = deserialize_account::<Actor>(&mut &data[..]);
    }
}
