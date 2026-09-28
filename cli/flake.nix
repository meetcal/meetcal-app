{
  description = "MeetCal CLI development environment";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  outputs = { nixpkgs, ... }:
    let systems = [ "aarch64-darwin" "aarch64-linux" "x86_64-linux" ];
    in {
      devShells = nixpkgs.lib.genAttrs systems (system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in { default = pkgs.mkShell {
          packages = with pkgs; [
            rustc cargo clippy rustfmt rust-analyzer cargo-audit pkg-config git just
          ];
          shellHook = ''echo "Nix dev shell: MeetCal CLI"'';
        }; });
    };
}
