{
  description = "Rust-only Nix build for the OMP pi-natives Node-API addon";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/4382ed2b7a6839d4280a9b386db49cbc5907414d";

    crane.url = "github:ipetkov/crane";

    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { nixpkgs, crane, rust-overlay, ... }:
    let
      supportedSystems = [ "aarch64-darwin" "x86_64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      perSystem = system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ rust-overlay.overlays.default ];
          };
          rustToolchain = pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml;
          craneLib = (crane.mkLib pkgs).overrideToolchain rustToolchain;
          pi-natives = pkgs.callPackage ./nix/pi-natives.nix { inherit craneLib; };
          addonName =
            if system == "aarch64-darwin" then
              "pi_natives.darwin-arm64.node"
            else
              "pi_natives.linux-x64-baseline.node";
        in
        {
          inherit pkgs pi-natives addonName;
        };
    in
    {
      packages = forAllSystems (system:
        let resolved = perSystem system;
        in {
          inherit (resolved) pi-natives;
          default = resolved.pi-natives;
        });

      checks = forAllSystems (system:
        let
          resolved = perSystem system;
        in {
          pi-natives-load = resolved.pkgs.runCommand "pi-natives-load" {
            nativeBuildInputs = [ resolved.pkgs.nodejs ];
          } ''
            node -e '
              const addon = require(process.argv[1]);
              if (typeof addon.hasMatch !== "function") {
                throw new Error("pi-natives is missing the hasMatch export");
              }
            ' "${resolved.pi-natives}/lib/${resolved.addonName}"
            touch "$out"
          '';
        });
    };
}
