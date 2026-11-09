# Create a note

Create note lets a user save a titled note from the browser or the CLI, cancel an unfinished draft,
and confirm the saved note from a second view.

## Sub-features

- `create-open` opens a blank editor from each browser entry point.
- `create-save` saves a title and body.
- `create-cancel` discards an unfinished browser draft.
- `create-cli` creates the same note shape from the terminal.

## How to get to it (user POV)

- Choose the `New note` button in the browser toolbar.
- Press `n` in the browser while focus is outside an editable field.
- Run `notes create --title <title> --body <body>` in a terminal.

## Driving it with control-notes

Preconditions:

- `control-notes doctor --env <env>` passes.
- No note has the title `$TITLE`. Locally `TITLE=Release checklist`. In alpha
  `TITLE=[verify $RUN_ID] Release checklist`.

- **Open editor.** Choose `New note`. Run
  `control-notes browser --env <env> click --role button --name "New note"`. A form named
  `Note editor` appears with focus in the `Title` textbox.
- **Enter content.** Type the title and body. Run
  `control-notes browser --env <env> fill --role textbox --name "Title" --value "$TITLE"` and
  `control-notes browser --env <env> fill --role textbox --name "Body" --value "Tag and publish"`.
  The `Save note` button becomes enabled.
- **Save note.** Choose `Save note`. Run
  `control-notes browser --env <env> click --role button --name "Save note"`. A status named
  `Note saved` appears and the heading reads `$TITLE`.
- **Confirm persistence.** Go back to the note list and open the note again. Run
  `control-notes browser --env <env> click --role link --name "All notes"` and
  `control-notes browser --env <env> click --role link --name "$TITLE"`. The editor shows both saved
  values.
- **Confirm storage.** Read the row through the database access of the environment. Run
  `control-notes db --env <env> -c "select title, body from notes where title = '$TITLE'"`. One row
  comes back.
- **Proof.** Run
  `control-notes browser --env <env> snapshot --aria --path $EVIDENCE/create-note/list.aria.txt` and
  `control-notes browser --env <env> screenshot --path $EVIDENCE/create-note/list.png`. The
  artifacts show `$TITLE`.

## Environments

- **local**: all sub-features.
- **alpha**: all sub-features. Use the `[verify $RUN_ID]` title prefix. Delete the notes in cleanup.
- **prod**: not covered. Each sub-feature writes, and prod is `read-only`.

## Gotchas

- Pressing `n` while a textbox has focus types the character and does not open a new editor.
- Titles are trimmed on save. Assert the rendered title, not the draft input value.
- A save status alone is not sufficient proof. Open the note again from the list.
- Remove the created notes during cleanup, but keep their proof artifacts.
