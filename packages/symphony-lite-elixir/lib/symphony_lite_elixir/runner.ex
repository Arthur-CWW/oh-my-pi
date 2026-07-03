defmodule SymphonyLiteElixir.Runner do
  @moduledoc """
  Runner command construction for child agent adapters.

  This module does not execute live commands; it returns the command and
  arguments that a runner adapter would use for a given prompt file.
  """

  @doc """
  Build a runner command map for the given adapter kind and prompt path.

  Supported kinds:
    * :dry_run   - echo-only placeholder
    * :pi_rpc    - `pi --mode rpc --no-session --prompt-file <path>`
    * :omp_cli   - `omp -p --prompt-file <path>`
  """
  def build(kind, prompt_path) do
    case kind do
      :dry_run ->
        %{kind: :dry_run, command: "echo", args: ["dry-run prompt:", prompt_path]}

      :pi_rpc ->
        %{
          kind: :pi_rpc,
          command: "pi",
          args: ["--mode", "rpc", "--no-session", "--prompt-file", prompt_path]
        }

      :omp_cli ->
        command = if File.exists?("bin/omp"), do: "bin/omp", else: "omp"

        %{
          kind: :omp_cli,
          command: command,
          args: ["-p", "--prompt-file", prompt_path]
        }
    end
  end
end
