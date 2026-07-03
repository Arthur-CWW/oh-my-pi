defmodule SymphonyLiteElixir do
  @moduledoc "Public API for the Symphony Lite Elixir/OTP spike."

  alias SymphonyLiteElixir.Ledger

  @doc "Return a status summary from a root directory's SQLite ledger."
  def status(root) do
    Ledger.status(root)
  end
end
