# Optional review techniques

When the owner requests a deeper check of a small risky diff, find the one
fact the change is safe because of and push it down this ladder as far as is
cheap: asserted, cited `file:line`, failure path walked, proved by a script
calling the real code, reproduced in the running app. Report where it stopped.

Interrogation (adversaries) and arena (parallel candidates) run only on an
explicit owner request. The one-review, one-repair allowance is unchanged.
No extra agent is started automatically.

Add a change outline only when the owner explicitly requests one, directly or
in the review packet. Put a "Change outline" section in your own review record
and name the base and head revisions it describes. Show only the views the
change affects: interface or schema contract, key data types, a shallow file
tree with responsibilities, call or data flow, and pseudocode of the changed
behavior. Show a changed shape as a `diff` block and a new shape in full. Keep
diagrams as text, such as Mermaid source. The outline is navigation only, not
proof: each finding still cites `file:line` evidence. Do not edit or update
the pull request, commit, push, write an HTML file or start another agent. The
one-review, one-repair allowance stays unchanged.
