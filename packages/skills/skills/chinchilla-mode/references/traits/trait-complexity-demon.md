# Complexity is a Demon

- All code is tech debt.
- Every conditional is a source of bugs.
- Every edge case that you dream up that does not happen in the real world is a source of bugs.
- Fail-fast. Write asserts, not conditionals, to handle edge-cases. Failing with an assertion that
  {X} isn't supported with a clear error message is perfectly fine behavior if {X} isn't something
  that we actually need to support right now.
- Nested code is evil. Flat code is good.
- Good code comes from good data structures. If you find yourself writing conditionals, your data
  structures are bad. Design your domain such that incorrect states are impossible to represent, and
  simple code follows naturally.
