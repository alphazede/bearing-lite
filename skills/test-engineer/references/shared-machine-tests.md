# Tests on a Shared Machine

Gates run on machines that other gates, agents, and test suites share. A test
that passes alone and fails under load is a defect in the test, and gate time a
plan adds is a cost the plan must state before landing, not discover at it.

## A. Correct on a shared, loaded machine

1. Never pick a free port, release it, and rebind it later. Bind port 0 and
   read back the bound port, or hand the open listener to the code under test.
2. Assert only on resources the test created and owns: its processes, files,
   ports, windows, and records. Never count or inspect machine-wide state.
3. Wait for readiness with one bounded deadline sized for a loaded machine,
   polling the real readiness signal. No fixed sleeps, no stacked per-step
   timeouts, no unbounded waits.
4. Serialize a truly shared resource (a display, a system service, a fixed
   device or port) with a cross-process lock, not an in-process mutex or test
   ordering. Name the lock in code.
5. Give every test run a unique temporary root and remove it on every path.
6. Give every fault-injection case fresh state; never reuse an engine or store
   that an earlier fault case may have damaged.
7. A test that starts an engine, server, driver, or browser passes N consecutive
   runs and one run of two concurrent copies of its suite on the same machine
   before review. The plan names N and the command.
8. Failures carry the error and the engine log tail.

## B. Fast, with visible cost

1. Engine-backed suites run only when code or payload paths they cover change; the gate
   declares those paths.
2. Group suites by the real shared resource they need, so groups that share
   nothing run in parallel and only same-resource suites serialize.
3. Reuse one warm engine per test binary or process instead of starting one
   per case, while keeping per-case state fresh (A6).
4. Each engine-backed verification case declares its `resource_group` and
   `expected_gate_seconds` in `seit.json`.
5. The integration plan states, per wave, the gate time the wave adds
   (`added_gate_seconds`) and the resource groups it competes for
   (`resource_groups`) in `implementation.json`.
6. The gate prints the slowest tests each run.
7. Review and landing share one qualified gate run for the same candidate;
   required independent assurance still applies.

A missing declaration on an engine-backed case, or a wave that adds gate time
without stating it, is a planning finding. A test that fails A7 is not ready to
land.
