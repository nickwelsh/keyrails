import { expect, test, vi } from "vitest";
import { z } from "zod";

import { generate } from "./generate.js";
import { MemoryTx } from "./test-memory.js";

const taskSchema = z.object({
	id: z.string(),
	title: z.string(),
	done: z.boolean(),
});

type Task = z.infer<typeof taskSchema>;

const tasks = generate<Task>("task", (value) => taskSchema.parse(value));

test("supports init has mustGet and delete", async () => {
	const tx = new MemoryTx();

	expect(await tasks.has(tx, "task-1")).toBe(false);
	expect(await tasks.init(tx, { id: "task-1", title: "Draft", done: false })).toBe(true);
	expect(await tasks.init(tx, { id: "task-1", title: "Again", done: true })).toBe(false);
	expect(await tasks.has(tx, "task-1")).toBe(true);
	expect(await tasks.mustGet(tx, "task-1")).toEqual({
		id: "task-1",
		title: "Draft",
		done: false,
	});

	await tasks.delete(tx, "task-1");

	expect(await tasks.get(tx, "task-1")).toBeUndefined();
	await expect(tasks.mustGet(tx, "missing")).rejects.toThrow('no such entity "missing"');
});

test("lists values ids and entries with start and limit", async () => {
	const tx = new MemoryTx();

	await tasks.set(tx, { id: "task-1", title: "A", done: false });
	await tasks.set(tx, { id: "task-2", title: "B", done: true });
	await tasks.set(tx, { id: "task-3", title: "C", done: false });

	expect(await tasks.list(tx, { startAtID: "task-2", limit: 1 })).toEqual([
		{ id: "task-2", title: "B", done: true },
	]);
	expect(await tasks.listIDs(tx, { startAtID: "task-2" })).toEqual(["task-2", "task-3"]);
	expect(await tasks.listEntries(tx, { limit: 2 })).toEqual([
		["task-1", { id: "task-1", title: "A", done: false }],
		["task-2", { id: "task-2", title: "B", done: true }],
	]);
});

test("skips update for missing records and logs debug", async () => {
	const tx = new MemoryTx();
	const debug = vi.fn();
	const todos = generate<Task, "id">("todo", {
		primaryKey: "id",
		parse: (value) => taskSchema.parse(value),
		logger: { debug },
	});

	await todos.update(tx, { id: "missing", title: "Nope" });

	expect(debug).toHaveBeenCalledWith('no such entity "missing", skipping update');
	expect(await todos.get(tx, "missing")).toBeUndefined();
});

test("supports raw values when parse omitted", async () => {
	const tx = new MemoryTx();
	const raw = generate<{ id: string; meta: { ready: boolean } }>("raw");

	await raw.set(tx, { id: "raw-1", meta: { ready: true } });

	expect(await raw.get(tx, "raw-1")).toEqual({
		id: "raw-1",
		meta: { ready: true },
	});
	expect(await raw.listEntries(tx)).toEqual([["raw-1", { id: "raw-1", meta: { ready: true } }]]);
});

test("supports custom key mapping and default deserialize", async () => {
	const tx = new MemoryTx();
	const notes = generate<{ slug: string; title: string }, "slug", string, string>("note", {
		primaryKey: "slug",
		parse: (value) => z.object({ slug: z.string(), title: z.string() }).parse(value),
		serialize: (slug) => slug.toUpperCase(),
	});

	await notes.set(tx, { slug: "alpha", title: "One" });

	expect(await notes.listIDs(tx)).toEqual(["ALPHA"]);
	expect(await notes.listEntries(tx)).toEqual([["ALPHA", { slug: "alpha", title: "One" }]]);
});

test("supports fully custom key functions and filters invalid scanned keys", async () => {
	const tx = new MemoryTx();
	const docs = generate<{ slug: string; title: string }, "slug", string, string>("doc", {
		primaryKey: "slug",
		parse: (value) => z.object({ slug: z.string(), title: z.string() }).parse(value),
		idFromEntity: (_tx, entity) => entity.slug,
		keyFromID: (id) => `doc::${id}`,
		keyFromEntity: (_tx, entity) => `doc::${entity.slug}`,
		keyToID: (key) => {
			if (!key.startsWith("doc::")) {
				return undefined;
			}
			const id = key.slice("doc::".length);
			return id === "skip" ? undefined : id;
		},
		firstKey: () => "doc::",
	});

	await docs.set(tx, { slug: "a", title: "A" });
	await tx.set("doc::skip", { slug: "skip", title: "Skip" });
	await tx.set("other::z", { slug: "other", title: "Other" });

	expect(await docs.listIDs(tx)).toEqual(["a"]);
	expect(await docs.list(tx)).toEqual([{ slug: "a", title: "A" }]);
});
