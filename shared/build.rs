use std::env;
use std::fs;
use std::path::Path;

fn main() {
    let workspace_dir = env::var("CARGO_MANIFEST_DIR")
        .map(|dir| Path::new(&dir).parent().unwrap().to_path_buf())
        .expect("Failed to find workspace root");

    dotenv::from_path(workspace_dir.join(".env")).ok();

    let out_dir = env::var_os("OUT_DIR").unwrap();
    let dest_path = Path::new(&out_dir).join("config.rs");

    let admin_pubkey = env::var("ADMIN_PUBKEY").expect("ADMIN_PUBKEY must be set in environment");

    let contents = format!("pub const ADMIN: Pubkey = pubkey!(\"{}\");", admin_pubkey);

    fs::write(dest_path, contents).unwrap();
    println!("cargo:rerun-if-env-changed=ADMIN_PUBKEY");
    println!("cargo:rerun-if-changed=.env");
}
