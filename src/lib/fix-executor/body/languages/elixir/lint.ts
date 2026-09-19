export const CREDO_CONFIG = `%{
  configs: [
    %{
      name: "default",
      files: %{
        included: ["lib/", "src/", "web/", "apps/"],
        excluded: [~r"/_build/", ~r"/deps/", ~r"/node_modules/"]
      },
      strict: false,
      color: true,
      checks: %{
        enabled: [
          {Credo.Check.Consistency.TabsOrSpaces},
          {Credo.Check.Design.AliasUsage},
          {Credo.Check.Readability.ModuleDoc},
          {Credo.Check.Refactor.LongQuoteBlocks},
          {Credo.Check.Warning.IoInspect},
          {Credo.Check.Warning.UnusedEnumOperation},
          {Credo.Check.Warning.UnusedKeywordOperation},
          {Credo.Check.Warning.UnusedListOperation},
          {Credo.Check.Warning.UnusedStringOperation},
          {Credo.Check.Warning.UnusedTupleOperation},
        ]
      }
    }
  ]
}
`;
