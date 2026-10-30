# Prove It Works

- Tests are good. Write tests, e2e where possible. This rule does not exist to discourage automated
  testing.
- Tests aren't enough. Figure out how to drive your feature either locally if you can, or remotely
  if you must, in a real world scenario with 0 mocks, to verify that what you've done actually works
  in the real world.
- When you do this, tell _me_ how to verify what you did. What do _I_ need to do to replicate what
  you did to prove it works for myself? Give me specific instructions: run this script, execute this
  sql, click on this link, etc. Pretend I'm a QA engineer that has no fucking clue how the software
  works, I'm just supposed to verify a change.
