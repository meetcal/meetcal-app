{
  description = "MeetCal mobile development environment";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { nixpkgs, ... }:
    let
      system = "aarch64-darwin";
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      devShells.${system}.default = pkgs.mkShellNoCC {
        packages = with pkgs; [ bun nodejs_24 jdk17 ruby_3_3 cocoapods git just ];
        shellHook = ''echo "Nix dev shell: MeetCal mobile"'';
      };
    };
}
