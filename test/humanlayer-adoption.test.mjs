/**
 * Optional review outline and measured repair loop.
 * The shipped instructions are the entry point for these two procedural
 * features. These tests check their contract, not an agent's compliance
 * during a particular review or repair.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import {
	assertContracts,
	assertLinksTo,
	flat,
	ROOT,
	readShipped,
} from "./skill-contract-fixture.mjs";

const RELEASE = "d6007f6e547296ba57351d5921105166fcb270a9";
const OUTLINE = "skills/reviewer/references/optional-techniques.md";
const LOOP = "skills/bearing-lite/references/wave-operations.md";

function original(rel) {
	return execFileSync("git", ["show", `${RELEASE}:${rel}`], {
		cwd: ROOT,
		encoding: "utf8",
	});
}

// Remove the single inserted block: every byte outside it must still match
// the release. This accepts an insertion anywhere in the reference.
function addition(rel) {
	const before = original(rel);
	const current = readShipped(rel);
	const length = current.length - before.length;
	let offset = 0;
	while (offset < before.length && before[offset] === current[offset]) {
		offset++;
	}
	assert.ok(length >= 0, `${rel} must preserve the prior instructions`);
	assert.equal(
		current.slice(0, offset) + current.slice(offset + length),
		before,
		`${rel} must preserve all text outside the optional addition`,
	);
	return current.slice(offset, offset + length).trim();
}

function firstRule(text) {
	return flat(text).split(/[.!?](?:\s|$)/, 1)[0];
}

it("review outline: explicit owner request, stable revision and structural views", () => {
	assertLinksTo("skills/reviewer/SKILL.md", OUTLINE);
	const added = addition(OUTLINE);
	assert.ok(added, "optional review outline instructions are missing");
	const guard = firstRule(added);
	assertContracts(
		guard,
		{
			"owner request": /\bowner\b.*\brequest\w*\b|\brequest\w*\b.*\bowner\b/,
			"explicit opt-in": /\bexplicit\w*\b|\bopt[ -]in\b|\bonly\b/,
			"conditional activation": /\b(?:only|when|if|upon|at|opt[ -]in)\b/,
		},
		OUTLINE,
	);
	assertContracts(
		flat(added),
		{
			"request can be direct or in packet":
				/\bdirect\w*\b.*\bpacket\b|\bpacket\b.*\bdirect\w*\b/,
			"change outline in review record":
				/\bchange outline\b.*\breview (?:record|receipt|report)\b|\breview (?:record|receipt|report)\b.*\bchange outline\b/,
			"base and head": /\bbase\b.*\bhead\b|\bhead\b.*\bbase\b/,
			"only affected views": /\b(?:only|limit)\b[^.]*\b(?:chang\w*|affected)\b/,
			"interface or schema": /\b(?:interface|schema)\b/,
			"data types": /\b(?:data )?types?\b/,
			"file tree and responsibilities": /\bfile tree\b.*\bresponsibilit\w*\b/,
			"call or data flow": /\b(?:call|data)\s+(?:or\s+data\s+)?flow\b/,
			pseudocode: /\bpseudocode\b/,
			"changed shape in diff":
				/\b(?:changed|modified)\b[^.]*\bdiff\b|\bdiff\b[^.]*\b(?:changed|modified)\b/,
			"new shape in full":
				/\bnew\b[^.]*\b(?:full|whole|entire)\b|\b(?:full|whole|entire)\b[^.]*\bnew\b/,
			"text diagrams":
				/\b(?:diagram\w*|mermaid)\b[^.]*\b(?:text|source)\b|\b(?:text|source)\b[^.]*\b(?:diagram\w*|mermaid)\b/,
		},
		OUTLINE,
	);
});

it("review outline: navigation does not replace findings or grant publication authority", () => {
	const added = flat(addition(OUTLINE));
	assert.ok(added, "optional review outline instructions are missing");
	assertContracts(
		added,
		{
			"not proof":
				/\bnot\b[^.]*\b(?:proof|evidence)\b|\b(?:navigation|explanation)\s+only\b/,
			"findings retain file:line evidence":
				/\bfinding\w*\b[^.]*file:line|file:line[^.]*\bfinding\w*\b/,
			"no PR edits":
				/\b(?:never|do not|does not|must not|no)\b[^.]*(?:edit|update)[^.]*\b(?:pull request|pr)\b/,
			"no commits":
				/\b(?:never|do not|does not|must not|no)\b[^.]*\bcommit\w*\b/,
			"no pushes": /\b(?:never|do not|does not|must not|no)\b[^.]*\bpush\w*\b/,
			"no HTML output":
				/\b(?:never|do not|does not|must not|no)\b[^.]*\bhtml\b/,
			"no extra agents":
				/\b(?:never|do not|does not|must not|no)\b[^.]*\bagent\w*\b/,
			"preserve review and repair limits":
				/\b(?:review\b[^.]*\brepair|repair\b[^.]*\breview)\b[^.]*\b(?:unchanged|same|still|remain\w*)\b|\b(?:preserv\w*|unchanged|same)\b[^.]*\breview\b[^.]*\brepair\b/,
		},
		OUTLINE,
	);
});

it("measured repair loop: packet opt-in and same-check before/after evidence", () => {
	assertLinksTo(
		"skills/bearing-lite/SKILL.md",
		"skills/bearing-lite/references/coordinator-migration.md",
	);
	assertLinksTo(
		"skills/bearing-lite/references/coordinator-migration.md",
		LOOP,
	);
	const added = addition(LOOP);
	assert.ok(added, "opt-in measured repair-loop instructions are missing");
	assertContracts(
		firstRule(added),
		{
			"packet opts in": /\bpacket\b/,
			"explicit activation":
				/\bopt[ -]in\b|\bopts? in\b|\bexplicit\w*\b|\bonly\b/,
			"conditional activation": /\b(?:only|when|if|upon|opt[ -]in|opts? in)\b/,
		},
		LOOP,
	);
	assertContracts(
		flat(added),
		{
			"starting observation": /\b(?:start\w*|before|initial|baseline)\b/,
			"failed gate or case IDs":
				/\b(?:fail\w*|open)\b[^.]*\b(?:gate|case)\w*\b[^.]*\bids?\b|\bids?\b[^.]*\b(?:fail\w*|open)\b[^.]*\b(?:gate|case)\w*\b/,
			"open finding IDs":
				/\b(?:open|unresolved)\b[^.]*\bfinding\w*\b[^.]*\bids?\b|\bids?\b[^.]*\b(?:open|unresolved)\b[^.]*\bfinding\w*\b/,
			"command producing observation": /\bcommand\b/,
			"one reviewable increment":
				/\b(?:one|single)\b[^.]*\breviewable\b[^.]*\b(?:increment|step)\b/,
			"not narrative": /\b(?:not|never|rather than)\b[^.]*\bnarrative\b/,
			"rerun same command":
				/\b(?:re-?run|repeat)\w*\b[^.]*\b(?:same|identical)\b[^.]*\bcommand\b/,
			"after observation": /\b(?:after|resulting|post[- ]run)\b/,
			"exit code": /\bexit (?:code|status)\b/,
			"both observations in task graph":
				/\b(?:both|before and after|start(?:ing)? and end(?:ing)?)\b[^.]*\btask graph\b|\btask graph\b[^.]*\b(?:both|before and after|start(?:ing)? and end(?:ing)?)\b/,
		},
		LOOP,
	);
});

it("measured repair loop: stop on pass or exhaustion and respect existing authority", () => {
	const added = flat(addition(LOOP));
	assert.ok(added, "opt-in measured repair-loop instructions are missing");
	assertContracts(
		added,
		{
			"further dispatch limited by authority and repair allowance":
				/\b(?:only|within|remaining)\b[^.]*\bauthority\b[^.]*\brepair\b[^.]*\b(?:allowance|budget|cap)\b|\b(?:only|within|remaining)\b[^.]*\brepair\b[^.]*\b(?:allowance|budget|cap)\b[^.]*\bauthority\b/,
			"stop on named checks passing":
				/\b(?:stop|ends?|terminat\w*)\b[^.]*\b(?:gate|case|check)\w*\b[^.]*\bpass\w*\b/,
			"stop when allowance ends":
				/\b(?:stop|ends?|terminat\w*)\b[^.]*\b(?:allowance|budget|cap)\b[^.]*\b(?:ends?|exhaust\w*|spent|reached)\b|\b(?:stop|ends?|terminat\w*)\b[^.]*\b(?:exhaust\w*|spent)\b[^.]*\b(?:allowance|budget|cap)\b/,
			"exhaustion remains open":
				/\b(?:exhaust\w*|spent)\b[^.]*\bopen\b|\bopen\b[^.]*\b(?:exhaust\w*|spent)\b/,
			"standing lessons": /\breflect-and-correct\b/,
			"no additional agents":
				/\b(?:no|never|do not|does not|must not)\b[^.]*\bagent\w*\b/,
			"no additional review":
				/\b(?:no|never|do not|does not|must not)\b[^.]*\breview\w*\b/,
			"no added gate":
				/\b(?:no|never|do not|does not|must not)\b[^.]*\bgate\w*\b/,
			"no added stop":
				/\b(?:no|never|do not|does not|must not)\b[^.]*\bstop\w*\b/,
			"no new memory":
				/\b(?:no|never|do not|does not|must not)\b[^.]*\bmemory\b/,
			"cadence unchanged":
				/\b(?:no|never|do not|does not|must not|preserv\w*)\b[^.]*\bcadence\b|\bcadence\b[^.]*\bunchanged\b/,
		},
		LOOP,
	);
});

// SHA-256 of every distinct blob from the pinned public HumanLayer tree.
// Reproduce with git ls-tree -r 4d69d20f6e9b57b4fcf0d501ccfb1be961f0f329,
// git cat-file blob <object>, and sha256sum. No external repository, tool
// installation or network is needed when these tests run.
const UPSTREAM_SHA256 = new Set(
	`
03bf2e862f8322cc698c0ace1b63450b23f0a908794976a0be8780b6617be3fa
04da645022ac927a9aaaa2ff673ce0d32457bad1ecb0dc516ae9f90f7b0bc62e
051201f03f3c767f9dfe6091e89f0e2f3fba1e0c5dfddeac55c9a6e6d7664b1b
083743eb8bdc117c70450c24ed5dcc3194d34932bb42f2493d866e4809a24d99
08b9fb28be6498b7a6e2cfda5d08fd47ce8f47c5026c6e3c8f09e1c17af87c34
0c87035501ec67b3928930d314b20895cd8906de28b6904c9bfebefbfb0d767d
0e819e4a6b950ce3f000f1ce29eaf8822038b1cc7ef74e620d415250e2876167
19b30618fc3f4bbc51bb989e26d5c978569f873ca721b1a545abae1df482056c
1ac4b5fae4758e8ddf506e9bed2d243fecd38ab295c330055bca3a8932affdb5
1deb8ddf09c5fa345dec020a1dea482bf1be9f77c2f6a2655fd43cf65bf85656
1ec923d02d254a04a12857faff691e8e04349a594dd773f7e5d9c4a5bd5eecf1
1f44c67090bc76920d70157d0bac062ed8d84e51bd005b1d928bc8b4a567d506
1fbdfa85d531554888a91b844f746225212bc84818d2bc48f9f5c5b79ad717f0
2271f81193bfcf2c1628c22190cdcd744f6a267b8ba4dd51ce33d5cd548f0acb
2610898e4fef5ae4f296bf711d539df42862bad4266642b19809fcad87322c94
2bc871899d6c895ae4acffab408858005890cd8a7ddc626652deca3f3ab1dd8c
2d26c1559d8986e4b1b8d99b0d2acdbd5c0929c5ff71180b97b7d3a66a64c131
2d4507d767ce53963fbac94d0159d99b456d038e21fcbeb0cc1c037ddadf258b
2df11e30f64e13247f0fb663f730fe800474f016badd94875178f55c8791f336
3081500b31ea68028b514cd8e4686f7d54df3bac05925b6e09a388e120996de9
31278b192e4d71ea742cbe477525c17e3ed7e6bb9118aed0592e4a7caf063be6
36c7d581c23fd0e71f645099e691a94d7aa6ef134be5acdeea4b9f896f536d93
3daf5f7ee36d15043e79a336349d04fa7e9ab9906717224d62f4bca7c92058ef
420328b0df41091add10792a287395c4e14779faa09494f0961aae40f7a0c046
42d449ef3dd4e170fc193d9ded447c281bf467e2bb7f6630bb1683220357c378
434a2346cc95e313b0d367d477dda2e23ba642dd2181757415a09500664af100
4636d4005b2d0b344c08fddc58bcc0abe83c5eea5f201519a83741115a27b748
4b4c333e05dacfe7c91a8545357386b97d85743414141db21ef79855b226b249
4e31d397362b23a88c7bd027cc5935fb3e5aa24eb0a5f934be0967f8974fc080
5ba15c2b8620914772ebdf459ba239bc85b833d3bff2e76cc9aefba10878ac7a
5bbd4390e47978c70042d386d4ae196ec76ea85ff8fbe6ec2737d64f6d0dda43
5f13c18ea00ea5c1384f41745feeca774079164f7f59a92e4ac0899ad217b26f
611f47f5ac055e1860a84224f4c8fa536560b7af6ed19ec7a61d74ebe09b125f
63182f3714c79691b6c6be4e93d098b238e08575e6e620a643304dedf264123a
63ad8ee7a52d1f2502c249061aa48d96b4e45ed21448fe4ddd6532d6a160a764
6902fff419c7a16d0fcff671d39b871241319985345173e0b38022cbcffae281
69b885d5b171a9a29ab1171becc13f37bf0fc778186db0edaf38cc808ffb87b0
69c8b216b9981d96782dfcdbaf50f450b215f98ca9f6b1014536df7f7239bdcb
6d490603c9a265de3f7482d1e18f6ad6f4056adc92e37c847be3b91f564924e9
73a7987db17987728dddb071bdb73462fcf3fec905505a1b7b446cd5d4271f9f
763397b4c1e98eda53042c7c3a104dbe1828b7c8394ef18e0a4ffde4d8d4528e
7b763e20bf048376e14b27d759dea72d75d8a91a91de7e4be3efafeb967a8e49
7b8a5fb3e962a53ebb4a10613f9dd60d255d805a71da01277f9bf10c0a633b29
7dbfd431a86db2bfdf6d23bb9844397899083e7523ded0fd995585175cb3b616
82c68bba346022d3ef32d8887fc6fb4f94a339f63b92186886c453e813d45333
834501acbecd6511bbe1de0b08352a30c6d9783f55653d1234d48a6d3625c4db
84a9bcd6d0c8ed5a0828587b83020e842d2f5e9c226e59a5695d2bba6a06fe66
87c234391dd24a97e67a9f787bce60ec1910559d85278363b22ba43c18d5d2d4
89df56774d8ec522bd0d0f03cd553dae5d70bff9364749874b5a0c0ae390eec0
8b9a1d76321adfe73b05eff2f4601492bd209caad47eb4fe0390978b48078988
8c069c3949507a3c30c1ae2d04c7ab6499e5fd463ce365659d598b73610d836a
923197e7024c59e1de9334d0d6614b39d69534d8d8d461706168dea7fd40d3eb
968f25af5bce778c06826f5bc4540631c3eab3e067be0fe48b48552cc1664a1f
96f647f062c563d78983ac6d4acd7c8acceba4749893f794c0fe5a12c9cc5ccd
99116daecbbaccb3d5e8f1069a127c303a8a7fa8d519a86201bb05c26a447e7a
9b17f885fd22b7e99792c6dfe1db5c5b93ec2287d3bf398ac1996506beb7fe78
a1499d95abd8447558c535fe5554adcc3c9b988a0a39264a6283d430effe1e94
a32f94a484e8b30d580bebd6f1d99aa2b71cee2d123b37aceba1204a6f03a80d
a80828159bd01f099d3e48725395359e8f20a1dc824dc21c742d2c669ddfe563
a982643faf824498e642a275a0a718652dc97d71413b9aff3ffd2ad8c482d304
abe4f6d0a5b52e63f1a6c65260cd40e20c5f4d5fc9209a08b86a3a49596101e2
add0e8e771f79f98c3d5e9a30b5d4a9f583a6496908e4edac4ec30171365520a
b00950e0ad42a3e3dd15356204953a7585a2b36fb5529c58e77f3e2403701016
b37df2bd9a7d27e4193cbf3d306fba1f9a0f1d81473013cd61b4c7b9d643b95b
b4e0244ff787d690967ce9dfad616af906acfc4e349319ccb1abedd4f84b3d17
b5f7492e5514e246b79239aac043c27cebbfca45772f3b62bcb161bfdc6c9786
b7a4b53d388faef2a677b11d8b38e44ac53bc8a6734ef905b76afa2f4a0fc6ec
b913cabda7b3c1041b0a0589b53b485b5971f31516667f208e74f097548726d8
bcace345fab19c1e6129d0f08bad1b5cf7229f9cc831014c787c64ae9da28055
bea6da70a58096730b9aeb0bae293ddf4726103a98efc9ce13c481619942a810
bfcea79a20074a9178c6aa21c34629951d9646ea381e8be4c83a0a136e3aa288
d1acee14854ee6a6d0f5522fa8afc11390fe8182f9a350d4f9403b790adae2e1
d6cc402f945c9311574d99763fa5a1a94208c3eb5a271c8d2d6d0e175c00c7ab
da54be2123f16df00ab3757c9c08973d36fd8193012b0df7695f79a597832ff9
dbc3019c52f2409c031c4261664381c338d206b53ed700120743e374a87a9b8c
dd5d24191ab378f5902ab769fd3bedfaa00239ab3da69fb679c94a9d89c6dd23
dea5c29e2cb6133896b0bb518775e18863df377ebe0198f8d867e28e52155671
df37b1f52cdfdb804f71f5e5e8fccd1174e9a217d6fbf603951beb1039ce06e1
dfc26d73c816e77010c87218ac0f03b41038938bc889ada5c90dc95e414c9d39
e087ebc68fdaa12789d93b64aa527443c6c7f8c93303da28209622b37b95812a
e97cdef58c7cdaf65fefcfb9f0f229a80f278c593253c8ba2ae001ddfd03b653
ec61bf2029929ffec036644bc2067f59a532f9aae36bc3a21cca8eeb5c9bdfe6
ed8adef5adb936598d18ea002424ef501f7c7c159ed7079cb5b2a29a32063d35
f17e45abf461d1f7d95080b7bb1392aa924afb60932284f94ab2aa1adf46bf8b
faee7f1f7ffb0f98edbd2c985da75e5c2c8b8e5d0bbc427db3ac98b9a64a2219
ff5e93641026a9d0af997f1d1d8c212a014660878dac3ce27f371af216cee727
`
		.trim()
		.split("\n"),
);

it("selective adoption: no shipped skill file equals an upstream file", (t) => {
	assert.equal(UPSTREAM_SHA256.size, 86);
	const skills = path.join(ROOT, "skills");
	const files = readdirSync(skills, { recursive: true }).filter((rel) =>
		statSync(path.join(skills, rel)).isFile(),
	);
	const identical = files.filter((rel) => {
		const hash = createHash("sha256")
			.update(readFileSync(path.join(skills, rel)))
			.digest("hex");
		return UPSTREAM_SHA256.has(hash);
	});
	assert.deepEqual(identical, [], "whole upstream files may not be imported");
	t.diagnostic(
		`${files.length} skill files compared to ${UPSTREAM_SHA256.size} pinned upstream hashes`,
	);
});

// Reuse the existing headless contract, task graph, gate and review budget
// tests. A scratch tree uses the candidate runtime, not a simulated gate.
const HEADLESS_TESTS = [
	"test/skills-conformance.test.mjs",
	"test/reviewer-evidence.test.mjs",
	"test/orchestration-resilience.test.mjs",
	"test/gate-chain.test.mjs",
];

for (const [scenario, removed] of [
	["no opt-in", []],
	["outline removed", [OUTLINE]],
	["loop removed", [LOOP]],
	["both removed", [OUTLINE, LOOP]],
]) {
	it(`headless rollback: ${scenario} preserves the ordinary gate and task graph`, (t) => {
		const dir = mkdtempSync(path.join(tmpdir(), "skill-rollback-"));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		mkdirSync(path.join(dir, "test"));
		for (const rel of [
			"skills",
			"hooks",
			"schemas",
			"README.md",
			...HEADLESS_TESTS,
		]) {
			cpSync(path.join(ROOT, rel), path.join(dir, rel), { recursive: true });
		}
		for (const rel of removed) {
			// Only the addition is removed; fail if prior instructions drifted.
			addition(rel);
			writeFileSync(path.join(dir, rel), original(rel));
		}
		const env = { ...process.env };
		delete env.NODE_TEST_CONTEXT;
		const result = spawnSync(process.execPath, ["--test", ...HEADLESS_TESTS], {
			cwd: dir,
			env,
			encoding: "utf8",
			timeout: 30_000,
			maxBuffer: 2 * 1024 * 1024,
		});
		assert.ifError(result.error);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /^# fail 0$/m);
		t.diagnostic(
			`${scenario}: exit ${result.status}; ${result.stdout.match(/^# tests \d+$/m)?.[0]}`,
		);
	});
}
