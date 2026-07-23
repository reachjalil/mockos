# `@mockos/sandbox`

The runtime-neutral contract for validating and invoking versioned mockOS scripts.

F0 ships only `NoSandbox`, the fail-closed default. It reports that script execution
is unavailable, returns a structured validation rejection, and throws before reading
or evaluating script source. Worker Loader and test-only Node VM providers belong to
F3 and are not represented as available here.

The workspace package remains private while the F3 runtime qualification is open.
