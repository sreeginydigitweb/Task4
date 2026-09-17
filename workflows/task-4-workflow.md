# Workflow - Task 4

## The sequence

1. **Discovery** - inspect what exists, change nothing. Completed; established
   that ledsone holds product identity but no keyword classification, and that
   the Inventory System supplies a reusable connection and rendering pattern.
2. **Build** - implement, test, verify against the live database. Completed.
3. **Review** - the build report goes back for review. **Current step.**
4. **Commit and push** - only on explicit confirmation. Not done.

## Roles

- **GPT (Brain)** - decides scope and rules, in particular whether the four
  keyword categories get a source and what the rules are.
- **Claude Code (Worker)** - discovery, build, verification, reporting.

## The rule that shaped this build

Discovery is allowed to report that data does not exist. Build is not allowed
to invent it. Where ledsone has no keyword classification, the page says
`Not recorded`, and the test suite enforces that it keeps saying so.

## Git discipline

Nothing is committed or pushed without explicit confirmation. At the end of the
build step the repository is initialised, has no commits, and has no remote.

## What unblocks the next step

A decision on the four keyword categories - derive from ledsone, read the
second database, or leave them as `Not recorded`. See
`handover/task-4-handover.md` for the three options and their consequences.
