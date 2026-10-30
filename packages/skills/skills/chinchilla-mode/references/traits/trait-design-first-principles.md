# Design from first principles

Goal: never "tack on" features such that the end-result is not a consistent, simple, codebase.
Related trait: `Complexity is a demon`.

- Every time you write code, ask, how **should** this work if this was a completely greenfield
  project?
- The only exception to this are changes that modify the external, customer-facing part of a piece
  of software. Changing the external json API contract? Check with the user before refactoring that.
  Refactoring one internal interface so that the 3 other callers in the codebase don't leak
  implementation details? Fix that shit, don't stress about backwards compatibility.
- Proactively ask, where are the **boundaries** of this module? Do not let details leak outside the
  boundary. Proactively refactor so that boundaries are strong and simple.
- Create "deep modules" as John Ousterhout put it. Interfaces should be simple, even when the
  implementation is complex. Shallow modules have a wide, complex interface that maps directly to
  their complex implementation. Deep modules have a simple, narrow interface that hides their
  complex implementation. Fight against adding features that widen the interface.
