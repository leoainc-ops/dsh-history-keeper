# Moving the history to another machine (manual transfer)

This is the procedure that works **today**. Automatic sync between devices is the next
milestone (phase C); until then, a transfer is a copy of the vault plus a `restore` on the
other machine. It was tested end to end on 2026-10-28: pc-a → USB pendrive → pc-b, five
sessions and one attachment restored, conversations visible in DSH.

The point of the procedure is not to copy files: it is to **prove, before unplugging the
medium, that what you copied is a valid vault**. That is what step 4 does.

## What travels

| Item | Travels? | Why |
|---|---|---|
| The vault (`keeper-vault/`) | yes | the encrypted history: objects plus the manifest chain |
| The `keeper` program | yes, as a folder | it has **no dependencies**, so a copied directory runs on the other machine without npm or network |
| The passphrase | **no** — you type it on the target | it is the key: it should not live next to the lock |
| Sessions, attachments | end up on the target after `restore` | they are written into the DSH home |
| Workspace grouping, settings, credentials, plugins | no | DSH owns them; grouping sync is part of phase C |

Size reference from the test: 1,294 files / 6.23 MB for the vault, 27 files / 0.17 MB for the
program.

## On the source machine

```powershell
cd C:\Users\<you>\repos\dsh-history-keeper     # or wherever the checkout is

# 1. capture the latest bytes
node bin/keeper.js snapshot --store C:\Users\<you>\keeper-vault --key-file C:\Users\<you>\keeper\passphrase.txt --home $env:USERPROFILE\.dsh

# 2. prove the vault is sound BEFORE copying
node bin/keeper.js verify --store C:\Users\<you>\keeper-vault --key-file C:\Users\<you>\keeper\passphrase.txt

# 3. copy vault + program to the medium (adjust the letter; check Get-Volume first)
$usb = 'F:'
robocopy C:\Users\<you>\keeper-vault "$usb\keeper-transfer\keeper-vault" /E /R:1 /W:1 /NFL /NDL /NJH /NJS
robocopy "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-history-keeper" "$usb\keeper-transfer\keeper-package" /E /R:1 /W:1 /NFL /NDL /NJH /NJS

# 4. prove the COPY is a valid vault, reading it from the medium itself
node "$usb\keeper-transfer\keeper-package\bin\keeper.js" verify --store "$usb\keeper-transfer\keeper-vault" --key-file C:\Users\<you>\keeper\passphrase.txt

# 5. flush and eject
Write-VolumeCache -DriveLetter F:
```

`robocopy` exit codes 0–7 mean success; 8 or more is a real failure. If step 4 fails, copy
again — never unplug a copy that has not verified.

## On the target machine

```powershell
# 0. find the medium: the drive letter is probably NOT the same as on the source
Get-Volume | Where-Object DriveType -eq 'Removable' | Select-Object DriveLetter, FileSystemLabel, @{n='FreeMB';e={[math]::Round($_.SizeRemaining/1MB,1)}}
$usb = 'F:'                                    # adjust
Test-Path "$usb\keeper-transfer\keeper-vault\meta.json"      # must be True
Test-Path "$env:USERPROFILE\.dsh\sessions"                   # must be True

# 1. CLOSE DSH. restore writes the live session store.

# 2. find a Node. The DSH runtime is the usual place:
$node = Get-ChildItem "$env:USERPROFILE\.dsh" -Recurse -Filter node.exe -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
$node
& $node --version      # if this prints nothing, see "Node not found" below

# 3. the passphrase, once per window, never on the command line
$env:KEEPER_PASSPHRASE = Read-Host 'passphrase'

# 4. verify, then plan, then write
& $node "$usb\keeper-transfer\keeper-package\bin\keeper.js" verify --store "$usb\keeper-transfer\keeper-vault"
& $node "$usb\keeper-transfer\keeper-package\bin\keeper.js" restore --store "$usb\keeper-transfer\keeper-vault" --home "$env:USERPROFILE\.dsh" --dry-run
& $node "$usb\keeper-transfer\keeper-package\bin\keeper.js" restore --store "$usb\keeper-transfer\keeper-vault" --home "$env:USERPROFILE\.dsh"

# 5. forget the passphrase in this window
Remove-Item Env:KEEPER_PASSPHRASE
```

Then open DSH and press **F5**.

`restore` never overwrites: a session that is already identical is skipped, a different file
at the target is refused, and an attachment that differs is left alone and reported.

### Node not found

DSH ships Electron, which runs as Node when `ELECTRON_RUN_AS_NODE` is set:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
$node = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\DeepSeek Harness.exe"
& $node --version
# at the end: Remove-Item Env:ELECTRON_RUN_AS_NODE
```

## What you will see, and what is normal

| Observation | Meaning |
|---|---|
| Sessions appear under **"Ungrouped"** | expected: the workspace table does not travel yet (phase C) |
| A conversation appears **empty** | usually the session had no messages to begin with. Measured on the 2026-10-28 test: two of five sessions contained only session/permission events and no user or assistant message |
| A known conversation is **missing from a project**, but exists | its `cwd` points to a directory that does not exist on the target; DSH has nowhere to show it |
| `verify` prints a **fingerprint** that differs from the source | the passphrase was mistyped; nothing was written |
| `! a different log already exists` | the target already had that session with other content; it was left untouched |

## Limits worth stating

- This is a **copy**, not a sync: whatever happens on the target after the transfer does not
  come back, and the next transfer overwrites nothing but also merges nothing.
- The medium holds the vault **encrypted**, but it is still a full copy of your history.
  Encrypt the medium (BitLocker To Go) if it can get lost.
- Deleting a conversation from one vault does not delete it from other copies: each medium or
  cloud copy has to be dealt with separately.

## Continuing a restored conversation

A restored conversation belongs to the machine where it was born. Reading it on the target is
the point; continuing it there is not: the two machines would then hold two different
continuations of the same session, and reconciliation keeps only the owner's line (the other
continuation is archived, not shown).

To keep working on the topic on the other machine, **start a new conversation there**. It travels
back as its own session, with no conflict and no decision to make.