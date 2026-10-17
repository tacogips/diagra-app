use std::{env, path::PathBuf, process::Command};
fn main() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let plist = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("Info.plist");
        println!("cargo:rerun-if-changed={}", plist.display());
        println!(
            "cargo:rustc-link-arg-bin=nodetto-cli=-Wl,-sectcreate,__TEXT,__info_plist,{}",
            plist.display()
        );
    }
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../../..");
    for path in [
        "apps/cli/src",
        "apps/cli/scripts/build-engine.ts",
        "packages/core/src",
        "packages/ir/src",
        "packages/io/src",
    ] {
        println!("cargo:rerun-if-changed={}", root.join(path).display());
    }
    let status = Command::new("bun")
        .arg(root.join("apps/cli/scripts/build-engine.ts"))
        .env("NODETTO_ENGINE_OUT_DIR", env::var_os("OUT_DIR").unwrap())
        .current_dir(&root)
        .status()
        .expect("Bun is needed at build time to bundle the shared diagram engine");
    assert!(status.success(), "shared diagram engine build failed");
}
