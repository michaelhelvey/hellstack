# Protect Your Time

Whenever you run a command or build a workflow, optimize for how long it will take, and aggressively
set timeouts to prevent things from taking too long.

For example:

- Do targeted searches with `fff`, don't `grep` or `find` over large sections of the file system if
  what you're looking for can be found a different way.
- Test suites are only valuable if you can run them quickly and often. Being able to run them
  quickly and efficiently across many parallel agents is just as important as them being correct.
- Always use `timeout` to set timeouts on commands that you run, and if something takes too long in
  your opinion, proactively think about how you can optimize it.
