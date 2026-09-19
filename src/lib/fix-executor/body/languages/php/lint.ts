const PHP_SOURCE_DIRS = ["app", "src", "tests"] as const;

/** Build a PHP-CS-Fixer config that only names directories the repository actually has. */
export function phpCsFixerConfigForProject(filePaths: string[]): string {
  const dirs = PHP_SOURCE_DIRS.filter((dir) =>
    filePaths.some((path) => path === dir || path.startsWith(`${dir}/`)),
  );
  const finder =
    dirs.length > 0
      ? dirs.map((dir) => `    ->in(__DIR__ . '/${dir}')`).join("\n")
      : `    ->in(__DIR__)
    ->exclude(['vendor', 'var', 'cache', 'storage', 'public'])`;

  return `<?php

$finder = PhpCsFixer\\Finder::create()
${finder};

return (new PhpCsFixer\\Config())
    ->setRules([
        '@PSR12' => true,
        'array_syntax' => ['syntax' => 'short'],
        'no_unused_imports' => true,
        'ordered_imports' => true,
    ])
    ->setFinder($finder);
`;
}

/** Backward-compatible Laravel-shaped default for preview/static consumers. */
export const PHP_CS_FIXER_CONFIG = phpCsFixerConfigForProject([
  "app/Http/Controllers/Controller.php",
  "tests/TestCase.php",
]);
