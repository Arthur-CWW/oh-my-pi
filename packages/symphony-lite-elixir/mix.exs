defmodule SymphonyLiteElixir.MixProject do
  use Mix.Project

  def project do
    [
      app: :symphony_lite_elixir,
      version: "0.1.0",
      elixir: "~> 1.20",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      escript: [
        main_module: SymphonyLiteElixir.CLI,
        path: "bin/symphony_lite_elixir"
      ]
    ]
  end

  def application do
    [
      extra_applications: [:logger],
      mod: {SymphonyLiteElixir.Application, []}
    ]
  end

  defp deps do
    []
  end
end
