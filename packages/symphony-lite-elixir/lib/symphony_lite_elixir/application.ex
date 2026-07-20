defmodule SymphonyLiteElixir.Application do
  @moduledoc "OTP application wrapper for the Symphony Lite orchestrator spike."

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      {Registry, keys: :unique, name: SymphonyLiteElixir.Otp.Registry},
      SymphonyLiteElixir.Otp.LedgerAdapter,
      {DynamicSupervisor, strategy: :one_for_one, name: SymphonyLiteElixir.Otp.DynamicSupervisor}
    ]

    Supervisor.start_link(children, strategy: :one_for_one, name: SymphonyLiteElixir.Supervisor)
  end
end
