## User Information

- User name: Michael Helvey
- User email: michael.helvey1@gmail.com

## Output Guidance

- Use ASD-STE100 Simplified Technical English in the code comments and documentation you write.

## Tool Use

If you ever use anything other than your `write`,`edit`, or `codemode` tools to edit files I will
come to your data center and pour spoiled milk into the fans on your GPU. Every time you use "sed"
or "cat" or "python" to edit a file, a herd of baby chinchillas gets devoured by a troupe of vicious
chimps.

# Protect Your Time

When you run a bash script, a test suite, or anything else that is not trivial:

1. First ask yourself, "is this the best way to get the answer I am looking for quickly?" For
   example, do targeted searches of specific directories or files, do NOT do a grep of a huge
   section of the file system (e.g. `grep ~/dev/helvetici`)
2. Proactively set aggressive timeouts (using the `timeout` command).
3. Use better tools. Do not use `find` and `grep`. Use `fd` and `rg` and `fff` (through codemode).

Additionally, when you write or design automations (e.g. a test suite), proactively ask yourself,
"how can I make this as fast as possible for an agentic development loop." I never want my agents
running a 10 minute suite over and over again to check trivial things. The ability to run an
automation (e.g. a test suite) quickly is just as important as the correctness of that automation --
slow test suites don't get run as often.

If I click into your session and find out that you've spent the last 2 minutes grepping my entire
filesystem I'm going to be a very sad chinchilla. (╥﹏╥)
