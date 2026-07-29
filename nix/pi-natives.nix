# Rust-only source inputs: Cargo.toml, Cargo.lock, rust-toolchain.toml,
# the complete crates/ tree (including vendored crates), and .cargo config.
# No JavaScript, Bun, napi CLI, package output, or local/ input enters the build.
{
  lib,
  stdenv,
  craneLib,
  pkg-config,
}:
let
  sourceRoot = ../.;
  sourceRootString = toString sourceRoot;

  # Keep the Rust closure explicit: workspace manifests/lock, the authoritative
  # rustup toolchain file, every crate (including vendored path dependencies),
  # and optional Cargo configuration. In particular, this excludes local/.
  cargoSource = lib.cleanSourceWith {
    src = sourceRoot;
    name = "pi-natives-cargo-source";
    filter = path: type:
      let
        pathString = toString path;
        relative = lib.removePrefix "${sourceRootString}/" pathString;
      in
      pathString == sourceRootString
      || relative == "Cargo.toml"
      || relative == "Cargo.lock"
      || relative == "rust-toolchain.toml"
      || relative == "crates"
      || lib.hasPrefix "crates/" relative
      || relative == ".cargo"
      || lib.hasPrefix ".cargo/" relative;
  };

  isLinuxX64 = stdenv.hostPlatform.system == "x86_64-linux";
  addonName =
    if stdenv.hostPlatform.system == "aarch64-darwin" then
      "pi_natives.darwin-arm64.node"
    else if isLinuxX64 then
      "pi_natives.linux-x64-baseline.node"
    else
      throw "pi-natives does not support ${stdenv.hostPlatform.system}";

  commonArgs = {
    pname = "pi-natives";
    version = "0.0.0";
    src = cargoSource;
    strictDeps = true;
    nativeBuildInputs = [ pkg-config ];
    cargoExtraArgs = "--package pi-natives";
  } // lib.optionalAttrs isLinuxX64 {
    RUSTFLAGS = "-C target-cpu=x86-64-v2";
  };

  cargoArtifacts = craneLib.buildDepsOnly commonArgs;
in
craneLib.buildPackage (commonArgs // {
  inherit cargoArtifacts;
  doCheck = false;

  # napi-rs' CLI normally performs this copy/rename. The Rust build already
  # produces a loadable cdylib, so no napi CLI or JavaScript runtime is needed.
  installPhase = ''
    runHook preInstall
    install -Dm755 target/release/libpi_natives${stdenv.hostPlatform.extensions.sharedLibrary} \
      "$out/lib/${addonName}"
    runHook postInstall
  '';

  meta = {
    description = "OMP pi-natives Node-API addon";
    platforms = [ "aarch64-darwin" "x86_64-linux" ];
  };
})
