# Optional review techniques

When the owner requests a deeper check of a small risky diff, find the one
fact the change is safe because of and push it down this ladder as far as is
cheap: asserted, cited `file:line`, failure path walked, proved by a script
calling the real code, reproduced in the running app. Report where it stopped.

Interrogation (adversaries) and arena (parallel candidates) run only on an
explicit owner request. The one-review, one-repair allowance is unchanged.
No extra agent is started automatically.
