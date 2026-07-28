# Disposable NixOS fault cell.
#
# Called by the runner as:
#   nix build --impure --file nix/cell.nix \
#     --argstr nixpkgs <store path the `nixpkgs` flake ref resolved to> \
#     --argstr specFile <cell spec json> \
#     --argstr agentFile <guest agent> \
#     --argstr payloadDir <scenario guest payload directory>
#
# The expression is application-agnostic: everything scenario-specific arrives through
# `specFile` (topology) and `payloadDir` (the workload files), both of which the runner
# hashes into the run manifest.
{
  nixpkgs,
  specFile,
  agentFile,
  payloadDir,
  system ? "x86_64-linux",
}:
let
  spec = builtins.fromJSON (builtins.readFile specFile);

  agentSource = builtins.path {
    path = agentFile;
    name = "fault-cell-agent.py";
  };
  payloadSource = builtins.path {
    path = payloadDir;
    name = "fault-cell-payload";
  };
  specSource = builtins.path {
    path = specFile;
    name = "fault-cell-spec.json";
  };

  eval = import "${nixpkgs}/nixos/lib/eval-config.nix" {
    inherit system;
    modules = [
      "${nixpkgs}/nixos/modules/virtualisation/qemu-vm.nix"
      (
        { pkgs, lib, ... }:
        let
          scenarioPackages = map (name: pkgs.${name}) spec.guestPackages;
          basePackages = [
            pkgs.python3
            pkgs.coreutils
            pkgs.util-linux
            pkgs.iproute2
            pkgs.e2fsprogs
            pkgs.gnutar
          ];
        in
        {
          system.stateVersion = "25.11";

          virtualisation.graphics = false;
          virtualisation.memorySize = spec.memoryMiB;
          virtualisation.cores = spec.cores;
          virtualisation.diskSize = spec.diskMiB;
          # The control channel is virtio-serial, never the network, so a scenario can
          # partition every guest link without losing observability.
          virtualisation.qemu.options = [
            "-device virtio-serial"
            "-chardev socket,id=faultcell,path=\${FAULT_CELL_CONTROL_SOCKET},server=on,wait=off"
            "-device virtserialport,chardev=faultcell,name=org.faultcell.control"
            "-qmp unix:\${FAULT_CELL_QMP_SOCKET},server=on,wait=off"
          ];

          time.timeZone = spec.timeZone;
          boot.kernelModules = spec.kernelModules;
          documentation.enable = false;
          networking.firewall.enable = false;
          services.getty.autologinUser = "root";
          system.name = "fault-cell";

          environment.systemPackages = basePackages ++ scenarioPackages;
          environment.etc."faultcell/agent.py".source = agentSource;
          environment.etc."faultcell/cell-spec.json".source = specSource;
          environment.etc."faultcell/payload".source = payloadSource;

          systemd.services.faultcell-agent = {
            description = "fault-cell guest agent";
            wantedBy = [ "multi-user.target" ];
            after = [
              "local-fs.target"
              "systemd-udev-settle.service"
            ];
            wants = [ "systemd-udev-settle.service" ];
            path = basePackages ++ scenarioPackages;
            serviceConfig = {
              Type = "simple";
              ExecStart = ''
                ${pkgs.python3}/bin/python3 /etc/faultcell/agent.py \
                  --port /dev/virtio-ports/org.faultcell.control \
                  --spec /etc/faultcell/cell-spec.json \
                  --share /tmp/shared
              '';
              Restart = "no";
              # Children are moved into their own cgroups by the agent; systemd must not
              # sweep them when the agent restarts or a workload is deliberately killed.
              KillMode = "process";
              Delegate = "yes";
            };
          };
        }
      )
    ];
  };
in
eval.config.system.build.vm
